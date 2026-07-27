// src/index.js
// Single Cloudflare Worker that serves the static site (from ./public via the
// assets binding) AND handles the /api/* routes. This is Cloudflare's current
// recommended pattern ("Workers with static assets") — the dashboard now
// creates this project type by default instead of a classic Pages project.
//
// Routing: any request matching a real file in ./public is served directly
// by Cloudflare without ever reaching this script (that's the default
// run_worker_first=false behavior). Only requests that don't match a static
// file - our /api/* routes - actually invoke this fetch handler.

import { checkUrl } from "./scoring.js";
import { crawlBatch, getSiteMeta } from "./crawlerCore.js";

const MAX_BULK_BATCH_SIZE = 25;
const MAX_CRAWL_BATCH_SIZE = 15;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Simple site-wide password lock using HTTP Basic Auth (browser shows a
// native login popup). Username/password are set as Cloudflare secrets
// (SITE_USERNAME / SITE_PASSWORD) - see README for where to set them in the
// dashboard. If those secrets aren't set at all, the site stays open
// (no lock) so local dev without secrets still works.
function checkAuth(request, env) {
  if (!env.SITE_USERNAME || !env.SITE_PASSWORD) return true; // no password configured, allow through

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Basic ")) return false;

  const decoded = atob(authHeader.slice(6));
  const separatorIndex = decoded.indexOf(":");
  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);

  return user === env.SITE_USERNAME && pass === env.SITE_PASSWORD;
}

function unauthorizedResponse() {
  return new Response("Password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SEO Toolkit", charset="UTF-8"' },
  });
}

async function handleCheck(request) {
  if (request.method === "GET") {
    return json({ status: "ok", info: "POST { urls: [...] } to this endpoint, max 25 URLs per call." });
  }
  try {
    const body = await request.json();
    const urls = Array.isArray(body.urls) ? body.urls : [];

    if (urls.length === 0) return json({ error: "No URLs provided." }, 400);
    if (urls.length > MAX_BULK_BATCH_SIZE) {
      return json({
        error: `Batch too large. Max ${MAX_BULK_BATCH_SIZE} URLs per request (Cloudflare free-tier subrequest limit). Split into smaller batches.`,
      }, 400);
    }

    const results = await Promise.all(urls.map(u => checkUrl(u)));
    return json({ results });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

async function handleSiteInfo(request) {
  try {
    const body = await request.json();
    let url = (body.url || "").trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const parsed = new URL(url);

    const siteMeta = await getSiteMeta(parsed.origin, parsed.hostname);

    let sslValid = true;
    try {
      const testResp = await fetch(parsed.origin, { method: "HEAD" });
      sslValid = testResp.ok || testResp.status < 500;
    } catch (e) {
      sslValid = false;
    }

    return json({ startUrl: parsed.toString(), hostname: parsed.hostname, ...siteMeta, sslValid });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

async function handleCrawlBatch(request) {
  try {
    const body = await request.json();
    const { startUrl, frontier, visited, disallowRules, batchSize } = body;

    if (!startUrl || !Array.isArray(frontier) || !Array.isArray(visited)) {
      return json({ error: "Missing startUrl, frontier, or visited array." }, 400);
    }

    const result = await crawlBatch({
      startUrl,
      frontier,
      visited,
      disallowRules: disallowRules || [],
      batchSize: Math.min(batchSize || MAX_CRAWL_BATCH_SIZE, MAX_CRAWL_BATCH_SIZE),
    });

    return json(result);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    if (!checkAuth(request, env)) return unauthorizedResponse();

    const url = new URL(request.url);

    if (url.pathname === "/api/check") return handleCheck(request);
    if (url.pathname === "/api/site-info" && request.method === "POST") return handleSiteInfo(request);
    if (url.pathname === "/api/crawl-batch" && request.method === "POST") return handleCrawlBatch(request);

    // Anything else reaching this Worker didn't match a static asset.
    // Let the asset binding produce the correct 404, rather than hand-rolling one.
    return env.ASSETS.fetch(request);
  },
};
