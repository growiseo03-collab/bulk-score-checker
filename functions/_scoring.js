// scoring.js
// Estimated Authority (DA-style) / Trust (DR-style) / Spam Score calculator.
// Uses only free, public signals reachable over plain HTTPS fetch — works
// inside a Cloudflare Worker/Pages Function (no raw sockets, no paid APIs).
//
// IMPORTANT: These are ESTIMATES based on free public signals (SSL validity,
// domain age via RDAP, robots.txt/sitemap presence, response health, basic
// on-page signals, TLD reputation). They are NOT Moz Domain Authority, Ahrefs
// Domain Rating, or Moz Spam Score — those require proprietary backlink
// indexes with no free access. Treat these as a directional health score.

const LOW_TRUST_TLDS = new Set([
  ".xyz", ".top", ".work", ".click", ".loan", ".men", ".gq", ".tk",
  ".ml", ".cf", ".ga", ".review", ".download", ".racing", ".win",
]);

function getTld(hostname) {
  const parts = hostname.split(".");
  return parts.length >= 2 ? "." + parts[parts.length - 1] : "";
}

function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    return u;
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
    return { resp, elapsedMs: Date.now() - start, error: null };
  } catch (e) {
    return { resp: null, elapsedMs: Date.now() - start, error: e.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// RDAP is the modern, free, HTTP-based replacement for WHOIS (no raw sockets needed).
async function getDomainAgeDays(hostname) {
  try {
    const { resp, error } = await fetchWithTimeout(`https://rdap.org/domain/${hostname}`, {}, 6000);
    if (error || !resp || !resp.ok) return null;
    const data = await resp.json();
    const events = data.events || [];
    const reg = events.find(e => e.eventAction === "registration");
    if (!reg || !reg.eventDate) return null;
    const created = new Date(reg.eventDate);
    const days = Math.floor((Date.now() - created.getTime()) / 86400000);
    return days >= 0 ? days : null;
  } catch (e) {
    return null;
  }
}

function extractBasicPageSignals(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : "";

  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const viewportMatch = /<meta[^>]+name=["']viewport["']/i.test(html);

  const textOnly = html.replace(/<script[\s\S]*?<\/script>/gi, "")
                        .replace(/<style[\s\S]*?<\/style>/gi, "")
                        .replace(/<[^>]+>/g, " ");
  const wordCount = textOnly.trim().split(/\s+/).filter(Boolean).length;

  return { title, titleLength: title.length, metaDesc, metaDescLength: metaDesc.length, h1Count, hasViewport: viewportMatch, wordCount };
}

async function checkUrl(rawUrl) {
  const parsed = normalizeUrl(rawUrl);
  if (!parsed) {
    return { input: rawUrl, url: null, error: "Invalid URL", authorityScore: null, trustScore: null, spamScore: null };
  }
  const hostname = parsed.hostname;
  const origin = parsed.origin;

  const [homepageResult, robotsResult, sitemapResult, domainAgeDays] = await Promise.all([
    fetchWithTimeout(parsed.toString(), { headers: { "User-Agent": "Mozilla/5.0 (compatible; BulkSiteScoreChecker/1.0)" } }),
    fetchWithTimeout(origin + "/robots.txt", {}, 5000),
    fetchWithTimeout(origin + "/sitemap.xml", {}, 5000),
    getDomainAgeDays(hostname),
  ]);

  const { resp: homeResp, elapsedMs, error: homeError } = homepageResult;
  const sslValid = parsed.protocol === "https:" && !!homeResp && !homeError;
  const robotsFound = !!(robotsResult.resp && robotsResult.resp.ok);
  const sitemapFound = !!(sitemapResult.resp && sitemapResult.resp.ok);
  const riskyTld = LOW_TRUST_TLDS.has(getTld(hostname));

  let pageSignals = { title: "", titleLength: 0, metaDesc: "", metaDescLength: 0, h1Count: 0, hasViewport: false, wordCount: 0 };
  let statusCode = null;

  if (homeResp) {
    statusCode = homeResp.status;
    const contentType = homeResp.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      try {
        const html = await homeResp.text();
        pageSignals = extractBasicPageSignals(html);
      } catch (e) { /* leave defaults */ }
    }
  }

  const isError = !homeResp || homeError || statusCode >= 400;

  // ---------- Authority Score (0-100, DA-style) ----------
  let authority = 30;
  if (sslValid) authority += 12;
  if (robotsFound) authority += 6;
  if (sitemapFound) authority += 8;
  if (domainAgeDays !== null) authority += Math.min((domainAgeDays / 365) * 3, 25);
  if (isError) authority -= 20;
  authority = Math.max(1, Math.min(100, Math.round(authority)));

  // ---------- Trust Score (0-100, DR-style) ----------
  let trust = 25;
  if (sslValid) trust += 15;
  if (domainAgeDays !== null) trust += Math.min((domainAgeDays / 365) * 2.5, 20);
  if (pageSignals.title) trust += 10;
  if (pageSignals.metaDesc) trust += 10;
  if (pageSignals.wordCount >= 150) trust += 10;
  if (pageSignals.hasViewport) trust += 10;
  if (isError) trust -= 15;
  trust = Math.max(1, Math.min(100, Math.round(trust)));

  // ---------- Spam Score (0-100, higher = riskier) ----------
  let spam = 0;
  if (riskyTld) spam += 20;
  if (!sslValid) spam += 15;
  if (isError) spam += 20;
  if (pageSignals.wordCount > 0 && pageSignals.wordCount < 150) spam += 15;
  if (!pageSignals.title) spam += 10;
  if (domainAgeDays !== null && domainAgeDays < 180) spam += 15;
  spam = Math.max(0, Math.min(100, Math.round(spam)));

  return {
    input: rawUrl,
    url: parsed.toString(),
    hostname,
    statusCode,
    loadTimeMs: elapsedMs,
    sslValid,
    robotsFound,
    sitemapFound,
    domainAgeDays,
    riskyTld,
    title: pageSignals.title,
    titleLength: pageSignals.titleLength,
    metaDescLength: pageSignals.metaDescLength,
    h1Count: pageSignals.h1Count,
    wordCount: pageSignals.wordCount,
    hasViewport: pageSignals.hasViewport,
    authorityScore: authority,
    trustScore: trust,
    spamScore: spam,
    error: homeError || (isError ? `HTTP ${statusCode}` : null),
  };
}

export { checkUrl, normalizeUrl, LOW_TRUST_TLDS };
