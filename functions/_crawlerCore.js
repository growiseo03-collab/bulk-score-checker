// functions/_crawlerCore.js
// Per-page fetch + analysis logic for the Full Site Audit tool.
// Design note: to stay within Cloudflare's free-tier subrequest limit (50 per
// invocation), this does NOT verify broken links (that would multiply
// subrequests by the number of links on every page). Broken-link checking is
// available in the offline Python CLI tool (site_audit_tool) instead. This
// web version focuses on Technical SEO, Indexability, and On-Page SEO.

const USER_AGENT = "Mozilla/5.0 (compatible; SiteAuditTool/1.0)";

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch (e) {
    return null;
  }
}

// Minimal robots.txt parser: handles User-agent: * blocks and Disallow rules
// (prefix match). Not fully RFC-compliant, but covers the common case for a
// free tool. Ignores Allow overrides and wildcard patterns for simplicity.
function parseRobotsTxt(text) {
  const lines = text.split("\n").map(l => l.trim());
  const disallow = [];
  let inWildcardBlock = false;
  let sawAnyUserAgent = false;

  for (const line of lines) {
    if (/^user-agent:/i.test(line)) {
      sawAnyUserAgent = true;
      const agent = line.split(":")[1].trim();
      inWildcardBlock = agent === "*";
    } else if (/^disallow:/i.test(line) && inWildcardBlock) {
      const path = line.split(":").slice(1).join(":").trim();
      if (path) disallow.push(path);
    }
  }
  return { disallow, hasRules: sawAnyUserAgent };
}

function isDisallowed(pathname, disallowRules) {
  return disallowRules.some(rule => rule !== "" && pathname.startsWith(rule));
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

// Fetches robots.txt + sitemap.xml + does an RDAP domain-age lookup. Called
// ONCE per audit (on the first crawl batch) so it doesn't eat into the
// per-page subrequest budget on every subsequent call.
async function getSiteMeta(origin, hostname) {
  const [robotsResult, sitemapResult, rdapResult] = await Promise.all([
    fetchWithTimeout(origin + "/robots.txt", {}, 6000),
    fetchWithTimeout(origin + "/sitemap.xml", {}, 6000),
    fetchWithTimeout(`https://rdap.org/domain/${hostname}`, {}, 6000),
  ]);

  let disallowRules = [];
  let robotsFound = false;
  if (robotsResult.resp && robotsResult.resp.ok) {
    robotsFound = true;
    try {
      const text = await robotsResult.resp.text();
      disallowRules = parseRobotsTxt(text).disallow;
    } catch (e) { /* ignore */ }
  }

  const sitemapFound = !!(sitemapResult.resp && sitemapResult.resp.ok);

  let domainAgeDays = null;
  if (rdapResult.resp && rdapResult.resp.ok) {
    try {
      const data = await rdapResult.resp.json();
      const reg = (data.events || []).find(e => e.eventAction === "registration");
      if (reg && reg.eventDate) {
        domainAgeDays = Math.floor((Date.now() - new Date(reg.eventDate).getTime()) / 86400000);
      }
    } catch (e) { /* ignore */ }
  }

  return { robotsFound, sitemapFound, disallowRules, domainAgeDays };
}

function extractPageData(html, headers, disallowRules, pathname) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : "";

  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);

  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;

  const jsonLdPresent = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
  const microdataPresent = /itemtype=["']/i.test(html);

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const imagesMissingAlt = imgTags.filter(tag => !/alt=["'][^"']+["']/i.test(tag)).length;

  const textOnly = html.replace(/<script[\s\S]*?<\/script>/gi, "")
                        .replace(/<style[\s\S]*?<\/style>/gi, "")
                        .replace(/<[^>]+>/g, " ");
  const wordCount = textOnly.trim().split(/\s+/).filter(Boolean).length;

  // indexability
  const blockReasons = [];
  let indexable = true;
  const xRobots = headers.get("X-Robots-Tag") || "";
  if (/noindex/i.test(xRobots)) { indexable = false; blockReasons.push("X-Robots-Tag: noindex header"); }
  const metaRobotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  if (metaRobotsMatch && /noindex/i.test(metaRobotsMatch[1])) {
    indexable = false; blockReasons.push("meta robots noindex tag");
  }
  if (isDisallowed(pathname, disallowRules)) {
    indexable = false; blockReasons.push("blocked by robots.txt");
  }

  // link discovery
  const hrefMatches = [...html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>/gi)].map(m => m[1]);

  return {
    title, titleLength: title.length,
    metaDesc, metaDescLength: metaDesc.length,
    h1Count, h2Count, hasViewport, canonical,
    hasStructuredData: jsonLdPresent || microdataPresent,
    imageCount: imgTags.length, imagesMissingAlt,
    wordCount,
    indexable, blockReasons,
    rawHrefs: hrefMatches,
  };
}

async function crawlBatch({ startUrl, frontier, visited, batchSize, disallowRules }) {
  const startParsed = new URL(startUrl);
  const baseHostname = startParsed.hostname;
  const visitedSet = new Set(visited);
  const pages = [];
  const newFrontierAdds = [];
  let processed = 0;

  const queue = [...frontier];

  while (queue.length > 0 && processed < batchSize) {
    const current = queue.shift();
    if (visitedSet.has(current)) continue;
    visitedSet.add(current);
    processed++;

    const { resp, elapsedMs, error } = await fetchWithTimeout(current, { headers: { "User-Agent": USER_AGENT } });

    if (error || !resp) {
      pages.push({ url: current, statusCode: null, error: error || "fetch failed", loadTimeMs: elapsedMs });
      continue;
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      pages.push({ url: current, statusCode: resp.status, loadTimeMs: elapsedMs, error: null, skipped: "non-html" });
      continue;
    }

    let html;
    try {
      html = await resp.text();
    } catch (e) {
      pages.push({ url: current, statusCode: resp.status, loadTimeMs: elapsedMs, error: "could not read body" });
      continue;
    }

    const pathname = new URL(current).pathname;
    const data = extractPageData(html, resp.headers, disallowRules, pathname);
    const rawHrefs = data.rawHrefs;
    delete data.rawHrefs;

    for (const href of rawHrefs) {
      try {
        const abs = new URL(href, current).toString();
        const norm = normalizeUrl(abs);
        if (!norm) continue;
        const u = new URL(norm);
        if (u.hostname === baseHostname && !visitedSet.has(norm) && !queue.includes(norm)) {
          newFrontierAdds.push(norm);
        }
      } catch (e) { /* skip malformed */ }
    }

    pages.push({
      url: current,
      statusCode: resp.status,
      loadTimeMs: elapsedMs,
      error: resp.status >= 400 ? `HTTP ${resp.status}` : null,
      ...data,
    });
  }

  const updatedFrontier = [...new Set([...queue, ...newFrontierAdds])];

  return {
    pages,
    visited: [...visitedSet],
    frontier: updatedFrontier,
    done: updatedFrontier.length === 0,
  };
}

export { crawlBatch, getSiteMeta, normalizeUrl };
