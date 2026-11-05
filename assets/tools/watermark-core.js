// Watermark PDF: the rules (how big a mark is, where the marks go on a page, which pages get one), kept apart from the page so they can
// be tested. No DOM and no PDF library in here. The page's preview and the saved PDF both take their marks from layoutMarks, so what
// is shown is what is written.
//
// Coordinates are those of the page as a viewer shows it, in points, with the origin at the bottom left and y going up. A mark is a
// box (w x h) turned about its own centre by `angle` degrees counter-clockwise.
import { parsePageSpec } from "/assets/tools/page-tools.js";

const rad = (d) => (d * Math.PI) / 180;

// half the width and height of the box that holds a w x h box turned by angle
export function boxExtent(w, h, angle) {
  const c = Math.abs(Math.cos(rad(angle)));
  const s = Math.abs(Math.sin(rad(angle)));
  return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
}

// where the bottom left corner of a w x h box goes so that, turned about its own centre, the box is centred on (cx, cy)
export function bottomLeft(cx, cy, w, h, angle) {
  const c = Math.cos(rad(angle));
  const s = Math.sin(rad(angle));
  return { x: cx - (w / 2) * c + (h / 2) * s, y: cy - (w / 2) * s - (h / 2) * c };
}

// Capital letters are about this tall compared with the type size; a mark's box is as tall as its capitals, so it looks centred.
export const CAP_HEIGHT = 0.72;

// The type size that makes text fill about `fill` of the page along the way it is turned. textWidthAt1 is how wide the text is at size 1.
export function autoTextSize({ textWidthAt1, pageW, pageH, angle, fill = 0.8 }) {
  if (!(textWidthAt1 > 0)) return 12;
  const { hw, hh } = boxExtent(textWidthAt1, CAP_HEIGHT, angle);
  const size = Math.min((fill * pageW) / (2 * hw), (fill * pageH) / (2 * hh));
  return Math.min(Math.max(size, 8), 400);
}

export const POSITIONS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
// how far apart tiled marks sit, as a share of the mark's own width and height
export const SPACING = { tight: { x: 0.15, y: 1 }, normal: { x: 0.4, y: 2.5 }, wide: { x: 0.9, y: 5 } };
export const MAX_MARKS = 300;

// The marks on one page.
//   page: { w, h } as shown; mark: { w, h } before turning; angle in degrees
//   mode: "single" (put at `position`, `margin` in from the edges) or "tiled" (repeated across the page, `spacing` is a key of
//   SPACING, `stagger` shifts every other row by half a step)
// -> { marks: [{ cx, cy }], capped }
export function layoutMarks({ page, mark, angle = 0, mode = "single", position = "mc", margin = 36, spacing = "normal", stagger = true }) {
  const { hw, hh } = boxExtent(mark.w, mark.h, angle);
  if (mode !== "tiled") {
    const col = position[1] || "c";
    const row = position[0] || "m";
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi)); // too big to fit: centred
    const cx = col === "l" ? margin + hw : col === "r" ? page.w - margin - hw : page.w / 2;
    const cy = row === "t" ? page.h - margin - hh : row === "b" ? margin + hh : page.h / 2;
    return { marks: [{ cx: col === "c" ? cx : clamp(cx, hw, page.w - hw), cy: row === "m" ? cy : clamp(cy, hh, page.h - hh) }], capped: false };
  }
  const sp = SPACING[spacing] || SPACING.normal;
  const u = mark.w + sp.x * mark.w;
  const v = mark.h + sp.y * mark.h;
  const c = Math.cos(rad(angle));
  const s = Math.sin(rad(angle));
  const diag = Math.hypot(page.w, page.h);
  const I = Math.ceil(diag / (2 * u)) + 1;
  const J = Math.ceil(diag / (2 * v)) + 1;
  const found = [];
  for (let j = -J; j <= J; j++) {
    for (let i = -I; i <= I; i++) {
      const lx = i * u + (stagger && Math.abs(j) % 2 === 1 ? u / 2 : 0);
      const ly = j * v;
      const cx = page.w / 2 + lx * c - ly * s;
      const cy = page.h / 2 + lx * s + ly * c;
      if (cx + hw > 0 && cx - hw < page.w && cy + hh > 0 && cy - hh < page.h) found.push({ cx, cy, d: Math.hypot(lx, ly) });
    }
  }
  found.sort((a, b) => a.d - b.d);
  const capped = found.length > MAX_MARKS;
  return { marks: found.slice(0, MAX_MARKS).map(({ cx, cy }) => ({ cx, cy })), capped };
}

// Which pages get a mark. mode: "all", "notfirst", "odd", "even" or "pages" (spec is the visitor's list, such as "1-3, 7").
// -> { pages: [index from 0], error }
export function pagesFor({ mode, spec, count }) {
  const all = Array.from({ length: count }, (_, i) => i);
  if (mode === "notfirst") return { pages: all.slice(1) };
  if (mode === "odd") return { pages: all.filter((i) => i % 2 === 0) };
  if (mode === "even") return { pages: all.filter((i) => i % 2 === 1) };
  if (mode === "pages") {
    if (!String(spec || "").trim()) return { pages: [], error: "Type the pages to mark, such as 1-3, 7." };
    const r = parsePageSpec(spec, count);
    if (r.error) return { pages: [], error: r.error };
    return { pages: r.pages.map((p) => p - 1) };
  }
  return { pages: all };
}

// "#aabbcc" -> { r, g, b } each 0 to 1
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const n = m ? parseInt(m[1], 16) : 0x888888;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// "On 3 of 5 pages." / "On every page."
export function describePages(n, count) {
  if (!n) return "No pages selected.";
  if (n === count) return count === 1 ? "On the page." : "On every page.";
  return `On ${n} of ${count} pages.`;
}
