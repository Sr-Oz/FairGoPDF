// PDF to Images: the rules, kept apart from the page so they can be tested. Nothing here touches the DOM.

export const FORMATS = {
  png: { mime: "image/png", ext: "png", lossy: false, alpha: true },
  jpg: { mime: "image/jpeg", ext: "jpg", lossy: true, alpha: false },
  webp: { mime: "image/webp", ext: "webp", lossy: true, alpha: true },
};

// Browsers refuse canvases past about 16,384 px a side, and past roughly this many pixels in all they run out of memory.
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 120e6;

// How big a page becomes. A PDF page is measured in points (1/72 inch).
// mode "dpi": px per inch / 72. "width": the page is px wide. "side": its longest side is px.
// If the result would be too large for a canvas, it is scaled down to fit and `clamped` says so.
export function planScale({ widthPt, heightPt, mode = "dpi", dpi = 150, px = 1600, maxSide = MAX_SIDE, maxPixels = MAX_PIXELS }) {
  let scale;
  if (mode === "width") scale = px / widthPt;
  else if (mode === "side") scale = px / Math.max(widthPt, heightPt);
  else scale = dpi / 72;
  let w = widthPt * scale;
  let h = heightPt * scale;
  let clamped = false;
  const over = Math.max(w / maxSide, h / maxSide, Math.sqrt((w * h) / maxPixels));
  if (over > 1) { scale /= over; w /= over; h /= over; clamped = true; }
  return { scale, width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), clamped };
}

// Only PNG and WebP can hold transparency; JPG has no choice but a solid background.
export function usesTransparency(format, background) {
  return background === "transparent" && !!FORMATS[format]?.alpha;
}

// The number is padded to the width of the page count, so "page-02" sorts before "page-10" in a file list.
export function imageName(base, page, total, ext, pad = true) {
  const digits = pad ? String(Math.max(total, 1)).length : 1;
  return `${base}-page-${String(page).padStart(digits, "0")}.${ext}`;
}

// A stacked image is named after the pages it holds: "doc-pages-1-12.png", or "doc-page-4.png" when it holds one
export function stitchName(base, first, last, ext) {
  return first === last ? `${base}-page-${first}.${ext}` : `${base}-pages-${first}-${last}.${ext}`;
}

// "One long image": the pages are stacked, each centred in a column as wide as the widest page, with `gap` px between them.
// A stack that would be too tall for a canvas is cut into several images, always keeping at least one page in each.
export function planStitch(sizes, gap = 0, maxSide = MAX_SIDE, maxPixels = MAX_PIXELS) {
  const width = Math.max(1, ...sizes.map((s) => s.width));
  const maxHeight = Math.max(1, Math.min(maxSide, Math.floor(maxPixels / width)));
  const groups = [];
  let cur = null;
  sizes.forEach((s, index) => {
    const next = cur ? cur.height + gap + s.height : s.height;
    if (!cur || next > maxHeight) {
      cur = { height: 0, items: [] };
      groups.push(cur);
    }
    const y = cur.items.length ? cur.height + gap : 0;
    cur.items.push({ index, x: Math.round((width - s.width) / 2), y, width: s.width, height: s.height });
    cur.height = y + s.height;
  });
  return { width, groups };
}

// Pixel operations on canvas image data (RGBA bytes), changing it in place. Transparency is left as it is.
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export function toGreyscale(data) {
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(luma(data[i], data[i + 1], data[i + 2]));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return data;
}

// threshold 0 to 255: anything lighter than it becomes white, the rest black
export function toBlackWhite(data, threshold = 128) {
  for (let i = 0; i < data.length; i += 4) {
    const v = luma(data[i], data[i + 1], data[i + 2]) >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return data;
}

// A human line about what will be made, e.g. "3 pages, each 1240 x 1754 px"
export function describeSize(plans) {
  if (!plans.length) return "";
  const first = plans[0];
  const same = plans.every((p) => p.width === first.width && p.height === first.height);
  return same ? `${first.width} × ${first.height} px` : `${first.width} × ${first.height} px for the first page, others differ`;
}
