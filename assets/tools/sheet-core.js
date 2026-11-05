// Excel to PDF: the layout rules (column widths, shrinking to fit, wrapping, pagination, print areas, wording), kept apart
// from the page so they can be tested. No DOM and no PDF library in here; text is measured by a function the caller passes.

export const PAGE_SIZES = { a4: [595.28, 841.89], a3: [841.89, 1190.55], letter: [612, 792], legal: [612, 1008] };
export const SIZE_LABELS = { a4: "A4", a3: "A3", letter: "US Letter", legal: "US Legal" };
export const MARGINS = { narrow: 28, normal: 42, wide: 64 }; // points

// ---------------------------------------------------------------- page

// auto: sideways when the table is wider than an upright page's usable width
export function pageGeometry(size, orientation, naturalWidth, margin) {
  let [w, h] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  const uprightWidth = Math.min(w, h) - 2 * margin;
  const landscape = orientation === "landscape" || (orientation === "auto" && naturalWidth > uprightWidth);
  if (landscape !== w > h) [w, h] = [h, w];
  return { pageW: w, pageH: h };
}

// ---------------------------------------------------------------- columns

// Excel stores a column's width in characters; on screen that is 7 pixels a character plus 5 of padding
export const excelWidthPt = ({ wpx, wch } = {}) => (Number.isFinite(wpx) ? wpx : Number.isFinite(wch) ? Math.round(wch * 7 + 5) : null) * 0.75 || null;

// The width each column would like, in points. Excel's own width when the file has one; otherwise what its text needs,
// within limits, so a sheet with no saved widths still reads well.
export function naturalWidths(excel, contentWidths, { min = 24, max = 260, fallback = 48 } = {}) {
  const hasAny = excel.some((w) => w);
  return contentWidths.map((content, i) => {
    if (excel[i]) return Math.max(min, excel[i]);
    if (hasAny) return fallback; // the sheet saved widths for some columns, so the rest are Excel's default
    return Math.min(max, Math.max(min, content));
  });
}

// How a row of columns is fitted to the page.
//   fit: shrink everything to fit the width, but not below minScale; past that, carry on with more columns on the next page
//   split: keep full size and carry on with more columns on the next page
// Returns { scale, groups }, each group a list of column positions that share a page width.
export function planColumns(widths, available, mode = "fit", minScale = 0.55) {
  const all = widths.map((_, i) => i);
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= available) return { scale: 1, groups: [all] };
  if (mode === "fit" && available / total >= minScale) return { scale: available / total, groups: [all] };
  const scale = mode === "fit" ? minScale : 1;
  const room = available / scale;
  const groups = [];
  let cur = [];
  let used = 0;
  for (const i of all) {
    if (cur.length && used + widths[i] > room) {
      groups.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += widths[i];
  }
  if (cur.length) groups.push(cur);
  return { scale, groups };
}

// ---------------------------------------------------------------- text

// Greedy word wrap. A word wider than the line is broken between letters. `measure(text)` gives the width in points.
export function wrapText(text, maxWidth, measure) {
  const out = [];
  for (const raw of String(text).split(/\r\n|\r|\n/)) {
    const words = raw.split(/[ \t]+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (measure(trial) <= maxWidth) { line = trial; continue; }
      if (line) { out.push(line); line = ""; }
      if (measure(word) <= maxWidth) { line = word; continue; }
      let piece = "";
      for (const ch of word) {
        if (piece && measure(piece + ch) > maxWidth) { out.push(piece); piece = ""; }
        piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------- rows

// Which rows go on which page. A row is never cut across a page. The header rows (the first `headerCount`) are repeated at the
// top of every later page, unless they take up too much of the page to leave room for anything else.
export function paginate(heights, available, headerCount = 0) {
  const headerH = heights.slice(0, headerCount).reduce((a, b) => a + b, 0);
  const repeat = headerCount > 0 && headerH <= available * 0.4;
  const pages = [];
  let cur = { rows: [], repeat: false };
  let used = 0;
  heights.forEach((h, i) => {
    if (cur.rows.length && used + h > available) {
      pages.push(cur);
      cur = { rows: [], repeat };
      used = repeat ? headerH : 0;
    }
    cur.rows.push(i);
    used += h;
  });
  if (cur.rows.length) pages.push(cur);
  return pages;
}

// ---------------------------------------------------------------- print area

export const columnIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// "Sheet1!$A$1:$F$40", "'My sheet'!$B$2:$D$9" or a single cell. Several areas separated by commas give only the first.
// Rows and columns count from 0. Returns null for anything else (whole rows and columns, names).
export function parsePrintArea(ref) {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/.exec(String(ref).trim());
  if (!m) return null;
  const sheet = (m[1] ? m[1].replace(/''/g, "'") : m[2]).trim();
  const c1 = columnIndex(m[3]);
  const r1 = Number(m[4]) - 1;
  const c2 = m[5] ? columnIndex(m[5]) : c1;
  const r2 = m[6] ? Number(m[6]) - 1 : r1;
  return { sheet, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2), multiple: String(ref).includes(",") };
}

// ---------------------------------------------------------------- colours

// SheetJS gives "RRGGBB", or "AARRGGBB" in some files. Returns { r, g, b } in 0 to 1, or null when it is not a colour or is white.
export function fillColour(rgb) {
  const hex = String(rgb || "").replace(/^#/, "").slice(-6);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  if (n === 0xffffff) return null;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// ---------------------------------------------------------------- wording

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (names) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "));

// What was changed to fit and what could not be carried over. `f` counts what the conversion met.
export function buildNotes(f) {
  const adjusted = [];
  const lost = [];
  if (f.shrunk && f.shrunk.length) adjusted.push(`${f.shrunk.length === 1 ? "sheet" : "sheets"} ${list(f.shrunk)} ${f.shrunk.length === 1 ? "was" : "were"} reduced in size to fit the page width`);
  if (f.split && f.split.length) adjusted.push(`${f.split.length === 1 ? "sheet" : "sheets"} ${list(f.split)} ${f.split.length === 1 ? "is" : "are"} wider than a page, so the columns carry on over more pages`);
  if (f.hiddenRows || f.hiddenCols) {
    const parts = [];
    if (f.hiddenRows) parts.push(plural(f.hiddenRows, "hidden row", "hidden rows"));
    if (f.hiddenCols) parts.push(plural(f.hiddenCols, "hidden column", "hidden columns"));
    adjusted.push(`${parts.join(" and ")} left out, as in Excel`);
  }
  if (f.printArea && f.printArea.length) adjusted.push(`the print area set in Excel was used for ${list(f.printArea)}`);
  if (f.empty && f.empty.length) adjusted.push(`${f.empty.length === 1 ? "sheet" : "sheets"} ${list(f.empty)} ${f.empty.length === 1 ? "has" : "have"} nothing to show, so ${f.empty.length === 1 ? "it was" : "they were"} skipped`);
  if (f.noValue) lost.push(`${plural(f.noValue, "formula has", "formulas have")} no saved result, so ${f.noValue === 1 ? "its cell is" : "their cells are"} blank. Open the file in Excel, save it and try again`);
  if (f.missing) lost.push(f.missing);
  return { adjusted, lost };
}
