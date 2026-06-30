// Front-end for the Australian Federal Budget Tracker.
// Loads data/news.json (refreshed by GitHub Actions) and renders a live feed.

const REFRESH_MS = 5 * 60 * 1000; // re-fetch the JSON every 5 minutes
const FRESH_MS = 6 * 60 * 60 * 1000; // highlight stories newer than 6 hours

const els = {
  feed: document.getElementById("feed"),
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  search: document.getElementById("search"),
  sourceFilter: document.getElementById("source-filter"),
  empty: document.getElementById("empty"),
  refresh: document.getElementById("refresh"),
  lastUpdated: document.getElementById("last-updated"),
};

let allItems = [];
let dataUpdatedAt = null;

function relativeTime(iso) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function isFresh(iso) {
  if (!iso) return false;
  const then = Date.parse(iso);
  return !Number.isNaN(then) && Date.now() - then < FRESH_MS;
}

function escapeHtml(s = "") {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function showSkeletons() {
  els.feed.innerHTML = Array.from({ length: 5 })
    .map(() => '<div class="skeleton"></div>')
    .join("");
}

function render() {
  const term = els.search.value.trim().toLowerCase();
  const source = els.sourceFilter.value;

  const filtered = allItems.filter((item) => {
    if (source && item.source !== source) return false;
    if (
      term &&
      !`${item.title} ${item.summary || ""} ${item.source}`
        .toLowerCase()
        .includes(term)
    )
      return false;
    return true;
  });

  els.empty.hidden = filtered.length > 0;
  els.count.textContent = `${filtered.length} ${
    filtered.length === 1 ? "story" : "stories"
  }`;

  els.feed.innerHTML = filtered
    .map((item) => {
      const fresh = isFresh(item.publishedAt);
      const when = relativeTime(item.publishedAt);
      return `
        <article class="card${fresh ? " fresh" : ""}">
          <h2><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
            ${escapeHtml(item.title)}
          </a></h2>
          <div class="meta">
            <span class="badge">${escapeHtml(item.source)}</span>
            ${when ? `<span>${when}</span>` : ""}
            ${fresh ? '<span class="fresh-tag">New</span>' : ""}
          </div>
        </article>`;
    })
    .join("");
}

function populateSources() {
  const sources = [...new Set(allItems.map((i) => i.source))].sort((a, b) =>
    a.localeCompare(b)
  );
  const current = els.sourceFilter.value;
  els.sourceFilter.innerHTML =
    '<option value="">All sources</option>' +
    sources
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
  if (sources.includes(current)) els.sourceFilter.value = current;
}

async function load() {
  try {
    els.status.textContent = "Refreshing…";
    const res = await fetch(`./data/news.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allItems = Array.isArray(data.items) ? data.items : [];
    dataUpdatedAt = data.updatedAt || null;

    populateSources();
    render();

    els.status.className = "status live";
    els.status.textContent = `Live · ${allItems.length} stories`;
    if (dataUpdatedAt) {
      els.lastUpdated.textContent = `Feed last updated ${new Date(
        dataUpdatedAt
      ).toLocaleString("en-AU")}`;
    }
  } catch (err) {
    els.status.className = "status";
    els.status.textContent = "Couldn't load news feed.";
    if (allItems.length === 0) {
      els.feed.innerHTML = `<div class="empty"><p>Unable to load the news feed.<br><small>${escapeHtml(
        err.message
      )}</small></p></div>`;
    }
  }
}

els.search.addEventListener("input", render);
els.sourceFilter.addEventListener("change", render);
els.refresh.addEventListener("click", load);

showSkeletons();
load();
setInterval(load, REFRESH_MS);
