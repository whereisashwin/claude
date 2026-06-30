# 🇦🇺 Australian Federal Budget Tracker

A zero-cost, zero-server live dashboard that tracks **Australian Federal Budget
news as it happens**. A scheduled GitHub Action pulls fresh headlines from Google
News RSS every 30 minutes and commits them as JSON; a static page renders the
feed and auto-refreshes in the browser. Hosted free on GitHub Pages.

![tracker](https://img.shields.io/badge/updates-every%2030%20min-00843D)

## How it works

```
GitHub Actions (cron, every 30 min)
        │  runs scripts/fetch-news.mjs
        ▼
   data/news.json  ──commit──▶  main branch
        │
        ▼
  GitHub Pages serves index.html + assets/app.js
        │  fetches data/news.json (auto-refresh every 5 min)
        ▼
        Your live dashboard
```

- **`scripts/fetch-news.mjs`** — zero-dependency Node script. Queries Google News
  RSS for several budget-related searches, dedupes, sorts by recency, and writes
  `data/news.json`.
- **`index.html` / `assets/`** — the dashboard. Search, filter by source,
  highlights stories from the last 6 hours, refreshes itself every 5 minutes.
- **`.github/workflows/update-news.yml`** — the cron job that refreshes the feed.
- **`.github/workflows/deploy-pages.yml`** — deploys the site to GitHub Pages.

## Setup (one-time)

1. **Enable GitHub Pages**
   - Repo **Settings → Pages**
   - **Source:** _GitHub Actions_
   - The `Deploy to GitHub Pages` workflow publishes your site on every push.

2. **Enable Actions write access** (needed so the cron job can commit the feed)
   - Repo **Settings → Actions → General → Workflow permissions**
   - Select **Read and write permissions** → Save.

3. **Kick off the first run** (optional — it also runs on schedule)
   - **Actions** tab → _Update budget news_ → **Run workflow**.

Your dashboard will be live at `https://<your-username>.github.io/aus-budget-tracker/`.

## Run locally

```bash
node scripts/fetch-news.mjs       # refresh data/news.json
python3 -m http.server 8000       # then open http://localhost:8000
```

## Customise

- **Change the topics:** edit the `QUERIES` array in `scripts/fetch-news.mjs`.
- **Change the cadence:** edit the `cron` schedule in
  `.github/workflows/update-news.yml` (note: GitHub's minimum is ~5 min and
  scheduled runs can be delayed under load).
- **Change the look:** everything visual lives in `assets/style.css`.

## Notes

- Headlines and links are aggregated via Google News RSS and point to the
  original publishers. No content is copied or stored beyond title, link,
  source, date, and snippet.
- Scheduled Actions run in UTC and may be delayed during peak GitHub load.
