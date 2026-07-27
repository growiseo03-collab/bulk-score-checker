// functions/api/crawl-batch.js -> POST /api/crawl-batch
// Processes one batch of pages from the crawl frontier and returns newly
// analyzed pages plus the updated frontier/visited lists. The frontend calls
// this repeatedly (passing back frontier/visited each time) until frontier
// is empty or the page limit is reached - this is how a "full site crawl"
// stays within Cloudflare's free-tier subrequest-per-invocation limit.

import { crawlBatch } from "../_crawlerCore.js";

const DEFAULT_BATCH_SIZE = 15; // keeps subrequests per call well under the free-tier cap of 50

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { startUrl, frontier, visited, disallowRules, batchSize } = body;

    if (!startUrl || !Array.isArray(frontier) || !Array.isArray(visited)) {
      return new Response(JSON.stringify({ error: "Missing startUrl, frontier, or visited array." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await crawlBatch({
      startUrl,
      frontier,
      visited,
      disallowRules: disallowRules || [],
      batchSize: Math.min(batchSize || DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    });

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
