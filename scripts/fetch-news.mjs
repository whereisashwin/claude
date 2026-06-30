#!/usr/bin/env node
// Fetches Australian Federal Budget news from Google News RSS feeds and writes
// data/news.json. Zero dependencies — uses Node's built-in fetch (Node 18+).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "news.json");

// Search queries aimed at the Australian Federal Budget. Google News RSS lets us
// aggregate many outlets (ABC, AFR, The Guardian, SMH, etc.) from one place.
const QUERIES = [
  "Australian federal budget",
  "Australia budget Chalmers treasury",
  "federal budget Australia tax",
  "Australia budget deficit surplus forecast",
];

const GOOGLE_NEWS = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(
    q
  )}&hl=en-AU&gl=AU&ceid=AU:en`;

const MAX_ITEMS = 80;
const USER_AGENT =
  "Mozilla/5.0 (compatible; aus-budget-tracker/1.0; +https://github.com/whereisashwin/aus-budget-tracker)";

function decodeEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

function stripTags(html = "") {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function parseItems(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const rawTitle = tag(block, "title");
    const link = tag(block, "link");
    const pubDate = tag(block, "pubDate");
    const source = tag(block, "source") || "";
    const description = stripTags(tag(block, "description"));

    if (!rawTitle || !link) continue;

    // Google News titles look like "Headline - Source". Split the outlet off.
    let title = rawTitle;
    let outlet = source;
    const dashIdx = rawTitle.lastIndexOf(" - ");
    if (dashIdx > 0) {
      title = rawTitle.slice(0, dashIdx).trim();
      if (!outlet) outlet = rawTitle.slice(dashIdx + 3).trim();
    }

    const published = pubDate ? new Date(pubDate) : null;
    items.push({
      title,
      url: link,
      source: outlet || "Unknown",
      publishedAt:
        published && !Number.isNaN(published.getTime())
          ? published.toISOString()
          : null,
      summary: description || "",
    });
  }
  return items;
}

function normaliseKey(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFeed(query) {
  const url = GOOGLE_NEWS(query);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, text/xml" },
    });
    if (!res.ok) {
      console.warn(`  ! ${query}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = parseItems(xml).map((it) => ({ ...it, query }));
    console.log(`  ✓ ${query}: ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`  ! ${query}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log("Fetching Australian Federal Budget news…");
  const all = [];
  for (const q of QUERIES) {
    all.push(...(await fetchFeed(q)));
  }

  // Deduplicate by normalised title, keeping the earliest-seen entry.
  const seen = new Map();
  for (const item of all) {
    const key = normaliseKey(item.title);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, item);
  }

  const items = [...seen.values()]
    .sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    })
    .slice(0, MAX_ITEMS);

  const sources = [...new Set(items.map((i) => i.source))].sort();

  const payload = {
    updatedAt: new Date().toISOString(),
    count: items.length,
    queries: QUERIES,
    sources,
    items,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${items.length} items from ${sources.length} sources to ${OUT}`);
}

main().catch((err) => {
  console.error("Failed to fetch news:", err);
  process.exit(1);
});
