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
const DIGEST_MAX = 6; // headlines to include in the one daily push
const SEEN_CAP = 1000; // bound the size of seen.json

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function sendDigest(items) {
  const shown = items.slice(0, DIGEST_MAX);
  const lines = shown.map((it, i) => `${i + 1}. ${it.title} — ${it.source}`);
  if (items.length > shown.length) {
    lines.push(`…and ${items.length - shown.length} more`);
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
      message: lines.join("\n"),
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
