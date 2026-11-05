// Compress PDF: the rules (what a picture is shrunk to, which ones are left alone, the levels to try for a size, the wording),
// kept apart from the page so they can be tested. No DOM and no PDF library in here.

export const PRESETS = {
  balanced: { dpi: 150, quality: 0.75, label: "Balanced" },
  smaller: { dpi: 110, quality: 0.6, label: "Smaller" },
  smallest: { dpi: 72, quality: 0.45, label: "Smallest" },
};

// Levels tried one after another when someone asks for a file size: the first that fits is used.
export const SIZE_LEVELS = [
  { dpi: 200, quality: 0.85 },
  { dpi: 150, quality: 0.75 },
  { dpi: 120, quality: 0.65 },
  { dpi: 96, quality: 0.55 },
  { dpi: 72, quality: 0.45 },
  { dpi: 60, quality: 0.35 },
];

// pixels a picture has for each inch of the page it is drawn at, along its longer need
export function effectiveDpi(pxW, pxH, dispWpt, dispHpt) {
  const across = dispWpt > 0 ? pxW / (dispWpt / 72) : Infinity;
  const down = dispHpt > 0 ? pxH / (dispHpt / 72) : Infinity;
  return Math.max(across, down);
}

const TOO_SMALL = 20000; // pixels in all: icons and rules gain nothing and a JPEG of them looks worse
const SKIPPED_SPACES = /^\/(DeviceCMYK|Separation|DeviceN|Lab|Pattern)/;

// What to do with one picture. info: { w, h, dispW, dispH (points, the largest it is drawn at), kind (pdf.js: 1 bilevel, 2 RGB, 3 RGBA),
// colourSpace (as written in the PDF, "" when not known), masked (has a mask or soft mask), stencil (is itself a mask) }
// -> { action: "skip", reason } or { action: "recompress", width, height, scaled }
export function planImage(info, { dpi, quality }) {
  if (info.stencil) return { action: "skip", reason: "a mask" };
  if (info.masked || info.kind === 3) return { action: "skip", reason: "has transparency" };
  if (info.kind === 1) return { action: "skip", reason: "black and white" };
  if (SKIPPED_SPACES.test(info.colourSpace || "")) return { action: "skip", reason: "print colours" };
  if (/^\[?\/?Indexed/.test(info.colourSpace || "")) return { action: "skip", reason: "a flat-colour picture" };
  if (info.w * info.h < TOO_SMALL) return { action: "skip", reason: "small" };
  const eff = effectiveDpi(info.w, info.h, info.dispW, info.dispH);
  const k = Number.isFinite(eff) && eff > dpi ? dpi / eff : 1;
  return { action: "recompress", width: Math.max(1, Math.round(info.w * k)), height: Math.max(1, Math.round(info.h * k)), scaled: k < 0.98 };
}

// a new version is only worth using when it is clearly smaller
export const worthKeeping = (oldBytes, newBytes) => newBytes < oldBytes * 0.95;

// ---------------------------------------------------------------- wording

const UNITS = { KB: 1024, MB: 1048576 };
export const targetBytes = (amount, unit) => Math.floor(Number(amount) * (UNITS[unit] || UNITS.MB));

export function describeSaving(before, after) {
  if (!before) return "";
  const pct = Math.round((1 - after / before) * 100);
  if (pct >= 1) return `${pct}% smaller`;
  if (pct <= -1) return `${-pct}% larger`;
  return "about the same size";
}

// category -> bytes, largest first, as lines such as "Pictures, 9.8 MB"
export function breakdownLines(parts, format) {
  return Object.entries(parts).filter(([, v]) => v.bytes > 0).sort((a, b) => b[1].bytes - a[1].bytes).map(([name, v]) => `${name}, ${format(v.bytes)}${v.count ? ` in ${v.count} ${v.count === 1 ? v.noun : v.noun + "s"}` : ""}`);
}

// what to tell someone about where the bytes are, so they know what to expect
export function expectation(parts, total) {
  const pictures = parts.Pictures ? parts.Pictures.bytes : 0;
  const share = total ? pictures / total : 0;
  if (share >= 0.6) return "Most of this file is pictures, so compressing should save a lot and keep the text sharp.";
  if (share >= 0.25) return "A good part of this file is pictures, so expect a useful saving.";
  return "Little of this file is pictures, so a gentle clean-up will save only a little. If it is a scan, turning pages into pictures shrinks it further.";
}
