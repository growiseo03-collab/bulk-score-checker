// functions/api/site-info.js -> POST /api/site-info
// Called ONCE at the start of a Full Site Audit to fetch site-wide info
// (robots.txt rules, sitemap presence, domain age) without eating into the
// per-page subrequest budget used by /api/crawl-batch.

import { getSiteMeta } from "../_crawlerCore.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
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

    return new Response(JSON.stringify({
      startUrl: parsed.toString(),
      hostname: parsed.hostname,
      ...siteMeta,
      sslValid,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
