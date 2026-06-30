// Front-end for the Australian Federal Budget Tracker.
// Loads data/news.json (refreshed by GitHub Actions) and renders a live feed,
// with topic chips, a "For you" view, and optional browser notifications.

const REFRESH_MS = 5 * 60 * 1000; // re-fetch the JSON every 5 minutes
const FRESH_MS = 6 * 60 * 60 * 1000; // highlight stories newer than 6 hours
const NTFY_TOPIC = "ausbudget-ecc002586516f5c7"; // your private push topic
const NTFY_SERVER = "https://ntfy.sh";

const els = {
  feed: document.getElementById("feed"),
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  search: document.getElementById("search"),
  sourceFilter: document.getElementById("source-filter"),
  empty: document.getElementById("empty"),
  refresh: document.getElementById("refresh"),
  lastUpdated: document.getElementById("last-updated"),
  chips: document.getElementById("chips"),
  notifyBtn: document.getElementById("notify-btn"),
  topicName: document.getElementById("topic-name"),
  topicLink: document.getElementById("topic-link"),
};

let allItems = [];
let categories = [];
let focus = [];
let dataUpdatedAt = null;
let activeChip = "For you"; // default to the personalised view
let notifiedUrls = new Set(JSON.parse(localStorage.getItem("notifiedUrls") || "[]"));

function relativeTime(iso) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
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

function matchesChip(item) {
  if (activeChip === "All") return true;
  if (activeChip === "🔥 Top") return !!item.spicy;
  if (activeChip === "For you") return !!item.relevant;
  return (item.categories || []).includes(activeChip);
}

function renderChips() {
  const chips = ["🔥 Top", "For you", "All", ...categories];
  els.chips.innerHTML = chips
    .map(
      (c) =>
        `<button class="chip${c === activeChip ? " active" : ""}" data-chip="${escapeHtml(
          c
        )}">${escapeHtml(c)}</button>`
    )
    .join("");
}

function render() {
  const term = els.search.value.trim().toLowerCase();
  const source = els.sourceFilter.value;

  const filtered = allItems.filter((item) => {
    if (!matchesChip(item)) return false;
    if (source && item.source !== source) return false;
    if (term && !`${item.title} ${item.source}`.toLowerCase().includes(term))
      return false;
    return true;
  });

  els.empty.hidden = filtered.length > 0;
  els.count.textContent = `${filtered.length} ${filtered.length === 1 ? "story" : "stories"}`;

  els.feed.innerHTML = filtered
    .map((item) => {
      const fresh = isFresh(item.publishedAt);
      const when = relativeTime(item.publishedAt);
      const cats = (item.categories || [])
        .map(
          (c) =>
            `<span class="cat cat-${c.replace(/[^a-z]/gi, "").toLowerCase()}">${escapeHtml(
              c
            )}</span>`
        )
        .join("");
      const summary = item.summary
        ? `<p class="summary">${escapeHtml(item.summary).slice(0, 220)}</p>`
        : "";
      return `
        <article class="card${fresh ? " fresh" : ""}${item.spicy ? " spicy" : ""}">
          <h2><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
            ${escapeHtml(item.title)}
          </a></h2>
          ${summary}
          <div class="meta">
            ${item.spicy ? '<span class="spicy-tag">🔥 Top</span>' : ""}
            <span class="badge">${escapeHtml(item.source)}</span>
            ${when ? `<span>${when}</span>` : ""}
            ${fresh ? '<span class="fresh-tag">New</span>' : ""}
            ${cats}
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

// Fire a local browser notification for new relevant items (when permitted).
function maybeNotify(items) {
  if (Notification.permission !== "granted") return;
  const fresh = items.filter(
    (i) => i.relevant && i.spicy && i.url && !notifiedUrls.has(i.url)
  );
  // Skip the very first load (everything would look "new").
  if (notifiedUrls.size > 0) {
    fresh.slice(0, 5).forEach((i) => {
      const n = new Notification(`${i.source} · ${(i.categories || [])[0] || "Budget"}`, {
        body: i.title,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🇦🇺</text></svg>",
      });
      n.onclick = () => window.open(i.url, "_blank");
    });
  }
  items.forEach((i) => i.url && notifiedUrls.add(i.url));
  // Keep the set bounded.
  notifiedUrls = new Set([...notifiedUrls].slice(-800));
  localStorage.setItem("notifiedUrls", JSON.stringify([...notifiedUrls]));
}

function setupNotifyButton() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") return; // already on
  els.notifyBtn.hidden = false;
  els.notifyBtn.addEventListener("click", async () => {
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      els.notifyBtn.hidden = true;
      new Notification("🇦🇺 Browser alerts on", {
        body: "You'll be notified here when new relevant stories arrive.",
      });
    }
  });
}

async function load() {
  try {
    els.status.textContent = "Refreshing…";
    const res = await fetch(`./data/news.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allItems = Array.isArray(data.items) ? data.items : [];
    categories = Array.isArray(data.categories) ? data.categories : [];
    focus = Array.isArray(data.focus) ? data.focus : [];
    dataUpdatedAt = data.updatedAt || null;

    renderChips();
    populateSources();
    render();
    maybeNotify(allItems);

    const relevant = allItems.filter((i) => i.relevant).length;
    els.status.className = "status live";
    els.status.textContent = `Live · ${relevant} for you / ${allItems.length} total`;
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

els.chips.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  activeChip = btn.dataset.chip;
  renderChips();
  render();
});
els.search.addEventListener("input", render);
els.sourceFilter.addEventListener("change", render);
els.refresh.addEventListener("click", load);

// Show the push topic in the setup panel.
if (els.topicName) els.topicName.textContent = NTFY_TOPIC;
if (els.topicLink) els.topicLink.href = `${NTFY_SERVER}/${NTFY_TOPIC}`;

setupNotifyButton();
showSkeletons();
load();
setInterval(load, REFRESH_MS);
