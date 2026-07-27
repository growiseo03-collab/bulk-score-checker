const BATCH_SIZE = 25; // must match MAX_BATCH_SIZE in functions/api/check.js
const CONCURRENT_BATCHES = 3; // how many batches run in parallel

const urlInput = document.getElementById('urlInput');
const fileInput = document.getElementById('fileInput');
const urlCount = document.getElementById('urlCount');
const runBtn = document.getElementById('runBtn');
const progressPanel = document.getElementById('progressPanel');
const progressLabel = document.getElementById('progressLabel');
const progressPct = document.getElementById('progressPct');
const progressFill = document.getElementById('progressFill');
const progressCurrent = document.getElementById('progressCurrent');
const resultsPanel = document.getElementById('resultsPanel');
const resultsBody = document.getElementById('resultsBody');
const summaryCards = document.getElementById('summaryCards');

let allResults = [];
let sortKey = null;
let sortAsc = true;

function parseUrls(text) {
  return [...new Set(
    text.split('\n').map(l => l.trim()).filter(Boolean)
  )];
}

function updateCount() {
  const count = parseUrls(urlInput.value).length;
  urlCount.textContent = `${count} URL${count === 1 ? '' : 's'}`;
}
urlInput.addEventListener('input', updateCount);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  urlInput.value = text;
  updateCount();
});

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runBatch(batch) {
  try {
    const resp = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: batch }),
    });
    const data = await resp.json();
    if (data.error) {
      return batch.map(u => ({ input: u, hostname: u, error: data.error, authorityScore: null, trustScore: null, spamScore: null }));
    }
    return data.results;
  } catch (e) {
    return batch.map(u => ({ input: u, hostname: u, error: e.message, authorityScore: null, trustScore: null, spamScore: null }));
  }
}

async function runAll(urls) {
  const batches = chunk(urls, BATCH_SIZE);
  let completed = 0;
  allResults = [];

  progressPanel.hidden = false;
  resultsPanel.hidden = true;
  runBtn.disabled = true;
  runBtn.textContent = 'Running...';

  // Run batches with limited concurrency so we don't hammer the API
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < batches.length) {
      const myIndex = nextIndex++;
      const batch = batches[myIndex];
      progressCurrent.textContent = `Checking: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? ' ...' : ''}`;
      const results = await runBatch(batch);
      allResults.push(...results);
      completed += batch.length;
      const pct = Math.round((completed / urls.length) * 100);
      progressLabel.textContent = `Checking ${completed} / ${urls.length}`;
      progressPct.textContent = `${pct}%`;
      progressFill.style.width = `${pct}%`;
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENT_BATCHES, batches.length) }, () => worker());
  await Promise.all(workers);

  runBtn.disabled = false;
  runBtn.textContent = 'Run Check';
  renderResults();
}

runBtn.addEventListener('click', () => {
  const urls = parseUrls(urlInput.value);
  if (urls.length === 0) {
    alert('Paste at least one URL first.');
    return;
  }
  runAll(urls);
});

function scoreBadgeClass(value, reverse = false) {
  const v = reverse ? 100 - value : value;
  if (v >= 70) return 'good';
  if (v >= 40) return 'warn';
  return 'bad';
}

function renderSummary() {
  const valid = allResults.filter(r => r.authorityScore !== null && r.authorityScore !== undefined);
  const avg = (key) => valid.length ? Math.round(valid.reduce((s, r) => s + (r[key] || 0), 0) / valid.length) : 0;
  const errors = allResults.filter(r => r.error).length;

  summaryCards.innerHTML = `
    <div class="summary-card"><div class="big">${allResults.length}</div><div class="label">URLs Checked</div></div>
    <div class="summary-card"><div class="big">${avg('authorityScore')}</div><div class="label">Avg Authority</div></div>
    <div class="summary-card"><div class="big">${avg('trustScore')}</div><div class="label">Avg Trust</div></div>
    <div class="summary-card"><div class="big">${avg('spamScore')}</div><div class="label">Avg Spam Score</div></div>
    <div class="summary-card"><div class="big">${errors}</div><div class="label">Errors</div></div>
  `;
}

function sortResults() {
  if (!sortKey) return;
  allResults.sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? av - bv : bv - av;
  });
}

function renderResults() {
  resultsPanel.hidden = false;
  renderSummary();
  sortResults();

  resultsBody.innerHTML = allResults.map(r => {
    if (r.error && (r.authorityScore === null || r.authorityScore === undefined)) {
      return `<tr>
        <td class="url-cell mono" title="${r.input}">${r.hostname || r.input}</td>
        <td class="mono"><span class="badge bad">ERROR</span></td>
        <td colspan="6" class="mono" style="color:#b8362f;">${r.error}</td>
      </tr>`;
    }
    return `<tr>
      <td class="url-cell mono" title="${r.url || r.input}">${r.hostname || r.input}</td>
      <td class="mono">${r.statusCode ?? '—'}</td>
      <td class="mono"><span class="badge ${scoreBadgeClass(r.authorityScore)}">${r.authorityScore ?? '—'}</span></td>
      <td class="mono"><span class="badge ${scoreBadgeClass(r.trustScore)}">${r.trustScore ?? '—'}</span></td>
      <td class="mono"><span class="badge ${scoreBadgeClass(r.spamScore, true)}">${r.spamScore ?? '—'}</span></td>
      <td class="mono">${r.domainAgeDays ? Math.round(r.domainAgeDays / 365 * 10) / 10 + 'y' : '—'}</td>
      <td class="mono">${r.sslValid ? '✓' : '✗'}</td>
      <td class="mono">${r.loadTimeMs ?? '—'}</td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = false; }
    renderResults();
  });
});

function toCsv() {
  const headers = ['URL', 'Status', 'Authority Score', 'Trust Score', 'Spam Score', 'Domain Age (days)', 'SSL Valid', 'Load Time (ms)', 'Error'];
  const rows = allResults.map(r => [
    r.url || r.input, r.statusCode ?? '', r.authorityScore ?? '', r.trustScore ?? '',
    r.spamScore ?? '', r.domainAgeDays ?? '', r.sslValid ? 'yes' : 'no', r.loadTimeMs ?? '', r.error ?? ''
  ]);
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
}

document.getElementById('exportCsv').addEventListener('click', () => {
  const blob = new Blob([toCsv()], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bulk-site-scores-${Date.now()}.csv`;
  a.click();
});

document.getElementById('exportPdf').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(16);
  doc.text('Bulk Site Score Report', 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString()} — ${allResults.length} URLs checked`, 14, 22);
  doc.text('Scores are estimates from free public signals, not Moz/Ahrefs proprietary data.', 14, 27);

  const rows = allResults.map(r => [
    r.url || r.input,
    r.statusCode ?? (r.error ? 'ERR' : '—'),
    r.authorityScore ?? '—',
    r.trustScore ?? '—',
    r.spamScore ?? '—',
    r.domainAgeDays ? Math.round(r.domainAgeDays / 365 * 10) / 10 + 'y' : '—',
    r.sslValid ? 'Yes' : 'No',
    r.loadTimeMs ?? '—',
  ]);

  doc.autoTable({
    startY: 32,
    head: [['URL', 'Status', 'Authority', 'Trust', 'Spam', 'Domain Age', 'SSL', 'Load(ms)']],
    body: rows,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [20, 22, 28] },
    columnStyles: { 0: { cellWidth: 90 } },
  });

  doc.save(`bulk-site-scores-${Date.now()}.pdf`);
});
