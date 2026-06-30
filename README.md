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
  RSS, dedupes, tags each story by topic (Tax, Housing, Family & Education,
  Visas & Migration, Cost of living), flags the relevant ones, and writes
  `data/news.json`.
- **`scripts/notify.mjs`** — sends a phone push (via ntfy.sh) for each **new**
  relevant story. Tracks what's already been sent in `data/seen.json` so you're
  pinged once per story.
- **`index.html` / `assets/`** — the dashboard. Topic chips, a default
  "For you" view, search, filter by source, category tags, highlights stories
  from the last 6 hours, and optional browser notifications. Refreshes itself
  every 5 minutes.
- **`.github/workflows/update-news.yml`** — the cron job that refreshes the feed
  and fires push notifications.

## 🔔 Push notifications (ntfy)

New relevant stories are pushed to your phone via [ntfy.sh](https://ntfy.sh) —
free, no account needed:

1. Install the **ntfy** app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) /
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. Subscribe to the topic set in `NTFY_TOPIC` (see `update-news.yml`).
3. You'll get a push only for **high-impact ("spicy")** new stories in your
   topics (tax / housing / family / visa / cost-of-living). Each push is
   self-contained — headline + a one-line summary — and tapping it opens the
   article.

**How "spicy" is decided** (`scripts/fetch-news.mjs`): each story is scored on
impact words (cut, hike, scrap, $ figures…), source quality, and how many of
your topics it hits; a denylist drops off-topic noise. Tune the bar with the
`SPICE_THRESHOLD` env var (default 5 — higher = fewer, hotter alerts).

The topic lives in the workflow's `env`. Because this repo is public, anyone who
reads it could subscribe to (or spam) the topic — to lock it down, move it to an
Actions secret named `NTFY_TOPIC` and reference `${{ secrets.NTFY_TOPIC }}`.
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
