#!/usr/bin/env node
// Fetches Australian Federal Budget news from Google News RSS feeds, tags each
// story by topic, flags the ones relevant to a new-immigrant household, and
// writes data/news.json. Zero dependencies — uses Node's built-in fetch.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "news.json");

// Searches anchored to the Budget but broadened to the things that actually
// affect a new immigrant family: tax, housing, family/education, and visas.
const QUERIES = [
  "Australian federal budget",
  "Australia budget Chalmers treasury",
  "federal budget Australia tax changes",
  "Australia budget housing affordability",
  "Australia budget childcare family payments",
  "Australia skilled migration visa changes 2026",
  "Australia immigration policy budget",
  "Australia cost of living relief budget",
];

const GOOGLE_NEWS = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(
    q
  )}&hl=en-AU&gl=AU&ceid=AU:en`;

const MAX_ITEMS = 100;
const USER_AGENT =
  "Mozilla/5.0 (compatible; aus-budget-tracker/1.0; +https://github.com/whereisashwin/claude)";

// Topic categories, matched against the headline (case-insensitive). An item
// can belong to several. The ones flagged focus:true make up the "for you"
// set used by the dashboard and the push notifier.
const CATEGORIES = [
  {
    key: "Visas & Migration",
    focus: true,
    terms: [
      "visa", "visas", "immigration", "immigrant", "migrant", "migration",
      "skilled migration", "permanent residen", "citizenship", "citizen",
      "international student", "home affairs", "border", "refugee",
      "points test", "partner visa", "working holiday", "187", "189", "190",
      "191", "482", "491", "500", "subclass", "intake", "deportation",
    ],
  },
  {
    key: "Tax",
    focus: true,
    terms: [
      "tax", "ato", "deduction", "offset", "negative gearing", "capital gains",
      "cgt", "gst", "tax bracket", "income tax", "levy", "franking",
      "superannuation", "super ", "stage 3", "stage three", "tax cut",
    ],
  },
  {
    key: "Housing",
    focus: true,
    terms: [
      "housing", "rent", "rental", "mortgage", "property", "first home",
      "home buyer", "homebuyer", "dwelling", "build to rent", "social housing",
      "affordab", "deposit", "homeowner", "house price", "real estate",
    ],
  },
  {
    key: "Family & Education",
    focus: true,
    terms: [
      "childcare", "child care", "family tax", "paid parental", "parental leave",
      "school", "education", "university", "hecs", "help debt", "daycare",
      "kindergarten", "family payment", "ccs", "student", "baby bonus", "children",
    ],
  },
  {
    key: "Cost of living",
    focus: true,
    terms: [
      "cost of living", "energy rebate", "electricity", "power bill", "inflation",
      "grocery", "groceries", "fuel", "rebate", "relief", "wage", "medicare",
      "bulk billing", "pharmaceutical", "pbs",
    ],
  },
];

const FOCUS = new Set(CATEGORIES.filter((c) => c.focus).map((c) => c.key));

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

function categorise(title) {
  const hay = title.toLowerCase();
  return CATEGORIES.filter((cat) => cat.terms.some((t) => hay.includes(t))).map(
    (c) => c.key
  );
}

function parseItems(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const rawTitle = tag(block, "title");
    const link = tag(block, "link");
    const pubDate = tag(block, "pubDate");
    const source = tag(block, "source") || "";
    if (!rawTitle || !link) continue;

    let title = rawTitle;
    let outlet = source;
    const dashIdx = rawTitle.lastIndexOf(" - ");
    if (dashIdx > 0) {
      title = rawTitle.slice(0, dashIdx).trim();
      if (!outlet) outlet = rawTitle.slice(dashIdx + 3).trim();
    }

    const categories = categorise(title);
    const published = pubDate ? new Date(pubDate) : null;
    items.push({
      title,
      url: link,
      source: outlet || "Unknown",
      publishedAt:
        published && !Number.isNaN(published.getTime())
          ? published.toISOString()
          : null,
      categories,
      relevant: categories.some((c) => FOCUS.has(c)),
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
    const items = parseItems(await res.text()).map((it) => ({ ...it, query }));
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
  for (const q of QUERIES) all.push(...(await fetchFeed(q)));

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
    relevantCount: items.filter((i) => i.relevant).length,
    categories: CATEGORIES.map((c) => c.key),
    focus: [...FOCUS],
    queries: QUERIES,
    sources,
    items,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `\nWrote ${items.length} items (${payload.relevantCount} relevant) ` +
      `from ${sources.length} sources to ${OUT}`
  );
}

main().catch((err) => {
  console.error("Failed to fetch news:", err);
  process.exit(1);
});
