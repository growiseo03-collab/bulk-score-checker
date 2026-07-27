# SEO Toolkit — Bulk Score Checker + Full Site Audit

One free website, two tools, hosted on Cloudflare Pages, deployed automatically from GitHub:

1. **Bulk Score Checker** (`/`) — paste 1000+ URLs, get estimated Authority Score (DA-style),
   Trust Score (DR-style), and Spam Score for every one, plus SSL/domain-age checks — export as CSV or PDF.
2. **Full Site Audit** (`/audit`) — enter one site, it crawls the whole thing (BFS, same-domain,
   resumable in the background so it works within free-tier limits), and reports Technical SEO,
   Indexability (which pages are allowed to be indexed and why), and On-Page SEO (meta title/description
   scoring, duplicate detection) — export as a full PDF report.

## Honest disclaimer about the scores

Real Moz Domain Authority, Ahrefs Domain Rating, and Moz Spam Score come from
proprietary backlink databases that cost money to access. There is no free,
legitimate way to pull those exact numbers.

This tool calculates its own **estimated** scores from free public signals:
SSL validity, domain age (via RDAP — the free modern WHOIS replacement),
robots.txt/sitemap.xml presence, response health, basic on-page SEO signals,
and TLD reputation. These are genuinely useful as a directional health check,
but they will **not match** what you'd see on moz.com or ahrefs.com.

**Indexability** (on the Full Site Audit page) checks whether a page is *allowed* to be indexed
(`noindex` tags, `X-Robots-Tag` headers, robots.txt rules) — it is NOT a live check of whether Google
has actually indexed the page. That requires Google Search Console, free but only for verified site owners.

**Off-page SEO / backlinks**: no free tool can legitimately provide real backlink data — that needs
a paid service (Ahrefs, Moz, Semrush). The Authority/Trust scores here are the closest free estimate,
clearly labeled as such throughout.


## Why 1000+ URLs isn't "one request" under the hood

Cloudflare's free plan limits each function call to 50 outbound sub-requests.
Each URL check makes up to 4 outbound requests (homepage, robots.txt,
sitemap.xml, RDAP lookup), so the backend caps each API call at 25 URLs.

The frontend handles this for you automatically: paste 1000 URLs, hit
"Run Check," and it silently splits your list into batches of 25, runs a few
batches in parallel, shows a live progress bar, and stitches every result
back into one combined table/report. You never have to think about batching.

## How the Full Site Audit crawls a whole site within free-tier limits

Same idea as the bulk checker's batching, applied differently: crawling a site means following links
you don't know about until you fetch the page, so it can't be pre-split into batches. Instead:

1. `/api/site-info` runs once at the start — fetches robots.txt, sitemap.xml, and domain age.
2. `/api/crawl-batch` processes ~15 pages per call, discovers new internal links as it goes, and returns
   the updated "frontier" (queue of undiscovered pages) and "visited" list.
3. The frontend calls `/api/crawl-batch` again and again, feeding back the frontier/visited each time,
   until the frontier is empty or your page limit is hit.

You just click "Start Full Audit" and watch the progress bar — the repeated calls happen automatically.

**Not included in the web version:** verified broken-link checking (would multiply subrequests by every
link on every page — not viable on free tier). Use the offline Python CLI tool for that if you need it.

## Project structure

```
bulk-score-checker/
├── functions/
│   ├── _scoring.js         # bulk-checker scoring logic (shared, not a route)
│   ├── _crawlerCore.js     # full-site-audit crawl + page analysis logic (shared, not a route)
│   └── api/
│       ├── check.js        # POST /api/check — bulk score checker batch endpoint
│       ├── site-info.js    # POST /api/site-info — one-time site metadata for full audit
│       └── crawl-batch.js  # POST /api/crawl-batch — resumable crawl endpoint for full audit
├── public/
│   ├── index.html          # Bulk Score Checker UI
│   ├── app.js               # batching, progress bar, table, CSV/PDF export
│   ├── audit.html           # Full Site Audit UI
│   ├── audit.js             # crawl loop, on-page scoring, table, PDF export
│   └── style.css
├── package.json
└── .gitignore
```

## Step 1 — Push this to GitHub

```bash
cd bulk-score-checker
git init
git add .
git commit -m "Initial commit: bulk site score checker"
```

Then create a new empty repo on GitHub (github.com/new — do NOT initialize
it with a README), and push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/bulk-score-checker.git
git branch -M main
git push -u origin main
```

## Step 2 — Connect Cloudflare Pages to that repo

1. Go to the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize Cloudflare to access your GitHub account and pick this repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `public`
4. Click **Save and Deploy**.

Cloudflare will build and deploy automatically. Every future `git push` to
`main` triggers a new deployment — no manual redeploy needed.

Your app will be live at something like:
`https://bulk-score-checker.pages.dev`

You can later attach your own domain for free under the Pages project's
**Custom domains** tab.

## Step 3 (optional) — Test locally before pushing

```bash
npm install
npm run dev
```

This runs the app at `http://localhost:8788` using Cloudflare's local
emulator (`wrangler pages dev`), so you can try changes before deploying.

## Notes & limits

- **Rate limiting target sites**: this tool sends real HTTP requests to every
  URL you check. Be considerate with volume and frequency — don't hammer the
  same domain over and over in a short time.
- **RDAP domain-age lookups** can occasionally return nothing for
  privacy-protected domains — the tool just treats age as "unknown" in that
  case rather than failing the whole check.
- **Cloudflare free plan limits** (as of this writing): 100,000 requests/day,
  50 subrequests per invocation. For normal bulk-checking use (even several
  thousand URLs a day) this comfortably stays within free tier. If you scale
  way up, Cloudflare's paid Workers plan raises the subrequest limit to 1000
  per invocation, letting you raise `MAX_BATCH_SIZE` in `check.js` and cut
  down the number of API calls needed.
