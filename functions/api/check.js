// functions/api/check.js
// Cloudflare Pages Function -> reachable at POST /api/check
// Accepts: { "urls": ["example.com", "https://other.com", ...] }  (max 25 per call)
// Returns: { "results": [ {...}, {...} ] }
//
// Why max 25 per call: Cloudflare's FREE plan caps subrequests (outbound
// fetches) per invocation at 50. Each URL check makes up to 4 outbound
// fetches (homepage, robots.txt, sitemap.xml, RDAP lookup), so 25 URLs is a
// safe ceiling that leaves headroom. The frontend automatically splits any
// larger list into batches of this size and calls this endpoint repeatedly,
// so from the user's side it still feels like one bulk operation.

import { checkUrl } from "../_scoring.js";

const MAX_BATCH_SIZE = 25;

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const urls = Array.isArray(body.urls) ? body.urls : [];

    if (urls.length === 0) {
      return new Response(JSON.stringify({ error: "No URLs provided." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (urls.length > MAX_BATCH_SIZE) {
      return new Response(JSON.stringify({
        error: `Batch too large. Max ${MAX_BATCH_SIZE} URLs per request (Cloudflare free-tier subrequest limit). Split into smaller batches.`,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(urls.map(u => checkUrl(u)));

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ status: "ok", info: "POST { urls: [...] } to this endpoint, max 25 URLs per call." }), {
    headers: { "Content-Type": "application/json" },
  });
}
