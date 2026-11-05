// Rotate PDF: the rules (turning by quarters, placing a page that is turned by any angle, finding the tilt of a scan), kept apart from
// the page so they can be tested. No DOM and no PDF library in here.

// ---------------------------------------------------------------- quarter turns

export const turnBy = (deg, delta) => (((deg + delta) % 360) + 360) % 360;

// ---------------------------------------------------------------- any angle

// Where a page goes when it is turned by an angle that is not a quarter.
//   w, h: the page's own size; base: how it is already turned, a multiple of 90 (what the PDF says plus what was asked for)
//   angle: the extra tilt, in degrees clockwise; grow: make the new page big enough for the whole turned page, otherwise keep the
//   size the page has and let the corners go.
// -> { pageW, pageH, x, y, theta } where theta is in radians and counter-clockwise positive, the way pdf-lib turns things.
export function placeTurned({ w, h, base = 0, angle, grow = true }) {
  const theta = (-(base + angle) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const sideways = base % 180 !== 0;
  const pageW = grow ? w * Math.abs(cos) + h * Math.abs(sin) : sideways ? h : w;
  const pageH = grow ? w * Math.abs(sin) + h * Math.abs(cos) : sideways ? w : h;
  // turning about the page's own corner puts its centre here; move it to the middle of the new page
  const cx = (w / 2) * cos - (h / 2) * sin;
  const cy = (w / 2) * sin + (h / 2) * cos;
  return { pageW, pageH, x: pageW / 2 - cx, y: pageH / 2 - cy, theta };
}

// ---------------------------------------------------------------- finding the tilt of a scan

// The dark pixels of a picture, as points. data: RGBA bytes, a pixel is dark when its brightness is under `limit`.
// `step` skips pixels so a big picture gives a manageable number of points.
export function darkPoints(data, width, height, { limit = 140, step = 1, max = 60000 } = {}) {
  const points = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < limit) points.push({ x, y });
    }
  }
  if (points.length <= max) return points;
  const every = Math.ceil(points.length / max);
  return points.filter((_, i) => i % every === 0);
}

// How sharply the points fall into rows when the page is turned by `a` radians: lines of text turned level give a few full rows
// and many empty ones, which scores higher than the same text spread over many rows.
function sharpness(points, a) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const bins = new Map();
  for (const p of points) {
    const row = Math.round(p.y * cos + p.x * sin);
    bins.set(row, (bins.get(row) || 0) + 1);
  }
  let total = 0;
  for (const n of bins.values()) total += n * n;
  return total;
}

// The share of rows that have any dots in them when the page is turned by `a` radians: text has gaps between its lines, noise has none.
function occupancy(points, a) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const rows = new Set();
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const row = Math.round(p.y * cos + p.x * sin);
    rows.add(row);
    if (row < lo) lo = row;
    if (row > hi) hi = row;
  }
  return rows.size / Math.max(1, hi - lo + 1);
}

// The angle in degrees, clockwise, that turns the picture level. `found` says whether there were lines of text to read it from:
// a level page gives { angle: 0, found: true }, while scattered dots or too few of them give { angle: 0, found: false }.
// Searches +-range degrees, coarsely and then finely.
export function estimateSkew(points, { range = 20 } = {}) {
  if (points.length < 300) return { angle: 0, found: false };
  const rad = (d) => (d * Math.PI) / 180;
  const level = sharpness(points, 0);
  let best = { a: 0, s: level };
  for (let d = -range; d <= range + 1e-9; d += 0.5) {
    const s = sharpness(points, rad(d));
    if (s > best.s) best = { a: d, s };
  }
  const centre = best.a;
  for (let d = centre - 0.5; d <= centre + 0.5 + 1e-9; d += 0.05) {
    const s = sharpness(points, rad(d));
    if (s > best.s) best = { a: d, s };
  }
  // text that is hardly tilted gains almost nothing from turning it
  const angle = best.s < level * 1.03 ? 0 : Math.round(best.a * 20) / 20;
  if (occupancy(points, rad(angle)) > 0.85) return { angle: 0, found: false };
  return { angle, found: true };
}

// ---------------------------------------------------------------- wording

export function describeTurns(turns, count) {
  const parts = [];
  const by = (deg) => [...turns.values()].filter((t) => t === deg).length;
  const pages = (n) => `${n} page${n === 1 ? "" : "s"}`;
  if (by(90)) parts.push(`${pages(by(90))} turned right`);
  if (by(270)) parts.push(`${pages(by(270))} turned left`);
  if (by(180)) parts.push(`${pages(by(180))} turned upside down`);
  return parts.length ? parts.join(", ") : count ? "no page is turned" : "";
}
