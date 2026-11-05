// PDF Editor: the rules (breaking text into lines that fit a box, where each line's baseline goes, where a text line starts for each
// alignment, finding a page's background colour), kept apart from the page so they can be tested. No DOM and no PDF library in here.
// The preview and the saved PDF break and place lines with the same functions, so what is shown is what is written.
//
// Coordinates are in points on the page as a viewer shows it, from its top left, y counting down.

// ---------------------------------------------------------------- breaking text into lines

// The lines a text breaks into when each may be at most `width` wide. `measure(string)` is how wide a string is. A line break the
// writer typed is kept; words are never split unless one alone is wider than the box, and then it is cut where it has to be.
export function wrapText(text, width, measure) {
  const out = [];
  for (const paragraph of String(text ?? "").split(/\r\n|\r|\n/)) {
    if (paragraph.trim() === "") { out.push(""); continue; }
    let line = "";
    // one word wider than the box on its own: cut it into pieces that fit
    const chop = () => {
      while (measure(line.replace(/\s+$/, "")) > width && [...line].length > 1) {
        const chars = [...line];
        let cut = chars.length - 1;
        while (cut > 1 && measure(chars.slice(0, cut).join("")) > width) cut--;
        out.push(chars.slice(0, cut).join(""));
        line = chars.slice(cut).join("");
      }
    };
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (line === "" || measure((line + word).replace(/\s+$/, "")) <= width) line += word;
      else { out.push(line.replace(/\s+$/, "")); line = word; }
      chop();
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}

// ---------------------------------------------------------------- where the lines go

// how far a font's baseline sits below the middle of its line box, as a share of the type size, for the browser fonts the preview uses
// ((ascent - descent) / 2 of Arial, Times New Roman and Courier New, which the standard PDF fonts match)
const BASELINE_SHIFT = { Helvetica: 0.3465, TimesRoman: 0.3375, Courier: 0.2665 };

// the baseline of line `index` of a text box, measured down from the top of the box
export function baselineFromTop(family, size, spacing, index) {
  const shift = BASELINE_SHIFT[family] ?? BASELINE_SHIFT.Helvetica;
  return index * size * spacing + (size * spacing) / 2 + shift * size;
}

export const textHeight = (lineCount, size, spacing) => Math.max(1, lineCount) * size * spacing;

// where a line of this width starts, across a box
export function lineX(box, lineWidth, align = "left") {
  if (align === "right") return box.x + box.w - lineWidth;
  if (align === "center") return box.x + (box.w - lineWidth) / 2;
  return box.x;
}

// ---------------------------------------------------------------- keeping things on the page

// a box moved back so that it is wholly on the page (or as much of it as fits, from the top left)
export function keepOnPage(box, page) {
  const x = Math.min(Math.max(0, box.x), Math.max(0, page.w - box.w));
  const y = Math.min(Math.max(0, box.y), Math.max(0, page.h - box.h));
  return { ...box, x, y };
}

// ---------------------------------------------------------------- colours

const hex2 = (n) => Math.round(n).toString(16).padStart(2, "0");
export const toHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function fromHex(hex, fallback = { r: 0, g: 0, b: 0 }) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// the middle colour of a set of pixels (RGBA bytes, as from a canvas): the median of each channel, so a few stray dark specks of text
// at the edge of a box do not tip it. Pixels that are see-through are left out. -> { r, g, b } or null when there are none.
export function medianColour(rgba) {
  const r = [];
  const g = [];
  const b = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    r.push(rgba[i]);
    g.push(rgba[i + 1]);
    b.push(rgba[i + 2]);
  }
  if (!r.length) return null;
  const mid = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  return { r: mid(r), g: mid(g), b: mid(b) };
}

// ---------------------------------------------------------------- wording

const KINDS = { text: ["text box", "text boxes"], picture: ["picture", "pictures"], box: ["box", "boxes"] };

// "2 text boxes and a picture on 2 pages."
export function describeItems(items) {
  if (!items.length) return "Nothing added yet.";
  const counts = new Map();
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${(KINDS[k] || [k, k])[n === 1 ? 0 : 1]}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const pages = new Set(items.map((i) => i.page)).size;
  return `${list} on ${pages} page${pages === 1 ? "" : "s"}.`;
}
