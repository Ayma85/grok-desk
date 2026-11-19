/* Desk web UI: link via #d={gistId}.{dataPath}, then poll the secret gist. */
import { renderChart } from "./chart.js";

const STORAGE_KEY = "grok-desk-link";
const BASE_INTERVAL_MS = 90_000;
const MAX_INTERVAL_MS = 15 * 60_000;

const statusEl = document.getElementById("status");
const deskEl = document.getElementById("desk");
const modeEl = document.getElementById("mode");
const balanceEl = document.getElementById("balance");
const updatedEl = document.getElementById("updated");
const activityEl = document.getElementById("activity");

function showUnlinked(message) {
  statusEl.textContent = message || "Not linked";
  statusEl.classList.remove("ok");
  deskEl.hidden = true;
}

function captureHashLink() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#d=")) {
    return readStoredLink();
  }
  const rest = hash.slice(3);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return readStoredLink();
  }
  const gistId = rest.slice(0, dot);
  const dataPath = rest.slice(dot + 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ gistId, dataPath }));
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return { gistId, dataPath };
}

function readStoredLink() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.gistId || !parsed.dataPath) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseGistFile(gist, name) {
  const file = gist && gist.files && gist.files[name];
  if (!file || typeof file.content !== "string") return null;
  try {
    return JSON.parse(file.content);
  } catch {
    return null;
  }
}

function render(state, activity, chart) {
  statusEl.textContent = "Linked · PAPER";
  statusEl.classList.add("ok");
  deskEl.hidden = false;
  modeEl.textContent = state.mode || "PAPER";
  const bal = state.balance;
  balanceEl.textContent = typeof bal === "number" ? bal.toFixed(2) : String(bal ?? "0");
  updatedEl.textContent = state.ts || "";
  activityEl.replaceChildren();
  const events = (activity && Array.isArray(activity.events)) ? activity.events : [];
  for (const ev of events) {
    const li = document.createElement("li");
    li.textContent = typeof ev === "string" ? ev : (ev.text || ev.ts || JSON.stringify(ev));
    activityEl.appendChild(li);
  }
  renderChart(null, chart);
}

async function fetchGist(gistId) {
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  return res;
}

function pathsMatch(expected, observed) {
  return typeof expected === "string" && typeof observed === "string" && expected.length > 0 && expected === observed;
}

async function poll(link) {
  let interval = BASE_INTERVAL_MS;
  async function tick() {
    try {
      const res = await fetchGist(link.gistId);
      if (res.status === 403 || res.status === 429) {
        interval = Math.min(interval * 2, MAX_INTERVAL_MS);
        showUnlinked("Not linked");
      } else if (!res.ok) {
        showUnlinked("Not linked");
      } else {
        const gist = await res.json();
        const state = parseGistFile(gist, "state.json");
        const activity = parseGistFile(gist, "activity.json");
        const chart = parseGistFile(gist, "chart.json");
        const observed = state && (state.data_path || state.dataPath);
        if (!state || !pathsMatch(link.dataPath, observed)) {
          showUnlinked("Not linked");
        } else {
          interval = BASE_INTERVAL_MS;
          render(state, activity, chart);
        }
      }
    } catch {
      showUnlinked("Not linked");
    }
    setTimeout(tick, interval);
  }
  await tick();
}

const link = captureHashLink();
if (!link) {
  showUnlinked("Not linked");
} else {
  statusEl.textContent = "Loading…";
  poll(link);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
