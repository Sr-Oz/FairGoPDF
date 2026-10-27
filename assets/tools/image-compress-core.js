// The rules behind the Compress Image page, kept apart from the page so they can be tested: what size an image should come
// out at, which format it is saved in, and how big "500 KB" is. No DOM in here.

const whole = (n) => Math.max(1, Math.round(n));

// r: { mode: "none" | "fit" | "percent" | "crop", maxW, maxH, percent, width, height }
// -> the box to draw into (dw, dh) and the part of the original to draw from (sx, sy, sw, sh)
export function planSize(w, h, r = {}) {
  const all = (dw, dh) => ({ dw: whole(dw), dh: whole(dh), sx: 0, sy: 0, sw: w, sh: h });
  if (r.mode === "fit") {
    const k = Math.min(1, r.maxW > 0 ? r.maxW / w : 1, r.maxH > 0 ? r.maxH / h : 1); // never enlarges
    return all(w * k, h * k);
  }
  if (r.mode === "percent") {
    const k = Math.min(1, r.percent / 100);
    return all(w * k, h * k);
  }
  if (r.mode === "crop") {
    // fill the box exactly, trimming whatever sticks out evenly from both sides
    const k = Math.max(r.width / w, r.height / h);
    const sw = r.width / k;
    const sh = r.height / k;
    return { dw: whole(r.width), dh: whole(r.height), sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
  }
  return all(w, h);
}

export const MAX_SIDE = 16000; // beyond this many browsers return a blank canvas

// -> a message for the visitor, or "" when the size settings can be used
export function validateResize(r) {
  if (r.mode === "fit" && !(r.maxW > 0) && !(r.maxH > 0)) return "Enter a maximum width, a maximum height, or both.";
  if (r.mode === "percent" && !(r.percent >= 1 && r.percent <= 100)) return "Enter a percentage from 1 to 100.";
  if (r.mode === "crop") {
    if (!(r.width >= 1) || !(r.height >= 1)) return "Enter both a width and a height to crop to.";
    if (r.width > MAX_SIDE || r.height > MAX_SIDE) return `Keep the width and height under ${MAX_SIDE} pixels.`;
  }
  if (r.mode === "fit" && (r.maxW > MAX_SIDE || r.maxH > MAX_SIDE)) return `Keep the width and height under ${MAX_SIDE} pixels.`;
  return "";
}

export const isResized = (plan, w, h) => plan.dw !== w || plan.dh !== h || plan.sw !== w || plan.sh !== h;

// s: { format: "keep" | a mime type, method: "quality" | "target", convertBig, convertMB }
export function outputType(fileType, fileSize, s, canWebp = true) {
  let type = s.format === "keep" ? fileType : s.format;
  // a big PNG photo is far smaller as a JPEG
  if (s.format === "keep" && s.convertBig && fileType === "image/png" && fileSize > s.convertMB * 1e6) type = "image/jpeg";
  // a file-size target needs a format whose quality can be turned down
  if (s.method === "target" && type === "image/png") type = "image/webp";
  if (type === "image/webp" && !canWebp) type = "image/jpeg";
  return type;
}

export const targetBytes = (amount, unitBytes) => Math.floor(amount * unitBytes);

// The page names saved files after the original, so two inputs called photo.jpg and photo.png must not collide in a ZIP
export function uniqueName(name, taken) {
  if (!taken.has(name)) { taken.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  for (let n = 2; ; n++) {
    const next = `${stem}-${n}${ext}`;
    if (!taken.has(next)) { taken.add(next); return next; }
  }
}
