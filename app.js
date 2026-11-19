/* Desk iPhone app. Linked via #d={gistId}.{dataPath}, polls the secret gist every 90s.
   FOMO URLs come only from the snapshot (links.py). Writes go through Telegram (Step 11). */
import { renderChart, prefersReducedMotion } from "./chart.js";

const STORAGE_KEY = "grok-desk-link";
const BASE_INTERVAL_MS = 90_000;
const MAX_INTERVAL_MS = 15 * 60_000;
const VIA = "via Telegram (Step 11)";

const unlinkedEl = document.getElementById("unlinked");
const appEl = document.getElementById("app");
const bannerEl = document.getElementById("banner");

let snapshot = { state: null, chart: null, activity: null, coins: [] };
let lastGood = null;
let currentRange = "1D";
let retryMs = BASE_INTERVAL_MS;
let lastUpdate = null;
let route = { view: "home" };
let retryTimer = null;

function $(id) { return document.getElementById(id); }

function showUnlinked() {
  unlinkedEl.hidden = false;
  appEl.hidden = true;
  unlinkedEl.querySelector(".unlinked-msg").textContent = "Not linked";
}

function showApp() {
  unlinkedEl.hidden = true;
  appEl.hidden = false;
}

function captureHashLink() {
  const hash = window.location.hash || "";
  if (hash.startsWith("#d=")) {
    const rest = hash.slice(3);
    const dot = rest.indexOf(".");
    if (dot > 0 && dot < rest.length - 1) {
      const gistId = rest.slice(0, dot);
      const dataPath = rest.slice(dot + 1);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ gistId, dataPath }));
    }
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/home`);
  }
  return readStoredLink();
}

function readStoredLink() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || !parsed.gistId || !parsed.dataPath) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseGistFile(gist, name) {
  const file = gist && gist.files && gist.files[name];
  if (!file || typeof file.content !== "string") return null;
  try { return JSON.parse(file.content); } catch { return null; }
}

function pathsMatch(expected, observed) {
  return typeof expected === "string" && typeof observed === "string" && expected.length > 0 && expected === observed;
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n, signed = true) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const body = `${Math.abs(v).toFixed(2)}%`;
  if (!signed) return body;
  return (v > 0 ? "+" : v < 0 ? "-" : "+") + body;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

function fmtAge(min, created) {
  if (Number.isFinite(Number(min))) {
    const m = Number(min);
    if (m < 60) return `${Math.round(m)}m old`;
    return `${(m / 60).toFixed(m >= 600 ? 0 : 1).replace(/\.0$/, "")}h old`;
  }
  if (!created) return "";
  const ms = Date.now() - Date.parse(created);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = ms / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60e3))}m old`;
  return `${h.toFixed(h >= 10 ? 0 : 1).replace(/\.0$/, "")}h old`;
}

function setOdometer(el, next) {
  const value = String(next);
  if (prefersReducedMotion() || !el.dataset.ready) {
    el.textContent = value;
    el.dataset.ready = "1";
    return;
  }
  const prev = el.textContent || "";
  if (prev === value) return;
  el.textContent = value;
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function closeSheet() { $("sheet").hidden = true; $("sheet-card").replaceChildren(); }

function openSheet(nodes) {
  const card = $("sheet-card");
  card.replaceChildren();
  nodes.forEach((n) => card.appendChild(n));
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeSheet);
  card.appendChild(cancel);
  $("sheet").hidden = false;
}

function viaTelegram() {
  const p = document.createElement("p");
  p.style.margin = "4px 0 12px";
  p.style.fontSize = "17px";
  p.style.fontWeight = "600";
  p.textContent = VIA;
  const note = document.createElement("p");
  note.className = "muted";
  note.style.margin = "0 0 8px";
  note.textContent = "Pause, sell and settings changes go through Telegram in Step 11.";
  openSheet([p, note]);
}

function coinFromSnapshot(mint) {
  if (!mint) return null;
  const list = snapshot.coins || [];
  return list.find((c) => c.mint === mint) || null;
}

function findCoinUrl(mint) {
  const c = coinFromSnapshot(mint);
  if (c && c.coin_url) return c.coin_url;
  const bags = [
    snapshot.state && snapshot.state.positions,
    snapshot.state && snapshot.state.orders,
    snapshot.activity && snapshot.activity.events,
  ];
  for (const bag of bags) {
    const hit = (bag || []).find((r) => r.mint === mint && r.coin_url);
    if (hit) return hit.coin_url;
  }
  const bots = (snapshot.state && snapshot.state.bots) || [];
  for (const b of bots) {
    const hit = (b.decisions || []).find((r) => r.mint === mint && r.coin_url);
    if (hit) return hit.coin_url;
  }
  return null;
}

function fomoLink(url, label) {
  const a = document.createElement("a");
  a.className = "btn primary";
  if (url) {
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label || "Open on FOMO";
  } else {
    a.href = "#";
    a.textContent = "Open on FOMO";
    a.addEventListener("click", (e) => { e.preventDefault(); toast("No FOMO link in the snapshot"); });
  }
  return a;
}

function go(view, params = {}) {
  route = { view, ...params };
  const hash = view === "coin" && params.mint
    ? `#/coin/${params.mint}`
    : view === "audit" && params.mint
      ? `#/audit/${params.mint}`
      : `#/${view}`;
  if (location.hash !== hash) history.pushState(route, "", hash);
  applyRoute();
}

function parseRoute() {
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  if (raw.startsWith("d=")) return { view: "home" };
  const parts = raw.split("/");
  const view = parts[0] || "home";
  if (view === "coin" || view === "audit") return { view, mint: parts.slice(1).join("/") };
  return { view };
}

function applyRoute() {
  route = parseRoute();
  const view = ["home", "bots", "activity", "account", "coin", "audit", "search"].includes(route.view)
    ? route.view
    : "home";
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.view === view);
  });
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.tab === view);
  });
  if (view === "coin") renderCoin(route.mint);
  if (view === "audit") renderAudit(route.mint);
  if (view === "search") $("search-input").focus();
}

function runningCount(bots) {
  return (bots || []).filter((b) => b.status === "running").length;
}

function renderNavbar(state) {
  const handle = (state && state.fomo_handle) || "G";
  $("home-avatar").textContent = String(handle).slice(0, 1).toUpperCase();
  const events = (snapshot.activity && snapshot.activity.events) || [];
  $("bell-dot").hidden = events.length === 0;
}

function renderHero(state) {
  const mode = (state && state.mode) || "PAPER";
  const paper = mode !== "LIVE";
  $("paper-badge").hidden = !paper;
  $("coin-paper").hidden = !paper;
  const cash = state ? state.balance : 0;
  setOdometer($("balance"), fmtMoney(cash));
  const pct = state ? Number(state.today_pct) : 0;
  const today = $("today-pct");
  today.textContent = fmtPct(pct);
  today.classList.toggle("up", pct >= 0);
  today.classList.toggle("down", pct < 0);
  const mult = state ? Number(state.multiplier) : 1;
  $("multiplier").textContent = `${(Number.isFinite(mult) ? mult : 1).toFixed(2)}x`;
}

function renderLive(state) {
  const lane = (state && state.lane) || { label: "Idle" };
  $("live-lane").textContent = lane.label || "Idle";
  if (lane.color) $("live-lane").style.color = lane.color;
  else $("live-lane").style.color = "";
  $("live-age").innerHTML = `<span class="dot grey"></span> Last frame unavailable`;
  $("live-placeholder").textContent = "Live screen stays on the desk · via Telegram (Step 11)";
  const last = state && state.last_order;
  const box = $("live-order");
  box.replaceChildren();
  if (!last) {
    box.textContent = "No orders yet";
    return;
  }
  const side = last.side === "sell" ? "Sold" : "Bought";
  const verified = last.status === "done";
  const text = document.createElement("span");
  text.textContent = `${side} ${last.symbol || ""} · ${fmtMoney(last.fill_usd || last.usd)} · ${verified ? "verified" : (last.status || "")}`.replace(/\s+/g, " ").trim();
  box.appendChild(text);
  const checks = document.createElement("span");
  checks.className = "checks";
  ["screen_ok", "api_ok", "chain_ok"].forEach((k) => {
    const s = document.createElement("span");
    const v = last[k];
    s.className = `check${v === 1 || v === true ? " on" : (v === 0 || v === false ? " off" : "")}`;
    s.title = k.replace("_ok", "");
    s.textContent = v === 1 || v === true ? "✓" : v === 0 || v === false ? "✕" : "·";
    checks.appendChild(s);
  });
  box.appendChild(checks);
}

function renderCarousel(state) {
  const wrap = $("bot-carousel");
  wrap.replaceChildren();
  const bots = (state && state.bots) || [];
  $("bots-running").textContent = `Bots · ${runningCount(bots)} running`;
  bots.forEach((bot) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bot-card";
    btn.addEventListener("click", () => go("bots"));
    const kicker = document.createElement("div");
    kicker.className = "kicker";
    kicker.style.color = bot.color || "";
    kicker.textContent = bot.label;
    const h = document.createElement("h3");
    h.textContent = bot.headline || bot.label;
    const p = document.createElement("p");
    const failed = (bot.decisions || []).find((d) => d.verdict === "kill" || d.pass === 0);
    if (bot.name === "scanner" && failed) {
      p.innerHTML = `<span class="strike">${failed.symbol || "pool"}</span> <span class="kill">${failed.reason || ""}</span>`;
    } else if (bot.name === "analyst") {
      p.textContent = bot.detail || "";
    } else {
      p.textContent = bot.detail || "";
    }
    btn.append(kicker, h, p);
    if (bot.pills) {
      const row = document.createElement("div");
      row.className = "pills";
      bot.pills.forEach((pill) => {
        const s = document.createElement("span");
        s.className = `pill ${pill.tone || ""}`;
        s.textContent = pill.text;
        row.appendChild(s);
      });
      btn.appendChild(row);
    }
    wrap.appendChild(btn);
  });
}

function activityRow(ev, { lastFive } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row";
  const kind = (ev.kind || "").toLowerCase();
  const title = ev.title || (
    kind === "bought" ? `Bought ${ev.symbol || ""}` :
    kind === "sold" ? `Sold ${ev.symbol || ""}` :
    kind === "stopped" ? `Stopped ${ev.symbol || ""}` :
    kind === "rejected" ? `Rejected ${ev.symbol || ""}` : (ev.symbol || "Update")
  );
  const sub = ev.subtitle || `${ev.bot || ""} · ${fmtTime(ev.ts)}`.replace(/^ · /, "");
  const main = document.createElement("div");
  main.className = "row-main";
  main.innerHTML = `<div class="row-title"></div><div class="row-sub"></div>`;
  main.querySelector(".row-title").textContent = title;
  main.querySelector(".row-sub").textContent = sub;
  const val = document.createElement("div");
  val.className = "row-value";
  val.textContent = ev.value == null ? "" : String(ev.value);
  if (kind === "sold" || (typeof ev.value === "string" && ev.value.startsWith("+"))) val.classList.add("up");
  if (kind === "stopped" || (typeof ev.value === "string" && ev.value.startsWith("-"))) val.classList.add("down");
  btn.append(main, val);
  btn.addEventListener("click", () => {
    if (!ev.mint) return;
    if (kind === "rejected") go("audit", { mint: ev.mint });
    else go("coin", { mint: ev.mint });
  });
  return btn;
}

function renderActivityLists(state) {
  const events = (snapshot.activity && snapshot.activity.events) || [];
  const home = $("home-activity");
  const all = $("activity-list");
  home.replaceChildren();
  all.replaceChildren();
  if (!events.length) {
    const emptyHome = document.createElement("div");
    emptyHome.className = "empty";
    emptyHome.textContent = "Waiting for the first trade";
    home.appendChild(emptyHome);
    const emptyAll = document.createElement("div");
    emptyAll.className = "empty";
    emptyAll.textContent = "Nothing yet tonight";
    all.appendChild(emptyAll);
    return;
  }
  events.slice(0, 5).forEach((ev) => home.appendChild(activityRow(ev, { lastFive: true })));
  events.forEach((ev) => all.appendChild(activityRow(ev)));
}

function renderBotsTab(state) {
  const list = $("bots-list");
  list.replaceChildren();
  const bots = (state && state.bots) || [];
  bots.forEach((bot) => {
    const card = document.createElement("article");
    card.className = "card full-bot";
    const head = document.createElement("div");
    head.className = "full-bot-head";
    const dot = document.createElement("span");
    dot.className = `dot ${bot.status === "running" ? "green" : bot.status === "paused" ? "grey" : "red"}`;
    const h = document.createElement("h3");
    h.textContent = bot.label;
    h.style.color = bot.color || "";
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = `switch${bot.paused ? "" : " on"}${bot.pause_locked ? " locked" : ""}`;
    sw.setAttribute("aria-label", `${bot.label} pause, ${VIA}`);
    sw.addEventListener("click", () => {
      if (bot.pause_locked) toast("Locked while a position is open");
      else viaTelegram();
    });
    head.append(dot, h, sw);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${bot.headline || ""} · today ${bot.count || 0}`;
    const via = document.createElement("div");
    via.className = "via";
    via.textContent = bot.pause_locked ? "Locked while a position is open" : VIA;
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "btn";
    settings.textContent = "Settings";
    settings.addEventListener("click", () => go("account"));
    card.append(head, meta, via, settings);
    (bot.decisions || []).forEach((d) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "decision";
      const left = document.createElement("div");
      const title = d.symbol || d.name || (d.mint ? d.mint.slice(0, 6) : "Coin");
      left.innerHTML = `<div>${title}</div><div class="sub">${d.reason || d.status || d.verdict || ""}</div>`;
      const right = document.createElement("div");
      right.className = "sub";
      right.textContent = fmtTime(d.ts);
      row.append(left, right);
      row.addEventListener("click", () => {
        if (!d.mint) return;
        if (bot.name === "analyst" || d.pass === 0 || d.verdict === "kill") go("audit", { mint: d.mint });
        else go("coin", { mint: d.mint });
      });
      card.appendChild(row);
    });
    list.appendChild(card);
  });
}

function settingControl(item) {
  const wrap = document.createElement("div");
  wrap.className = "setting";
  const key = item.key.split(".").pop().replace(/_/g, " ");
  const lab = document.createElement("div");
  lab.textContent = key;
  const exact = document.createElement("div");
  exact.className = "exact";
  exact.textContent = item.value == null ? "—" : String(item.value);
  wrap.append(lab, exact);
  const n = Number(item.value);
  if (Number.isFinite(n)) {
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(n < 0 ? n : 0);
    range.max = String(n === 0 ? 1 : Math.max(n * 2, n));
    range.step = Number.isInteger(n) ? "1" : "0.01";
    range.value = String(n);
    range.setAttribute("aria-label", `${key}, ${VIA}`);
    range.addEventListener("input", (e) => { e.target.value = String(n); viaTelegram(); });
    wrap.appendChild(range);
  }
  return wrap;
}

function renderAccount(state) {
  const body = $("account-body");
  body.replaceChildren();
  const modeCard = document.createElement("article");
  modeCard.className = "card";
  const mode = (state && state.mode) || "PAPER";
  const row = document.createElement("div");
  row.className = "mode-row";
  ["PAPER", "LIVE"].forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn${m === mode ? " is-on" : ""}`;
    b.textContent = m;
    b.addEventListener("click", viaTelegram);
    row.appendChild(b);
  });
  const via = document.createElement("div");
  via.className = "via";
  via.style.marginTop = "8px";
  via.textContent = `${VIA} · LIVE stays locked until you type LIVE in chat`;
  const cash = document.createElement("div");
  cash.className = "price-lg";
  cash.style.fontSize = "36px";
  cash.style.marginTop = "12px";
  cash.textContent = fmtMoney(state && state.balance);
  const cashLab = document.createElement("div");
  cashLab.className = "muted";
  cashLab.textContent = "Cash";
  modeCard.append(row, via, cashLab, cash);
  body.appendChild(modeCard);

  const links = (state && state.links) || {};
  const actions = document.createElement("article");
  actions.className = "card actions";
  if (links.profile_url) actions.appendChild(fomoLink(links.profile_url, "Your FOMO profile"));
  const invite = document.createElement("button");
  invite.type = "button";
  invite.className = "btn";
  invite.textContent = "Invite a friend";
  invite.addEventListener("click", async () => {
    const url = links.signup_url;
    if (!url) { toast("No invite link in the snapshot"); return; }
    if (navigator.share) {
      try { await navigator.share({ title: "FOMO", url }); return; } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Link copied");
    }
  });
  actions.appendChild(invite);
  body.appendChild(actions);

  (state && state.settings || []).forEach((group) => {
    const card = document.createElement("article");
    card.className = "card";
    const h = document.createElement("h3");
    h.textContent = group.label;
    card.appendChild(h);
    const note = document.createElement("div");
    note.className = "via";
    note.textContent = VIA;
    card.appendChild(note);
    (group.items || []).forEach((item) => card.appendChild(settingControl(item)));
    body.appendChild(card);
  });

  const extras = document.createElement("article");
  extras.className = "card actions";
  const picks = document.createElement("button");
  picks.type = "button";
  picks.className = "btn";
  picks.innerHTML = `Copy picks · off<span class="via-line">${VIA}</span>`;
  picks.addEventListener("click", viaTelegram);
  const push = document.createElement("button");
  push.type = "button";
  push.className = "btn";
  const pushNote = (state && state.push && state.push.note) || "Telegram only (Step 11)";
  push.innerHTML = `Pushes · ${pushNote}<span class="via-line">Send test push · ${VIA}</span>`;
  push.addEventListener("click", viaTelegram);
  const watch = document.createElement("button");
  watch.type = "button";
  watch.className = "btn";
  watch.innerHTML = `Watch in Grok Bot<span class="via-line">${VIA}</span>`;
  watch.addEventListener("click", viaTelegram);
  extras.append(picks, push, watch);
  body.appendChild(extras);
}

function renderCoin(mint) {
  const body = $("coin-body");
  body.replaceChildren();
  const coin = coinFromSnapshot(mint) || { mint, symbol: mint && mint.slice(0, 6), name: "Coin" };
  $("coin-title").textContent = coin.symbol || coin.name || "Coin";
  $("coin-paper").hidden = !snapshot.state || snapshot.state.mode === "LIVE";
  const pos = ((snapshot.state && snapshot.state.positions) || []).find((p) => p.mint === mint);
  const head = document.createElement("div");
  const sub = document.createElement("div");
  sub.className = "muted";
  const age = fmtAge(coin.market && coin.market.age_min, coin.created_at || coin.migrated_at);
  sub.textContent = [coin.symbol || coin.name, "Solana", age].filter(Boolean).join(" · ");
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.alignItems = "center";
  const name = document.createElement("h2");
  name.textContent = coin.name || coin.symbol || "Coin";
  name.style.fontSize = "22px";
  row.appendChild(name);
  if (coin.shield) {
    const sh = document.createElement("span");
    sh.className = "pill cyan";
    sh.textContent = coin.shield;
    sh.style.cursor = "pointer";
    sh.addEventListener("click", () => go("audit", { mint }));
    row.appendChild(sh);
  }
  const lastPx = (coin.prices && coin.prices.length) ? coin.prices[coin.prices.length - 1].price : (pos && pos.entry_price);
  const price = document.createElement("div");
  price.className = "price-lg";
  price.textContent = lastPx != null ? fmtMoney(lastPx) : "—";
  const since = document.createElement("div");
  since.className = "muted";
  if (pos && pos.entry_price && lastPx) {
    const ch = (Number(lastPx) / Number(pos.entry_price) - 1) * 100;
    since.textContent = `${ch >= 0 ? "▲" : "▼"} ${fmtPct(ch)} since entry`;
    since.style.color = ch >= 0 ? "#00d35a" : "#ff453a";
  }
  const chart = document.createElement("canvas");
  chart.width = 358;
  chart.height = 140;
  chart.style.width = "100%";
  chart.style.height = "140px";
  head.append(sub, row, price, since, chart);
  body.appendChild(head);
  const pts = (coin.prices || []).map((p) => ({ ts: p.ts, value: p.price }));
  renderChart(chart, { points: pts, marks: [] }, { range: "ALL", startValue: pos && pos.stop_price });
  const m = coin.market || {};
  const stats = document.createElement("div");
  stats.className = "grid-3";
  [
    ["Market cap", "—"],
    ["Liquidity", m.liquidity_usd != null ? fmtMoney(m.liquidity_usd) : "—"],
    ["Holders", coin.holders != null ? String(coin.holders) : "—"],
  ].forEach(([lbl, num]) => {
    const s = document.createElement("div");
    s.className = "stat";
    s.innerHTML = `<div class="lbl">${lbl}</div><div class="num">${num}</div>`;
    stats.appendChild(s);
  });
  body.appendChild(stats);
  if (pos) {
    const yours = document.createElement("div");
    yours.className = "card";
    yours.innerHTML = `<div class="muted">Your position</div><div style="font-weight:600;margin-top:4px">${fmtMoney(pos.size_usd)} in · Executor</div>`;
    body.appendChild(yours);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.appendChild(fomoLink(coin.coin_url || findCoinUrl(mint), "Open on FOMO"));
  const sell = document.createElement("button");
  sell.type = "button";
  sell.className = "btn danger";
  sell.innerHTML = `Sell now<span class="via-line">${VIA}</span>`;
  sell.addEventListener("click", () => {
    const title = document.createElement("p");
    title.style.fontWeight = "600";
    title.textContent = "Sell now";
    const opts = [25, 50, 100].map((pct) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.innerHTML = `${pct}%<span class="via-line">Confirm sell · ${VIA}</span>`;
      b.addEventListener("click", () => { closeSheet(); viaTelegram(); });
      return b;
    });
    openSheet([title, ...opts]);
  });
  actions.appendChild(sell);
  body.appendChild(actions);
}

function renderAudit(mint) {
  const body = $("audit-body");
  body.replaceChildren();
  const coin = coinFromSnapshot(mint) || { mint, symbol: mint && mint.slice(0, 6), layers: [] };
  $("audit-title").textContent = coin.symbol || "Audit";
  const discs = document.createElement("div");
  discs.className = "layers";
  const layers = coin.layers || [];
  for (let i = 1; i <= 8; i++) {
    const L = layers.find((x) => Number(x.layer) === i) || { layer: i, pass: null };
    const d = document.createElement("div");
    d.className = "disc";
    if (L.pass === 1 || L.pass === true) { d.classList.add("pass"); d.textContent = "✓"; }
    else if (L.pass === 0 || L.pass === false) { d.classList.add("fail"); d.textContent = "✕"; }
    else { d.textContent = String(i); }
    discs.appendChild(d);
  }
  body.appendChild(discs);
  // Cyan beam reads each layer once on open (skipped when reduced motion)
  if (!prefersReducedMotion()) {
    const discsEls = [...discs.children];
    let i = 0;
    const tick = () => {
      discsEls.forEach((el) => el.classList.remove("reading"));
      if (i < discsEls.length) {
        discsEls[i].classList.add("reading");
        i += 1;
        setTimeout(tick, 160);
      }
    };
    setTimeout(tick, 80);
  }
  layers.forEach((L) => {
    const row = document.createElement("div");
    row.className = "layer-row";
    const left = document.createElement("div");
    left.textContent = L.name || `Layer ${L.layer}`;
    const right = document.createElement("div");
    right.className = (L.pass === 1 || L.pass === true) ? "row-value up" : (L.pass === 0 || L.pass === false) ? "row-value down" : "muted";
    right.textContent = L.value_text || "";
    row.append(left, right);
    body.appendChild(row);
  });
  const social = document.createElement("div");
  social.className = "social-row";
  const sc = coin.score || {};
  if (sc.social === 0 || sc.social === "off" || (snapshot.state && snapshot.state.bots || []).find((b) => b.name === "analyst" && b.social === "off")) {
    social.textContent = "Social: off";
  } else if (sc.social_pts != null) {
    social.textContent = `Social +${sc.social_pts}`;
  } else {
    social.textContent = "Social: off";
  }
  body.appendChild(social);
  const open = fomoLink(coin.coin_url || findCoinUrl(mint), "Open on FOMO");
  body.appendChild(open);
}

function renderSearch(q) {
  const box = $("search-results");
  box.replaceChildren();
  const needle = (q || "").trim().toLowerCase();
  if (!needle) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Search by name, symbol or mint";
    box.appendChild(empty);
    return;
  }
  const coins = snapshot.coins || [];
  const hits = coins.filter((c) =>
    [c.name, c.symbol, c.mint].some((s) => String(s || "").toLowerCase().includes(needle))
  );
  if (!hits.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matches";
    box.appendChild(empty);
    return;
  }
  hits.forEach((c) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.innerHTML = `<div class="row-main"><div class="row-title"></div><div class="row-sub"></div></div>`;
    row.querySelector(".row-title").textContent = c.symbol || c.name;
    row.querySelector(".row-sub").textContent = c.name && c.symbol !== c.name ? c.name : (c.mint || "");
    row.addEventListener("click", () => go("coin", { mint: c.mint }));
    box.appendChild(row);
  });
}

function renderAll() {
  const state = snapshot.state || (lastGood && lastGood.state);
  if (!state) return;
  showApp();
  renderNavbar(state);
  renderHero(state);
  const canvas = $("chart");
  renderChart(canvas, snapshot.chart || { points: [], marks: [] }, {
    range: currentRange,
    startValue: state.night_start_cash,
    nightStartHour: Number(String(state.night_start || "22:00").split(":")[0]),
  });
  renderLive(state);
  renderCarousel(state);
  renderActivityLists(state);
  renderBotsTab(state);
  renderAccount(state);
  if (route.view === "coin" && route.mint) renderCoin(route.mint);
  if (route.view === "audit" && route.mint) renderAudit(route.mint);
}

function showError(seconds, time) {
  bannerEl.hidden = false;
  bannerEl.textContent = `Desk offline · retrying in ${seconds}s · last update ${time || "—"}`;
}

function hideError() { bannerEl.hidden = true; }

async function fetchGistApi(gistId) {
  return fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
}

async function fetchRawFiles(gistId) {
  // Unauthenticated api.github.com is easily rate-limited from shared IPs.
  // Raw gist files are public-if-you-know-the-id and allow CORS.
  const base = `https://gist.githubusercontent.com/Ayma85/${encodeURIComponent(gistId)}/raw`;
  const bust = `t=${Date.now()}`;
  const names = ["state.json", "chart.json", "activity.json", "coins.json"];
  const out = {};
  for (const name of names) {
    const res = await fetch(`${base}/${name}?${bust}`, { cache: "no-store" });
    if (name === "state.json" && !res.ok) return null;
    if (!res.ok) continue;
    try { out[name] = JSON.parse(await res.text()); } catch { return null; }
  }
  return out;
}

function packFromApi(gist) {
  const state = parseGistFile(gist, "state.json");
  const activity = parseGistFile(gist, "activity.json") || { events: [] };
  const chart = parseGistFile(gist, "chart.json") || { points: [], marks: [] };
  const coinsWrap = parseGistFile(gist, "coins.json");
  return { state, activity, chart, coins: (coinsWrap && coinsWrap.coins) || [] };
}

function packFromRaw(files) {
  if (!files || !files["state.json"]) return { state: null, activity: { events: [] }, chart: { points: [], marks: [] }, coins: [] };
  return {
    state: files["state.json"],
    activity: files["activity.json"] || { events: [] },
    chart: files["chart.json"] || { points: [], marks: [] },
    coins: (files["coins.json"] && files["coins.json"].coins) || [],
  };
}

function applyPack(link, pack) {
  const state = pack && pack.state;
  const observed = state && (state.data_path || state.dataPath);
  if (!state || !pathsMatch(link.dataPath, observed)) return false;
  retryMs = BASE_INTERVAL_MS;
  hideError();
  snapshot = pack;
  lastGood = snapshot;
  lastUpdate = state.ts;
  renderAll();
  return true;
}

function failTick() {
  if (lastGood) {
    showError(Math.round(retryMs / 1000), fmtTime(lastUpdate));
    showApp();
  } else {
    // A stored link that cannot be read yet is "offline", not "Not linked".
    showApp();
    showError(Math.round(retryMs / 1000), fmtTime(lastUpdate));
  }
}

async function tick(link) {
  let ok = false;
  try {
    const res = await fetchGistApi(link.gistId);
    if (res.ok) {
      ok = applyPack(link, packFromApi(await res.json()));
    } else if (res.status === 403 || res.status === 429) {
      retryMs = Math.min(retryMs * 2, MAX_INTERVAL_MS);
    }
  } catch {
    // try raw fallback below
  }
  if (!ok) {
    try {
      const files = await fetchRawFiles(link.gistId);
      ok = applyPack(link, packFromRaw(files));
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    failTick();
    // First loads sometimes hit a GitHub challenge or rate-limit page
    // with no CORS headers; retry quickly a few times, then settle to 90s.
    window.__deskFailStreak = (window.__deskFailStreak || 0) + 1;
    retryMs = window.__deskFailStreak <= 5 ? 2000 : BASE_INTERVAL_MS;
  } else {
    window.__deskFailStreak = 0;
    retryMs = BASE_INTERVAL_MS;
  }
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => tick(link), retryMs);
}

function bind() {
  $("home-avatar").addEventListener("click", () => go("account"));
  $("home-title").addEventListener("click", () => go("account"));
  $("btn-search").addEventListener("click", () => go("search"));
  $("btn-bell").addEventListener("click", () => go("activity"));
  $("see-all-activity").addEventListener("click", () => go("activity"));
  $("coin-back").addEventListener("click", () => history.back());
  $("audit-back").addEventListener("click", () => history.back());
  $("search-back").addEventListener("click", () => history.back());
  $("search-input").addEventListener("input", (e) => renderSearch(e.target.value));
  $("live-card").addEventListener("click", viaTelegram);
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => go(tab.dataset.tab));
  });
  $("ranges").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    currentRange = btn.dataset.range;
    $("ranges").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b === btn));
    if (snapshot.state) {
      renderChart($("chart"), snapshot.chart || { points: [], marks: [] }, {
        range: currentRange,
        startValue: snapshot.state.night_start_cash,
        nightStartHour: Number(String(snapshot.state.night_start || "22:00").split(":")[0]),
      });
    }
  });
  $("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  window.addEventListener("resize", () => {
    if (snapshot.state) {
      renderChart($("chart"), snapshot.chart || { points: [], marks: [] }, {
        range: currentRange,
        startValue: snapshot.state.night_start_cash,
        nightStartHour: Number(String(snapshot.state.night_start || "22:00").split(":")[0]),
      });
    }
  });
  window.addEventListener("popstate", applyRoute);
  window.addEventListener("hashchange", applyRoute);
}

const link = captureHashLink();
bind();
applyRoute();
if (!link) {
  showUnlinked();
} else {
  unlinkedEl.hidden = true;
  appEl.hidden = false;
  $("home-activity").innerHTML = `<div class="skel" style="height:72px;margin:8px 0"></div><div class="skel" style="height:72px"></div>`;
  tick(link);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
