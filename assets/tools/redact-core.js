// Redact PDF: the maths that turns a box drawn on the preview into black pixels on the final page, kept apart from the page
// so it can be tested. A wrong box here means text that was meant to be hidden stays readable, so it is worth getting right.
// No DOM in here.
//
// A box is { x, y, w, h } in points on the page as it is shown (after any crop box and rotation), with the origin at the
// bottom-left, the way PDF measures. Canvas pixels have the origin at the top-left.

export const MIN_DRAG_PX = 4; // a smaller drag is a stray click, not a box
const EPS = 1e-6; // keeps a box that lands exactly on a pixel line from growing a pixel in floating point
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A drag on the preview, from point a to point b in canvas pixels, to a box in points. The drag can go in any direction, and
// can run past the edge of the page (the pointer is captured, so it keeps tracking outside the canvas): the box is trimmed to
// the page. Returns null when the box is too small to be deliberate.
export function boxFromDrag(a, b, scale, pageWidthPt, pageHeightPt) {
  const left = clamp(Math.min(a.x, b.x) / scale, 0, pageWidthPt);
  const right = clamp(Math.max(a.x, b.x) / scale, 0, pageWidthPt);
  const top = clamp(Math.min(a.y, b.y) / scale, 0, pageHeightPt);
  const bottom = clamp(Math.max(a.y, b.y) / scale, 0, pageHeightPt);
  if ((right - left) * scale < MIN_DRAG_PX || (bottom - top) * scale < MIN_DRAG_PX) return null;
  return { x: left, y: pageHeightPt - bottom, w: right - left, h: bottom - top };
}

// A box in points to the whole pixels to paint black. The edges go outwards, never inwards: a box that ended halfway through a
// pixel would otherwise leave that pixel half-covered and faint text could show through. The height of the page in points is
// used, not the height of the canvas, which pdf.js rounds to a whole pixel.
export function boxToPixels(box, scale, pageHeightPt, canvasWidth, canvasHeight) {
  const x0 = clamp(Math.floor(box.x * scale + EPS), 0, canvasWidth);
  const x1 = clamp(Math.ceil((box.x + box.w) * scale - EPS), 0, canvasWidth);
  const y0 = clamp(Math.floor((pageHeightPt - box.y - box.h) * scale + EPS), 0, canvasHeight);
  const y1 = clamp(Math.ceil((pageHeightPt - box.y) * scale - EPS), 0, canvasHeight);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// How big to draw a page for the final file: 2.5 times its size for sharp text, or less if the picture would be bigger than
// phones' browsers can draw (Safari gives a blank canvas past about 16 million pixels, which would turn a poster into a blank page).
export function outputScale(pageWidthPt, pageHeightPt, { target = 2.5, maxPixels = 16_000_000 } = {}) {
  return Math.min(target, Math.sqrt(maxPixels / (pageWidthPt * pageHeightPt)));
}
