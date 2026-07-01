#!/usr/bin/env node
// Fetches Australian Federal Budget news, tags each story by topic, scores how
// "spicy" (high-impact/newsworthy) it is, flags the ones relevant to a new
// immigrant household, and writes data/news.json. Zero dependencies.
//
// Two source types:
//   * Google News RSS search  -> breadth (headline only, redirect links)
//   * Publisher RSS feeds      -> quality + real summaries + direct links
// When the same story appears in both, the publisher version (with a summary)
// wins, so notifications can be self-contained.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "news.json");

const SPICE_THRESHOLD = Number(process.env.SPICE_THRESHOLD || 5);
const MAX_ITEMS = 120;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

// Reputable feeds that include real <description> summaries + direct links.
const FEEDS = [
  { url: "https://www.theguardian.com/au/business/rss", source: "The Guardian" },
  {
    url: "https://www.theguardian.com/australia-news/australian-politics/rss",
    source: "The Guardian",
  },
  { url: "https://www.theguardian.com/money/tax/rss", source: "The Guardian" },
  { url: "https://www.theguardian.com/au/money/rss", source: "The Guardian" },
  {
    url: "https://www.theguardian.com/australia-news/immigration-and-asylum/rss",
    source: "The Guardian",
  },
  { url: "https://www.abc.net.au/news/feed/51892/rss.xml", source: "ABC News" },
  { url: "https://www.abc.net.au/news/feed/45910/rss.xml", source: "ABC News" },
  { url: "https://www.smh.com.au/rss/business.xml", source: "Sydney Morning Herald" },
  { url: "https://www.smh.com.au/rss/politics/federal.xml", source: "Sydney Morning Herald" },
];

const CATEGORIES = [
  {
    key: "Visas & Migration",
    focus: true,
    terms: [
      "visa", "visas", "immigration", "immigrant", "migrant", "migration",
      "skilled migration", "permanent residen", "citizenship", "citizen",
      "international student", "home affairs", "refugee", "asylum",
      "points test", "partner visa", "working holiday", "subclass",
      "migration intake", "deportation",
    ],
  },
  {
    key: "Tax",
    focus: true,
    terms: [
      "tax", "ato", "deduction", "offset", "negative gearing", "capital gains",
      "cgt", "gst", "tax bracket", "income tax", "levy", "franking",
      "superannuation", "stage 3", "stage three", "tax cut",
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

// "Spice" signals — words that mark a story as consequential, not procedural.
const IMPACT = [
  "scrap", "axe", "cut", "slash", "hike", "surge", "soar", "crackdown",
  "overhaul", "ban", "freeze", "cap", "raise", "warn", "backlash", "broken",
  "fail", "blow", "shock", "block", "reject", "dump", "gut", "slug", "pain",
  "boost", "deadline", "eligible", "reform", "raid", "gouge", "sting",
  "windfall", "handout", "scandal", "revolt", "tax cut", "rate cut",
  "first home", "what it means", "how much", "explained", "negative gearing",
  "capital gains", "cost of living", "energy rebate", "interest rate",
];
const MONEY = /\$|\bper cent\b|%|\bbillion\b|\bmillion\b|\bbn\b/i;
// Off-topic for a budget tracker even when a category keyword matches.
const NOISE = [
  "spacex", "fossil fuel", "climate", "football", "cricket", "afl", "nrl",
  "rugby", "tennis", "olympic", "celebrity", "royal", "recipe", "gaming",
  "horoscope", "weather", "soccer", "matildas",
];
const REPUTABLE = [
  "abc", "australian broadcasting", "financial review", "afr", "guardian",
  "sydney morning herald", "the age", "news.com.au", "sbs", "the conversation",
  "sky news", "9news", "7news", "the australian", "canberra times", "crikey",
  "the new daily", "reuters", "bloomberg", "treasury", "home affairs",
];

function decodeEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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

// Match a term at a word start (boundary before, suffix allowed) so "tax" hits
// "taxpayer" but "500" doesn't hit "$500,000" and "labor" doesn't hit
// "elaborate". Terms may be multi-word phrases.
const termCache = new Map();
function hasTerm(hay, term) {
  let re = termCache.get(term);
  if (!re) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^a-z0-9])${esc}`, "i");
    termCache.set(term, re);
  }
  return re.test(hay);
}

// Guardian/ABC live-blog summaries trail into promo boilerplate — cut it off.
const BOILERPLATE = [
  "Follow today", "Get our breaking news", "Follow our Australia news",
  "Sign up ", "free app or daily", "Follow the day", "Read more", "Follow live",
];
function scrubSummary(s = "") {
  let cut = s.length;
  for (const marker of BOILERPLATE) {
    const idx = s.indexOf(marker);
    if (idx >= 0) cut = Math.min(cut, idx);
  }
  const out = s.slice(0, cut).trim();
  // If cutting boilerplate leaves too little, drop the summary entirely.
  return out.length >= 40 ? out : "";
}

function categorise(text) {
  const hay = text.toLowerCase();
  return CATEGORIES.filter((c) => c.terms.some((t) => hasTerm(hay, t))).map(
    (c) => c.key
  );
}

function scoreItem({ title, summary, source, categories, publishedAt }) {
  const hay = `${title} ${summary}`.toLowerCase();
  let s = 0;
  let kw = 0;
  for (const t of IMPACT) if (hasTerm(hay, t)) kw++;
  s += Math.min(kw, 3) * 2; // up to +6
  if (MONEY.test(`${title} ${summary}`)) s += 3;
  if (REPUTABLE.some((r) => source.toLowerCase().includes(r))) s += 3;
  if (categories.length >= 2) s += 2;
  if (publishedAt && Date.now() - Date.parse(publishedAt) < 12 * 3600 * 1000)
    s += 1;
  return s;
}

// Signals that a story is actually about Australia (used to gate the general
// publisher feeds, which also carry UK/US business news).
const AU_SIGNALS = [
  "australia", "australian", "albanese", "chalmers", "labor", "coalition",
  "greens", "one nation", "canberra", "nsw", "new south wales", "victoria",
  "victorian", "queensland", "western australia", "south australia", "tasmania",
  "centrelink", "medicare", "ato", "hecs", "negative gearing", "superannuation",
  "commonwealth", "treasury", "reserve bank", "rba", "ndis", "aussie",
];
function isAustralian(text) {
  const hay = text.toLowerCase();
  return AU_SIGNALS.some((t) => hasTerm(hay, t));
}

// Attach categories / relevance / spice score to a raw item.
function finalize(item) {
  const text = `${item.title} ${item.summary}`;
  const hay = text.toLowerCase();
  const categories = categorise(text);
  let impactCount = 0;
  for (const t of IMPACT) if (hay.includes(t)) impactCount++;
  const money = MONEY.test(text);
  const score = scoreItem({ ...item, categories });

  item.categories = categories;
  item.relevant = categories.some((c) => FOCUS.has(c));
  item.score = score;
  // "Spicy" = clears the score bar AND shows a concrete signal (a dollar
  // figure, multiple impact words, or hits more than one of your topics) — so a
  // reputable byline alone can't push an off-topic story through.
  const noisy = NOISE.some((n) => hay.includes(n));
  item.spicy =
    item.relevant &&
    !noisy &&
    score >= SPICE_THRESHOLD &&
    (money || impactCount >= 2 || categories.length >= 2);
  return item;
}

function parseItems(xml, defaultSource) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const rawTitle = tag(block, "title");
    const link = tag(block, "link");
    const pubDate = tag(block, "pubDate");
    const srcTag = tag(block, "source");
    const summary = scrubSummary(stripTags(tag(block, "description"))).slice(0, 300);
    if (!rawTitle || !link) continue;

    let title = rawTitle;
    let source = srcTag || defaultSource || "";
    // Google News titles read "Headline - Source"; split the outlet off.
    const dashIdx = rawTitle.lastIndexOf(" - ");
    if (!defaultSource && dashIdx > 0) {
      title = rawTitle.slice(0, dashIdx).trim();
      if (!source) source = rawTitle.slice(dashIdx + 3).trim();
    }

    const published = pubDate ? new Date(pubDate) : null;
    const publishedAt =
      published && !Number.isNaN(published.getTime())
        ? published.toISOString()
        : null;
    // Google News descriptions are just "Headline  Source" — junk. Keep a
    // summary only when it's real prose (doesn't just restate the headline).
    const nk = normaliseKey(title);
    const ns = normaliseKey(summary);
    const cleanSummary = !summary || ns === nk || ns.startsWith(nk) ? "" : summary;

    items.push({
      title,
      url: link,
      source: source || "Unknown",
      publishedAt,
      summary: cleanSummary,
    });
  }
  return items;
}

// Fetch via curl — many publishers (Guardian, ABC, SMH) block Node's fetch
// fingerprint with a 403, but allow curl with a browser User-Agent.
async function fetchUrl(url, defaultSource, label) {
  try {
    const { stdout } = await execFileP(
      "curl",
      ["-sL", "-A", USER_AGENT, "--max-time", "25", url],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    const items = parseItems(stdout, defaultSource);
    console.log(`  ✓ ${label}: ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`  ! ${label}: ${err.message}`);
    return [];
  }
}

function normaliseKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

async function main() {
  console.log("Fetching Australian Federal Budget news…");

  // 1) Google News search = the Australian, budget-scoped base set of stories.
  const base = new Map();
  for (const q of QUERIES) {
    for (const item of await fetchUrl(GOOGLE_NEWS(q), "", q)) {
      const key = normaliseKey(item.title);
      if (key && !base.has(key)) base.set(key, item);
    }
  }

  // 2) Reputable publisher feeds = real summaries + direct links. Use them to
  //    enrich a matching base story; only add a publisher story on its own when
  //    it's clearly Australian (these feeds also carry UK/US business news).
  for (const f of FEEDS) {
    for (const pub of await fetchUrl(f.url, f.source, f.source)) {
      const key = normaliseKey(pub.title);
      if (!key) continue;
      const ex = base.get(key);
      if (ex) {
        if (pub.summary && !ex.summary) ex.summary = pub.summary;
        if (ex.url.includes("news.google") && !pub.url.includes("news.google"))
          ex.url = pub.url;
        if (pub.source) ex.source = pub.source;
      } else if (isAustralian(`${pub.title} ${pub.summary}`)) {
        base.set(key, pub);
      }
    }
  }

  // 3) Score + categorise everything.
  const items = [...base.values()]
    .map(finalize)
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
    spicyCount: items.filter((i) => i.relevant && i.spicy).length,
    spiceThreshold: SPICE_THRESHOLD,
    categories: CATEGORIES.map((c) => c.key),
    focus: [...FOCUS],
    queries: QUERIES,
    sources,
    items,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `\nWrote ${items.length} items (${payload.relevantCount} relevant, ` +
      `${payload.spicyCount} spicy) from ${sources.length} sources.`
  );
}

main().catch((err) => {
  console.error("Failed to fetch news:", err);
  process.exit(1);
});
