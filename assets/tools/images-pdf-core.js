// Images to PDF: the rules (where a picture sits on its page, how far it is shrunk, how it is turned and named), kept
// apart from the page so they can be tested. No DOM and no PDF library in here.

export const SIZES = { a3: [297, 420], a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4], legal: [215.9, 355.6] };
export const SIZE_LABELS = { a3: "A3", a4: "A4", a5: "A5", letter: "US Letter", legal: "US Legal" };
const MM = 72 / 25.4; // points in a millimetre

// Where a picture goes on its page, in PDF points (origin at the bottom left).
//   size: image (the page is the picture's size, plus the margin all round) or a key of SIZES
//   orientation: auto (sideways for a wide picture) | portrait | landscape
//   fit: inside (all of the picture shows) | fill (the picture covers the page area and its overhang is cropped)
// `clip` is the box the picture is cropped to, or null when nothing is cropped.
export function pagePlacement({ w, h, size = "a4", orientation = "auto", marginMm = 0, fit = "inside" }) {
  if (size === "image" || !SIZES[size]) {
    const m = Math.max(0, marginMm) * MM;
    const width = w * 0.75; // 96 pixels to the inch on screen, 72 points to the inch in a PDF
    const height = h * 0.75;
    return { pw: width + 2 * m, ph: height + 2 * m, x: m, y: m, width, height, clip: null };
  }
  let [pw, ph] = SIZES[size].map((v) => v * MM);
  const landscape = orientation === "landscape" || (orientation === "auto" && w > h);
  if (landscape !== pw > ph) [pw, ph] = [ph, pw];
  const m = Math.min(Math.max(0, marginMm) * MM, Math.min(pw, ph) * 0.4); // a margin can never use up the page
  const availW = pw - 2 * m;
  const availH = ph - 2 * m;
  const k = (fit === "fill" ? Math.max : Math.min)(availW / w, availH / h);
  const width = w * k;
  const height = h * k;
  return { pw, ph, x: (pw - width) / 2, y: (ph - height) / 2, width, height, clip: fit === "fill" ? { x: m, y: m, width: availW, height: availH } : null };
}

// How much a picture is shrunk before it goes in. Only a picture bigger than the limit is touched; the limits are
// A4 at 300 pixels to the inch (balanced) and at 200 (small).
export const LEVELS = { original: null, balanced: { maxSide: 2480, quality: 0.85 }, small: { maxSide: 1654, quality: 0.7 } };

export function shrinkPlan(w, h, level) {
  const rule = LEVELS[level];
  if (!rule) return { width: w, height: h, shrink: false, quality: 0.92 };
  const k = Math.min(1, rule.maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), shrink: k < 1, quality: rule.quality };
}

// ---------------------------------------------------------------- turning

export const turned = (deg, direction) => (((deg + (direction > 0 ? 90 : -90)) % 360) + 360) % 360;
export const rotatedSize = (w, h, deg) => (deg % 180 ? { w: h, h: w } : { w, h });

// ---------------------------------------------------------------- names and wording

// With one picture the file is named after it; with several, "images"
export function suggestName(fileNames) {
  if (fileNames.length !== 1) return "images";
  return fileNames[0].replace(/\.[^.\\/]+$/, "") || "images";
}

export function describePlan({ count, size, orientation, marginMm, fit }) {
  const pages = `${count} page${count === 1 ? "" : "s"}`;
  const margin = marginMm > 0 ? `, ${marginMm} mm margin` : "";
  if (size === "image") return `${pages}, each the size of its picture${margin}.`;
  const turn = orientation === "auto" ? "turned sideways for wide pictures" : orientation;
  return `${pages}, ${SIZE_LABELS[size] || size} ${turn}${margin}${fit === "fill" ? ", pictures fill the page and are cropped" : ""}.`;
}
