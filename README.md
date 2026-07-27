# SEO Toolkit — Bulk Score Checker + Full Site Audit

One free website, two tools, deployed as a Cloudflare Worker with static assets
(Cloudflare's current recommended way to host a site like this — it replaced
the old "Pages" flow for new projects, though it works the same way from your
side: push to GitHub, it deploys automatically).

1. **Bulk Score Checker** (`/`) — paste 1000+ URLs, get estimated Authority Score (DA-style),
   Trust Score (DR-style), and Spam Score for every one — export as CSV or PDF.
2. **Full Site Audit** (`/audit`) — enter one site, it crawls the whole thing and reports
   Technical SEO, Indexability, and On-Page SEO (meta title/description scoring, duplicate
   detection) — export as a full PDF report.

## If you already connected GitHub to Cloudflare

You don't need to redo anything in the Cloudflare dashboard. Just replace the contents of
your GitHub repo with everything in this folder, push, and Cloudflare will automatically
redeploy using the new `wrangler.jsonc` file, which tells it how to run this project correctly.

### How to replace the files in your existing repo (using GitHub Desktop)

1. Open **GitHub Desktop** → make sure your `bulk-score-checker` repo is selected
2. Open that repo's folder on your computer (GitHub Desktop → Repository menu → "Show in Explorer/Finder")
3. **Delete everything inside that folder** (all old files/folders, including the old `functions` folder)
4. Copy **everything from this new folder** into it instead
5. Go back to GitHub Desktop — it will list all the changes on the left
6. Type a commit message like "switch to Worker with static assets", click **Commit to main**
7. Click **Push origin**
8. Go to your Cloudflare dashboard → your project → **Deployments** tab — a new deployment should
   start automatically within a few seconds. Wait for it to finish (green checkmark).
9. Click **Visit** — your site should now load properly, and the Full Site Audit page should work.

## Honest disclaimer about the scores

Real Moz Domain Authority, Ahrefs Domain Rating, and Moz Spam Score come from proprietary
backlink databases that cost money to access. There is no free, legitimate way to pull those
exact numbers. This tool calculates its own **estimated** scores from free public signals: SSL
validity, domain age (via RDAP), robots.txt/sitemap.xml presence, response health, basic on-page
signals, and TLD reputation. Useful as a directional health check — will **not match** moz.com or
ahrefs.com exactly.

**Indexability** (Full Site Audit page): checks whether a page is *allowed* to be indexed
(`noindex` tags, `X-Robots-Tag` headers, robots.txt rules) — NOT a live check of whether Google
has actually indexed it (that needs Google Search Console, free but only for verified site owners).

**Off-page SEO / backlinks**: no free tool can legitimately provide real backlink data — that
needs a paid service (Ahrefs, Moz, Semrush).

## How the Full Site Audit crawls a whole site within free-tier limits

Crawling means following links you don't know about until you fetch the page, so it can't be
pre-split into batches. Instead:

1. `/api/site-info` runs once at the start — fetches robots.txt, sitemap.xml, and domain age.
2. `/api/crawl-batch` processes ~15 pages per call, discovers new internal links as it goes, and
   returns the updated "frontier" (undiscovered pages) and "visited" list.
3. The frontend calls `/api/crawl-batch` again and again, feeding back the frontier/visited each
   time, until the frontier is empty or your page limit is hit.

You just click "Start Full Audit" and watch the progress bar — this happens automatically.

**Not included in the web version:** verified broken-link checking (would multiply outbound
requests by every link on every page — not viable on free tier).

## Project structure

```
bulk-score-checker/
├── wrangler.jsonc          # tells Cloudflare this is a Worker + where the static site lives
├── src/
│   ├── index.js            # the Worker: routes /api/* requests, serves static files otherwise
│   ├── scoring.js          # bulk-checker scoring logic
│   └── crawlerCore.js      # full-site-audit crawl + page analysis logic
├── public/
│   ├── index.html          # Bulk Score Checker UI
│   ├── app.js
│   ├── audit.html          # Full Site Audit UI
│   ├── audit.js
│   └── style.css
├── package.json
└── .gitignore
```

## Setting this up from scratch (if you haven't connected GitHub yet)

### Step 1 — Push to GitHub

```bash
cd bulk-score-checker
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### Step 2 — Connect Cloudflare

1. Cloudflare dashboard → **Workers & Pages** → **Create**
2. Choose **Continue with GitHub**, authorize, pick your repo
3. Cloudflare will detect `wrangler.jsonc` automatically and deploy correctly as a Worker
   with static assets — no manual build settings needed this time
4. Wait for the deploy to finish, then click **Visit**

### Step 3 (optional) — Test locally before pushing

```bash
npm install
npm run dev
```

Runs at `http://localhost:8788` using Wrangler's local emulator.

## Notes & limits

- Be considerate with request volume — this tool sends real HTTP requests to every URL/site you check.
- RDAP domain-age lookups can return nothing for privacy-protected domains — treated as "unknown," not a failure.
- Cloudflare free plan: 100,000 requests/day, 50 outbound subrequests per invocation — comfortably enough for normal use of both tools.
