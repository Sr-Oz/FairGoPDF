// Sign PDF: the rules (turning a spot chosen on the page as it is shown into the page's own coordinates, dates, which text the PDF's
// built-in font can set, wording), kept apart from the page so they can be tested. No DOM and no PDF library in here.

// The page is shown the way a viewer shows it: its crop box, with any rotation applied. The person picks a spot as a fraction of
// that picture, from its top-left. This turns the box's bottom-left corner into the page's own coordinates (origin at the bottom
// left of the unrotated page), and gives the angle to turn what is drawn so that it still reads upright.
//   box: the page's crop box { x, y, width, height } in points; rotation: the page's own /Rotate (a multiple of 90)
//   xFrac, yFrac: the box's top-left as fractions of the shown page; wPts, hPts: its size in points as shown
// -> { x, y, rotate } where (x, y) is where the bottom-left corner of the drawing goes and rotate is in degrees, counter-clockwise
export function placeBox({ xFrac, yFrac, wPts, hPts, box, rotation = 0 }) {
  const rot = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const shownH = rot % 180 === 0 ? box.height : box.width;
  const u0 = xFrac;
  const v1 = yFrac + hPts / shownH; // the bottom edge, as a fraction from the shown page's top
  let x;
  let y;
  if (rot === 90) { x = box.x + v1 * box.width; y = box.y + u0 * box.height; }
  else if (rot === 180) { x = box.x + (1 - u0) * box.width; y = box.y + v1 * box.height; }
  else if (rot === 270) { x = box.x + (1 - v1) * box.width; y = box.y + (1 - u0) * box.height; }
  else { x = box.x + u0 * box.width; y = box.y + (1 - v1) * box.height; }
  return { x, y, rotate: rot };
}

// the size of the page as it is shown
export const shownSize = (box, rotation = 0) => (((Math.round(rotation / 90) * 90) % 360 + 360) % 360) % 180 === 0 ? { w: box.width, h: box.height } : { w: box.height, h: box.width };

// ---------------------------------------------------------------- dates

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n) => String(n).padStart(2, "0");

export const DATE_STYLES = { dmy: "05/11/2026", short: "5 Nov 2026", long: "5 November 2026", iso: "2026-11-05" };

export function formatDate(date, style = "dmy") {
  const d = date.getDate();
  const m = date.getMonth();
  const y = date.getFullYear();
  if (style === "short") return `${d} ${MONTHS[m].slice(0, 3)} ${y}`;
  if (style === "long") return `${d} ${MONTHS[m]} ${y}`;
  if (style === "iso") return `${y}-${two(m + 1)}-${two(d)}`;
  return `${two(d)}/${two(m + 1)}/${y}`;
}

// ---------------------------------------------------------------- text

// Can the PDF's built-in font set every character? Its set is Latin-1 and a few more; anything else (macrons, other scripts) has
// to be drawn as a picture instead.
const WIN_ANSI = /^[\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;
export const pdfSafe = (text) => WIN_ANSI.test(text);

// ---------------------------------------------------------------- keeping things on the page

// a box, as fractions of the shown page, moved back inside it
export function keepInside(item, wFrac, hFrac) {
  return {
    ...item,
    x: Math.min(Math.max(0, item.x), Math.max(0, 1 - wFrac)),
    y: Math.min(Math.max(0, item.y), Math.max(0, 1 - hFrac)),
  };
}

// ---------------------------------------------------------------- wording

const KIND_NAMES = { signature: ["signature", "signatures"], date: ["date", "dates"], text: ["text", "texts"], tick: ["tick", "ticks"], cross: ["cross", "crosses"] };

// "2 signatures and a date on 2 pages"
export function describeItems(items) {
  if (!items.length) return "Nothing placed yet.";
  const counts = new Map();
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${(KIND_NAMES[k] || [k, k])[n === 1 ? 0 : 1]}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const pages = new Set(items.map((i) => i.page)).size;
  return `${list} on ${pages} page${pages === 1 ? "" : "s"}.`;
}
