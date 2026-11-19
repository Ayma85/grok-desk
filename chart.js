/* Balance chart: devicePixelRatio-aware canvas, dashed start, marks, ranges. */

const GREEN = "#00d35a";
const BLUE = "#0a84ff";
const RED = "#ff453a";

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function inRange(points, range, nightStartHour) {
  if (!points || !points.length || range === "ALL") return points || [];
  const now = Date.now();
  const spans = { "1H": 3600e3, "4H": 4 * 3600e3, "1D": 24 * 3600e3, "1W": 7 * 24 * 3600e3 };
  if (range === "LIVE") {
    const hour = Number.isFinite(nightStartHour) ? nightStartHour : 22;
    const et = new Date(now - 5 * 3600e3); // display night in ET even if device tz differs
    const start = new Date(et);
    start.setUTCHours(hour, 0, 0, 0);
    if (et.getTime() < start.getTime()) start.setUTCDate(start.getUTCDate() - 1);
    const startMs = start.getTime() + 5 * 3600e3;
    return points.filter((p) => Date.parse(p.ts) >= startMs);
  }
  const span = spans[range];
  if (!span) return points;
  return points.filter((p) => now - Date.parse(p.ts) <= span);
}

export function renderChart(canvas, data, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 358;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const range = opts.range || "1D";
  const points = inRange(data && data.points, range, opts.nightStartHour);
  const marks = (data && data.marks) || [];
  if (!points.length) {
    ctx.fillStyle = "rgba(235,235,245,0.3)";
    ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Waiting for the first trade", 8, cssH / 2);
    return;
  }

  const values = points.map((p) => Number(p.value)).filter((n) => Number.isFinite(n));
  const startVal = Number.isFinite(opts.startValue) ? opts.startValue : values[0];
  let min = Math.min(...values, startVal);
  let max = Math.max(...values, startVal);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.18;
  min -= pad;
  max += pad;
  const left = 2;
  const right = cssW - 2;
  const top = 28;
  const bottom = cssH - 8;
  const times = points.map((p) => Date.parse(p.ts));
  const t0 = times[0];
  const t1 = times[times.length - 1] === t0 ? t0 + 1 : times[times.length - 1];

  const xAt = (t) => left + ((t - t0) / (t1 - t0)) * (right - left);
  const yAt = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);

  const path = new Path2D();
  points.forEach((p, i) => {
    const x = xAt(Date.parse(p.ts));
    const y = yAt(Number(p.value));
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });

  const last = points[points.length - 1];
  const lx = xAt(Date.parse(last.ts));
  const ly = yAt(Number(last.value));
  const fill = new Path2D(path);
  fill.lineTo(lx, bottom);
  fill.lineTo(xAt(times[0]), bottom);
  fill.closePath();
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, "rgba(0,211,90,0.28)");
  grad.addColorStop(1, "rgba(0,211,90,0)");
  ctx.fillStyle = grad;
  ctx.fill(fill);

  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);

  // Dashed start (night-start / first) line
  const sy = yAt(startVal);
  ctx.beginPath();
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "rgba(235,235,245,0.3)";
  ctx.lineWidth = 1;
  ctx.moveTo(left, sy);
  ctx.lineTo(right, sy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Marks above the line; later marks move up a row so they never overlap
  const used = [];
  const inView = marks.filter((m) => {
    const t = Date.parse(m.ts);
    return Number.isFinite(t) && t >= t0 && t <= t1;
  });
  inView.forEach((m) => {
    const t = Date.parse(m.ts);
    const x = xAt(t);
    let y = top + 10;
    for (const box of used) {
      if (Math.abs(x - box.x) < 72 && Math.abs(y - box.y) < 14) y = box.y - 14;
    }
    used.push({ x, y });
    const tone = m.tone === "red" ? RED : m.tone === "green" ? GREEN : BLUE;
    ctx.fillStyle = tone;
    ctx.font = "600 10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(m.label || ""), x, y);
  });

  if (!prefersReducedMotion() && opts.animatePoint && points.length > 1) {
    ctx.beginPath();
    ctx.fillStyle = GREEN;
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export { inRange, prefersReducedMotion };
