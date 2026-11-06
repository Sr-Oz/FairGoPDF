// PDF Annotator: the rules (which text a drag takes in, where a mark goes on each line, how a freehand stroke is smoothed, how big
// each kind of annotation is), kept apart from the page so they can be tested. No DOM and no PDF library in here, and the preview
// and the saved PDF both use these, so what is shown is what is written.
//
// Coordinates are in points on the page as a viewer shows it, from its top left, y counting down.

// ---------------------------------------------------------------- finding the text a drag covers

// runs: the pieces of text on a page in the order the PDF holds them (which is reading order for most documents), each
// { str, x, y, w, h } with (x, y) the top left of its box.

// the run closest to a point, or -1 when none is within `slack` points
export function nearestRun(runs, p, slack = 12) {
  let best = -1;
  let bestD = Infinity;
  runs.forEach((r, i) => {
    if (!r.str || !r.str.trim()) return;
    const dx = p.x < r.x ? r.x - p.x : p.x > r.x + r.w ? p.x - (r.x + r.w) : 0;
    const dy = p.y < r.y ? r.y - p.y : p.y > r.y + r.h ? p.y - (r.y + r.h) : 0;
    // a point beside text on its own line counts as nearer than one the same distance above or below it
    const d = Math.hypot(dx, dy * 1.6);
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= slack ? best : -1;
}

// where the characters of a run begin and end across its width: positions 0..n, scaled so the last is the run's width.
// measure(text) is how wide a text is, in any unit.
export function charEdges(str, w, measure) {
  const chars = [...str];
  const raw = [0];
  let acc = "";
  for (const c of chars) { acc += c; raw.push(measure(acc)); }
  const total = raw[raw.length - 1] || 1;
  return raw.map((v) => (v / total) * w);
}

// the number of characters from the start of a run that lie before x (nearest boundary)
export function charAt(edges, x) {
  let best = 0;
  for (let i = 0; i < edges.length; i++) if (Math.abs(edges[i] - x) < Math.abs(edges[best] - x)) best = i;
  return best;
}

// The boxes that selecting text from point `a` to point `b` covers, as when the text is picked out with a mouse: from where the drag
// began to where it ended, following the order of the runs. `measure(text, run)` is the width of a text in that run's font.
// Boxes on one line that touch are joined. -> [{ x, y, w, h }]; empty when the drag started or ended away from any text.
export function selectText(runs, a, b, measure, slack = 12) {
  const ia = nearestRun(runs, a, slack);
  const ib = nearestRun(runs, b, slack);
  if (ia < 0 || ib < 0) return [];
  const from = Math.min(ia, ib);
  const to = Math.max(ia, ib);
  // the drag runs backwards when it ended before it began: the earlier point is where the selection starts
  const first = ia <= ib ? a : b;
  const last = ia <= ib ? b : a;
  const boxes = [];
  for (let i = from; i <= to; i++) {
    const r = runs[i];
    if (!r.str || !r.str.trim()) continue;
    const e = charEdges(r.str, r.w, (t) => measure(t, r));
    let c0 = 0;
    let c1 = e.length - 1;
    if (i === from) c0 = charAt(e, (ia === ib ? Math.min(a.x, b.x) : first.x) - r.x);
    if (i === to) c1 = charAt(e, (ia === ib ? Math.max(a.x, b.x) : last.x) - r.x);
    if (c1 <= c0) continue;
    boxes.push({ x: r.x + e[c0], y: r.y, w: e[c1] - e[c0], h: r.h });
  }
  return mergeLine(boxes);
}

// boxes that sit on one line and nearly touch become one
export function mergeLine(boxes) {
  const out = [];
  for (const b of boxes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - b.y) <= 0.4 * Math.max(last.h, b.h) && b.x >= last.x - 1 && b.x - (last.x + last.w) <= 0.6 * Math.max(last.h, b.h)) {
      const right = Math.max(last.x + last.w, b.x + b.w);
      const top = Math.min(last.y, b.y);
      const bottom = Math.max(last.y + last.h, b.y + b.h);
      Object.assign(last, { y: top, h: bottom - top, w: right - last.x });
    } else out.push({ ...b });
  }
  return out;
}

// ---------------------------------------------------------------- freehand strokes

// A stroke through these points as an SVG path, smoothed by curves through the midpoints, which looks the same as the saved PDF
// draws it. (x, y) are page points from the top left.
export function strokePath(points, decimals = 1) {
  const f = (n) => Number(n.toFixed(decimals));
  if (!points.length) return "";
  if (points.length === 1) { const p = points[0]; return `M${f(p.x)} ${f(p.y)} L${f(p.x + 0.1)} ${f(p.y)}`; }
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q${f(points[i].x)} ${f(points[i].y)} ${f(mx)} ${f(my)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${f(last.x)} ${f(last.y)}`;
}

// ---------------------------------------------------------------- shapes

// the three points of an arrow's head, at the tip (x2, y2) of a line from (x1, y1)
export function arrowHead(x1, y1, x2, y2, width) {
  const len = Math.max(8, width * 4.5);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    { x: x2, y: y2 },
    { x: x2 - len * Math.cos(angle - spread), y: y2 - len * Math.sin(angle - spread) },
    { x: x2 - len * Math.cos(angle + spread), y: y2 - len * Math.sin(angle + spread) },
  ];
}

// the box around any item: { x, y, w, h }
export function boundsOf(it) {
  if (it.kind === "mark") {
    const xs = it.rects.flatMap((r) => [r.x, r.x + r.w]);
    const ys = it.rects.flatMap((r) => [r.y, r.y + r.h]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (it.kind === "ink") {
    const xs = it.points.map((p) => p.x);
    const ys = it.points.map((p) => p.y);
    const pad = it.width / 2;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + it.width, h: Math.max(...ys) - Math.min(...ys) + it.width };
  }
  if (it.kind === "shape") {
    const pad = it.width / 2;
    const x = Math.min(it.x1, it.x2);
    const y = Math.min(it.y1, it.y2);
    return { x: x - pad, y: y - pad, w: Math.abs(it.x2 - it.x1) + it.width, h: Math.abs(it.y2 - it.y1) + it.width };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

// an item moved by (dx, dy); returns a new item
export function moved(it, dx, dy) {
  if (it.kind === "mark") return { ...it, rects: it.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) };
  if (it.kind === "ink") return { ...it, points: it.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  if (it.kind === "shape") return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
  return { ...it, x: it.x + dx, y: it.y + dy };
}

// a dx, dy that keeps the item's box on the page
export function keepDelta(box, dx, dy, page) {
  const x = Math.min(Math.max(box.x + dx, 0), Math.max(0, page.w - box.w));
  const y = Math.min(Math.max(box.y + dy, 0), Math.max(0, page.h - box.h));
  return { dx: x - box.x, dy: y - box.y };
}

// ---------------------------------------------------------------- notes

export const NOTE_PAD = 8;
export const NOTE_LINE = 1.25;
export const noteHeight = (lineCount, size) => Math.max(1, lineCount) * size * NOTE_LINE + 2 * NOTE_PAD;

// ---------------------------------------------------------------- wording

const NAMES = { highlight: ["highlight", "highlights"], underline: ["underline", "underlines"], strike: ["strikethrough", "strikethroughs"], ink: ["drawing", "drawings"], shape: ["shape", "shapes"], note: ["note", "notes"] };
const nameOf = (it) => (it.kind === "mark" ? it.style : it.kind);

// "3 highlights and 1 note on 2 pages."
export function describeItems(items) {
  if (!items.length) return "Nothing added yet.";
  const counts = new Map();
  for (const it of items) counts.set(nameOf(it), (counts.get(nameOf(it)) || 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${(NAMES[k] || [k, k])[n === 1 ? 0 : 1]}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const pages = new Set(items.map((i) => i.page)).size;
  return `${list} on ${pages} page${pages === 1 ? "" : "s"}.`;
}
