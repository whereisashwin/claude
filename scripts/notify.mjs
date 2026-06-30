#!/usr/bin/env node
// Sends a push notification (via ntfy.sh) for each NEW story that's relevant to
// the focus topics. Tracks what's already been sent in data/seen.json so you
// only ever get pinged once per story. Zero dependencies.
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
const MAX_PER_RUN = 5; // intentional: only the spiciest few per run
const SEEN_CAP = 800; // bound the size of seen.json

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function push(item) {
  const cats = (item.categories || []).join(", ") || "Budget";
  // Self-contained body: the real summary if we have one, else topic + source.
  const message = item.summary
    ? `${item.summary}\n\n— ${item.source}`
    : `${cats} · ${item.source}`;
  // Publish as JSON so UTF-8 (curly quotes, em dashes, $) survives — putting
  // these in HTTP headers throws in Node's fetch.
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: TOPIC,
      title: item.title,
      message,
      click: item.url,
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

  // Only the spicy, relevant, not-yet-seen stories — highest score first.
  const fresh = news.items
    .filter((i) => i.relevant && i.spicy && i.url && !seen.has(i.url))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  // Record every current URL as seen (relevant or not) so the feed converges.
  const allUrls = news.items.map((i) => i.url).filter(Boolean);
  const merged = [...new Set([...allUrls, ...seen])].slice(0, SEEN_CAP);
  await writeFile(
    SEEN,
    JSON.stringify({ updatedAt: news.updatedAt, urls: merged }, null, 2) + "\n",
    "utf8"
  );

  if (isFirstRun) {
    console.log(
      `Seeded seen.json with ${merged.length} URLs — no notifications on first run.`
    );
    return;
  }
  if (!TOPIC) {
    console.log("NTFY_TOPIC not set — skipping push (seen.json still updated).");
    return;
  }
  if (fresh.length === 0) {
    console.log("No new relevant stories to notify.");
    return;
  }

  const toSend = fresh.slice(0, MAX_PER_RUN);
  let sent = 0;
  for (const item of toSend) {
    try {
      await push(item);
      sent++;
      console.log(`  → notified: ${item.title}`);
    } catch (err) {
      console.warn(`  ! failed to notify "${item.title}": ${err.message}`);
    }
  }

  if (fresh.length > toSend.length) {
    const extra = fresh.length - toSend.length;
    try {
      await fetch(`${SERVER}/${TOPIC}`, {
        method: "POST",
        headers: {
          Title: "More budget updates",
          Click: "https://whereisashwin.github.io/claude/",
          Tags: "newspaper",
        },
        body: `+${extra} more relevant stories — open the tracker to see them.`,
      });
    } catch {
      /* best effort */
    }
  }

  console.log(`Done. Sent ${sent} notification(s).`);
}

main().catch((err) => {
  console.error("Notifier failed:", err);
  process.exit(1);
});
