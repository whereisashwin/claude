#!/usr/bin/env node
// Sends ONE daily digest push (via ntfy.sh) rounding up the day's new spicy,
// relevant budget stories. Tracks what's already been sent in data/seen.json so
// each story is only ever included once. Zero dependencies.
//
// Env:
//   NTFY_TOPIC   - the ntfy topic to publish to (required to actually send)
//   NTFY_SERVER  - ntfy base URL (default https://ntfy.sh)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NEWS = join(ROOT, "data", "news.json");
const SEEN = join(ROOT, "data", "seen.json");

const SERVER = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
const TOPIC = process.env.NTFY_TOPIC || "";
const SITE = "https://whereisashwin.github.io/claude/";
const DIGEST_MAX = 5; // stories to include in the one daily push
const SUMMARY_MAX = 180; // chars of summary per story in the digest
const SEEN_CAP = 1000; // bound the size of seen.json

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function trimSummary(s) {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= SUMMARY_MAX) return clean;
  // Cut on a word boundary and add an ellipsis.
  return clean.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "") + "…";
}

async function sendDigest(items) {
  // Prefer stories that carry a real summary so each entry is self-contained,
  // but keep score order within that.
  const ordered = [...items].sort((a, b) => {
    const bySummary = (b.summary ? 1 : 0) - (a.summary ? 1 : 0);
    return bySummary || (b.score || 0) - (a.score || 0);
  });
  const shown = ordered.slice(0, DIGEST_MAX);

  // Each entry: headline, a one-line summary, then the source — self-contained.
  const blocks = shown.map((it, i) => {
    const summary = trimSummary(it.summary);
    const body = summary || (it.categories || []).join(", ") || "Budget";
    return `${i + 1}. ${it.title}\n${body}\n— ${it.source}`;
  });
  if (items.length > shown.length) {
    blocks.push(`＋ ${items.length - shown.length} more on the tracker`);
  }

  const today = new Date().toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: TOPIC,
      title: `🌶️ Budget digest · ${today} · ${items.length} for you`,
      message: blocks.join("\n\n"),
      click: SITE,
      tags: ["fire", "moneybag"],
      priority: 4,
    }),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

async function main() {
  const news = await readJson(NEWS, null);
  if (!news || !Array.isArray(news.items)) {
    console.error("No news.json to read.");
    process.exit(1);
  }

  const seenState = await readJson(SEEN, null);
  const isFirstRun = !seenState || !Array.isArray(seenState.urls);
  const seen = new Set(isFirstRun ? [] : seenState.urls);

  // The day's new spicy, relevant stories — highest score first.
  const fresh = news.items
    .filter((i) => i.relevant && i.spicy && i.url && !seen.has(i.url))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  // Mark every current URL seen so nothing repeats in tomorrow's digest.
  const allUrls = news.items.map((i) => i.url).filter(Boolean);
  const merged = [...new Set([...allUrls, ...seen])].slice(0, SEEN_CAP);
  await writeFile(
    SEEN,
    JSON.stringify({ updatedAt: news.updatedAt, urls: merged }, null, 2) + "\n",
    "utf8"
  );

  if (isFirstRun) {
    console.log(
      `Seeded seen.json with ${merged.length} URLs — no digest on first run.`
    );
    return;
  }
  if (!TOPIC) {
    console.log("NTFY_TOPIC not set — skipping push (seen.json still updated).");
    return;
  }
  if (fresh.length === 0) {
    console.log("No new spicy stories today — no digest sent.");
    return;
  }

  await sendDigest(fresh);
  console.log(`Sent daily digest with ${fresh.length} stor(y/ies).`);
}

main().catch((err) => {
  console.error("Notifier failed:", err);
  process.exit(1);
});
