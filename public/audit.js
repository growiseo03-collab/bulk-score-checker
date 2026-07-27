const BATCH_SIZE = 15; // must match DEFAULT_BATCH_SIZE in functions/api/crawl-batch.js

const siteUrlInput = document.getElementById('siteUrl');
const maxPagesSelect = document.getElementById('maxPages');
const runBtn = document.getElementById('runBtn');
const progressPanel = document.getElementById('progressPanel');
const progressLabel = document.getElementById('progressLabel');
const progressPct = document.getElementById('progressPct');
const progressFill = document.getElementById('progressFill');
const progressCurrent = document.getElementById('progressCurrent');
const resultsPanel = document.getElementById('resultsPanel');
const summaryCards = document.getElementById('summaryCards');
const technicalTableEl = document.getElementById('technicalTable');
const indexabilityTableEl = document.getElementById('indexabilityTable');
const onpageBody = document.getElementById('onpageBody');

let siteMeta = null;
let allPages = [];
let duplicateTitles = {};
let duplicateMetas = {};

// ---------- On-page scoring (mirrors the Python onpage_seo.py logic) ----------
const IDEAL_TITLE_MIN = 30, IDEAL_TITLE_MAX = 60;
const IDEAL_META_MIN = 70, IDEAL_META_MAX = 160;

function scoreTitle(title) {
  const issues = [];
  if (!title) return { score: 0, issues: ["Missing title tag"] };
  let score = 100;
  const len = title.length;
  if (len < IDEAL_TITLE_MIN) { score -= 30; issues.push(`Too short (${len} chars, ideal ${IDEAL_TITLE_MIN}-${IDEAL_TITLE_MAX})`); }
  else if (len > IDEAL_TITLE_MAX) { score -= 20; issues.push(`Too long (${len} chars, ideal ${IDEAL_TITLE_MIN}-${IDEAL_TITLE_MAX})`); }
  const words = title.split(/\s+/);
  const counts = {};
  words.forEach(w => { const wl = w.toLowerCase(); counts[wl] = (counts[wl] || 0) + 1; });
  if (words.length > 3 && Math.max(...Object.values(counts)) >= 3) {
    score -= 15; issues.push("Possible keyword stuffing");
  }
  return { score: Math.max(0, score), issues };
}

function scoreMeta(meta) {
  const issues = [];
  if (!meta) return { score: 0, issues: ["Missing meta description"] };
  let score = 100;
  const len = meta.length;
  if (len < IDEAL_META_MIN) { score -= 25; issues.push(`Too short (${len} chars, ideal ${IDEAL_META_MIN}-${IDEAL_META_MAX})`); }
  else if (len > IDEAL_META_MAX) { score -= 15; issues.push(`Too long (${len} chars, ideal ${IDEAL_META_MIN}-${IDEAL_META_MAX})`); }
  return { score: Math.max(0, score), issues };
}

function runOnPageScoring(pages) {
  const titleMap = {}, metaMap = {};
  pages.forEach(p => {
    if (p.statusCode && p.statusCode < 400) {
      const t = (p.title || '').trim().toLowerCase();
      const m = (p.metaDesc || '').trim().toLowerCase();
      if (t) (titleMap[t] = titleMap[t] || []).push(p.url);
      if (m) (metaMap[m] = metaMap[m] || []).push(p.url);
    }
  });
  duplicateTitles = Object.fromEntries(Object.entries(titleMap).filter(([, v]) => v.length > 1));
  duplicateMetas = Object.fromEntries(Object.entries(metaMap).filter(([, v]) => v.length > 1));

  pages.forEach(p => {
    if (!p.statusCode || p.statusCode >= 400) {
      p.titleScore = null; p.titleIssues = [];
      p.metaScore = null; p.metaIssues = [];
      p.isDupTitle = false; p.isDupMeta = false;
      return;
    }
    const ts = scoreTitle(p.title || '');
    const ms = scoreMeta(p.metaDesc || '');
    p.titleScore = ts.score; p.titleIssues = ts.issues;
    p.metaScore = ms.score; p.metaIssues = ms.issues;
    p.isDupTitle = !!duplicateTitles[(p.title || '').trim().toLowerCase()];
    p.isDupMeta = !!duplicateMetas[(p.metaDesc || '').trim().toLowerCase()];
  });
}

// ---------- Crawl orchestration ----------
function normalizeInputUrl(v) {
  let u = v.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

async function runAudit() {
  const startUrl = normalizeInputUrl(siteUrlInput.value);
  if (!startUrl) { alert('Enter a URL first.'); return; }
  const maxPages = parseInt(maxPagesSelect.value, 10);

  runBtn.disabled = true;
  runBtn.textContent = 'Running...';
  progressPanel.hidden = false;
  resultsPanel.hidden = true;
  allPages = [];

  progressLabel.textContent = 'Fetching site info (robots.txt, sitemap, domain age)...';
  progressFill.style.width = '5%';

  try {
    const siteInfoResp = await fetch('/api/site-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: startUrl }),
    });
    siteMeta = await siteInfoResp.json();
  } catch (e) {
    siteMeta = { error: e.message };
  }

  let frontier = [siteMeta.startUrl || startUrl];
  let visited = [];
  let done = false;
  let safetyCounter = 0;

  while (!done && visited.length < maxPages && safetyCounter < 500) {
    safetyCounter++;
    const remaining = maxPages - visited.length;
    const batchSize = Math.min(BATCH_SIZE, remaining);

    progressCurrent.textContent = `Next: ${frontier.slice(0, 3).join(', ')}${frontier.length > 3 ? ' ...' : ''}`;

    let data;
    try {
      const resp = await fetch('/api/crawl-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrl: siteMeta.startUrl || startUrl,
          frontier, visited,
          disallowRules: siteMeta.disallowRules || [],
          batchSize,
        }),
      });
      data = await resp.json();
      if (data.error) throw new Error(data.error);
    } catch (e) {
      progressCurrent.textContent = `Error: ${e.message}`;
      break;
    }

    allPages.push(...data.pages);
    frontier = data.frontier;
    visited = data.visited;
    done = data.done || visited.length >= maxPages;

    const pct = Math.min(100, Math.round((visited.length / maxPages) * 100));
    progressLabel.textContent = `Crawled ${visited.length} / ${maxPages} pages`;
    progressPct.textContent = `${pct}%`;
    progressFill.style.width = `${pct}%`;
  }

  runOnPageScoring(allPages);
  renderResults();

  runBtn.disabled = false;
  runBtn.textContent = 'Start Full Audit';
}

runBtn.addEventListener('click', runAudit);

// ---------- Rendering ----------
function renderResults() {
  resultsPanel.hidden = false;

  const validPages = allPages.filter(p => p.statusCode && p.statusCode < 400);
  const errorPages = allPages.filter(p => !p.statusCode || p.statusCode >= 400);
  const indexableCount = validPages.filter(p => p.indexable).length;
  const blockedCount = validPages.length - indexableCount;
  const avgWordCount = validPages.length ? Math.round(validPages.reduce((s, p) => s + (p.wordCount || 0), 0) / validPages.length) : 0;
  const missingAlt = validPages.reduce((s, p) => s + (p.imagesMissingAlt || 0), 0);
  const dupTitleCount = Object.values(duplicateTitles).reduce((s, v) => s + v.length, 0);
  const dupMetaCount = Object.values(duplicateMetas).reduce((s, v) => s + v.length, 0);

  summaryCards.innerHTML = `
    <div class="summary-card"><div class="big">${allPages.length}</div><div class="label">Pages Crawled</div></div>
    <div class="summary-card"><div class="big">${errorPages.length}</div><div class="label">Errors</div></div>
    <div class="summary-card"><div class="big">${indexableCount}</div><div class="label">Indexable</div></div>
    <div class="summary-card"><div class="big">${blockedCount}</div><div class="label">Blocked</div></div>
    <div class="summary-card"><div class="big">${avgWordCount}</div><div class="label">Avg Words/Page</div></div>
  `;

  technicalTableEl.innerHTML = `
    <table class="kv-table">
      <tr><td>SSL valid</td><td>${siteMeta.sslValid ? 'Yes' : 'No'}</td></tr>
      <tr><td>robots.txt found</td><td>${siteMeta.robotsFound ? 'Yes' : 'No'}</td></tr>
      <tr><td>sitemap.xml found</td><td>${siteMeta.sitemapFound ? 'Yes' : 'No'}</td></tr>
      <tr><td>Domain age</td><td>${siteMeta.domainAgeDays ? (Math.round(siteMeta.domainAgeDays / 365 * 10) / 10) + ' years' : 'Unknown'}</td></tr>
      <tr><td>Pages with images missing alt text</td><td>${missingAlt}</td></tr>
      <tr><td>Duplicate titles across site</td><td>${dupTitleCount}</td></tr>
      <tr><td>Duplicate meta descriptions across site</td><td>${dupMetaCount}</td></tr>
    </table>`;

  const blockedPages = validPages.filter(p => !p.indexable);
  indexabilityTableEl.innerHTML = blockedPages.length === 0
    ? `<p class="hint">No blocked pages found — everything crawled is indexable.</p>`
    : `<table class="table-wrap-inner">
        <thead><tr><th>URL</th><th>Blocked by</th></tr></thead>
        <tbody>${blockedPages.map(p => `<tr><td class="mono">${p.url}</td><td>${p.blockReasons.join(', ')}</td></tr>`).join('')}</tbody>
      </table>`;

  onpageBody.innerHTML = allPages.map(p => {
    const issues = [...(p.titleIssues || []), ...(p.metaIssues || [])];
    if (p.isDupTitle) issues.push('Duplicate title');
    if (p.isDupMeta) issues.push('Duplicate meta description');
    return `<tr>
      <td class="url-cell mono" title="${p.url}">${p.url}</td>
      <td class="mono">${p.statusCode ?? 'ERR'}</td>
      <td class="mono">${p.indexable === undefined ? '—' : (p.indexable ? 'Yes' : 'No')}</td>
      <td class="mono">${p.titleScore ?? '—'}</td>
      <td class="mono">${p.metaScore ?? '—'}</td>
      <td class="mono" style="white-space:normal;">${issues.join('; ') || 'None'}</td>
    </tr>`;
  }).join('');
}

// ---------- PDF export ----------
document.getElementById('exportPdf').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const validPages = allPages.filter(p => p.statusCode && p.statusCode < 400);
  const errorPages = allPages.filter(p => !p.statusCode || p.statusCode >= 400);
  const indexableCount = validPages.filter(p => p.indexable).length;
  const blockedCount = validPages.length - indexableCount;

  doc.setFontSize(16);
  doc.text('Full Website SEO Audit Report', 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`${siteMeta.startUrl || siteUrlInput.value} — Generated ${new Date().toLocaleString()}`, 14, 22);

  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text('1. Technical SEO', 14, 32);
  doc.autoTable({
    startY: 36,
    body: [
      ['Pages crawled', String(allPages.length)],
      ['Pages with errors', String(errorPages.length)],
      ['SSL valid', siteMeta.sslValid ? 'Yes' : 'No'],
      ['robots.txt found', siteMeta.robotsFound ? 'Yes' : 'No'],
      ['sitemap.xml found', siteMeta.sitemapFound ? 'Yes' : 'No'],
      ['Domain age', siteMeta.domainAgeDays ? (Math.round(siteMeta.domainAgeDays / 365 * 10) / 10) + ' years' : 'Unknown'],
    ],
    styles: { fontSize: 8 }, theme: 'plain',
  });

  let y = doc.lastAutoTable.finalY + 10;
  doc.text('2. Indexability', 14, y);
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text('Whether pages are allowed to be indexed (not a live Google index check).', 14, y + 5);
  doc.autoTable({
    startY: y + 9,
    body: [['Indexable pages', String(indexableCount)], ['Blocked from indexing', String(blockedCount)]],
    styles: { fontSize: 8 }, theme: 'plain',
  });

  y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text('3. On-Page SEO — Meta Title & Description Scores', 14, y);
  doc.autoTable({
    startY: y + 4,
    head: [['URL', 'Status', 'Indexable', 'Title', 'Meta', 'Issues']],
    body: allPages.map(p => {
      const issues = [...(p.titleIssues || []), ...(p.metaIssues || [])];
      if (p.isDupTitle) issues.push('Dup. title');
      if (p.isDupMeta) issues.push('Dup. meta');
      return [
        p.url, p.statusCode ?? 'ERR', p.indexable === undefined ? '—' : (p.indexable ? 'Yes' : 'No'),
        p.titleScore ?? '—', p.metaScore ?? '—', issues.join('; ') || 'None',
      ];
    }),
    styles: { fontSize: 6.5, cellPadding: 1.5 },
    headStyles: { fillColor: [20, 22, 28] },
    columnStyles: { 0: { cellWidth: 55 }, 5: { cellWidth: 55 } },
  });

  doc.save(`site-audit-${Date.now()}.pdf`);
});
