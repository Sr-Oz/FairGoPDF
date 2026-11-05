// Add Page Numbers: the rules (how a number is written, what the label says, where it sits on a page), kept apart from the page so
// they can be tested. No DOM and no PDF library in here. Which pages get a number is pagesFor in watermark-core.js.
//
// Coordinates are those of the page as a viewer shows it, in points, with the origin at the bottom left and y going up.

// ---------------------------------------------------------------- writing a number

export const STYLES = { arabic: "1, 2, 3", lower: "i, ii, iii", upper: "I, II, III", letters: "a, b, c", capitals: "A, B, C" };

const ROMAN = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

// a number in one of the STYLES; zero, negatives and numbers too big for the style are written the ordinary way
export function formatNumber(n, style = "arabic", digits = 1) {
  const whole = Math.trunc(n);
  const plain = () => (whole < 0 ? `-${String(-whole).padStart(digits, "0")}` : String(whole).padStart(digits, "0"));
  if (style === "lower" || style === "upper") {
    if (whole < 1 || whole > 3999) return plain();
    let rest = whole;
    let out = "";
    for (const [value, sym] of ROMAN) while (rest >= value) { out += sym; rest -= value; }
    return style === "upper" ? out.toUpperCase() : out;
  }
  if (style === "letters" || style === "capitals") {
    if (whole < 1) return plain();
    let rest = whole;
    let out = "";
    while (rest > 0) { rest--; out = String.fromCharCode(97 + (rest % 26)) + out; rest = Math.floor(rest / 26); }
    return style === "capitals" ? out.toUpperCase() : out;
  }
  return plain();
}

// The label for one page. template has {n} (this page's number) and {total} (how many pages there are), written in `style`.
//   pageIndex counts from 0; start is the number the first page has; digits pads the ordinary style with zeros (Bates numbering)
export function labelFor({ template, pageIndex, total, start = 1, style = "arabic", digits = 1 }) {
  const n = formatNumber(start + pageIndex, style, digits);
  const all = formatNumber(start + total - 1, style, digits);
  return String(template || "{n}").replace(/\{n\}/gi, n).replace(/\{total\}/gi, all);
}

export const PRESETS = [
  { label: "1", template: "{n}" },
  { label: "Page 1", template: "Page {n}" },
  { label: "Page 1 of 10", template: "Page {n} of {total}" },
  { label: "1 / 10", template: "{n} / {total}" },
  { label: "- 1 -", template: "- {n} -" },
  { label: "Bates", template: "DOC-{n}", digits: 6, position: "br" },
];

// ---------------------------------------------------------------- where it sits

// where a label's box goes on a page
//   page: { w, h } as shown; box: { w, h } of the label (h is as tall as its capitals); position: "tl" ... "br" (top, middle or bottom; left,
//   centre or right); margin in from the edges; mirror: on even pages (the left hand page of a book) swap left and right
// -> { x, y } the bottom left of the box; the text's baseline is y
export function placeLabel({ page, box, position = "bc", margin = 28, mirror = false, pageIndex = 0 }) {
  let row = position[0] || "b";
  let col = position[1] || "c";
  if (mirror && pageIndex % 2 === 1) col = col === "l" ? "r" : col === "r" ? "l" : col;
  const x = col === "l" ? margin : col === "r" ? page.w - margin - box.w : (page.w - box.w) / 2;
  const y = row === "t" ? page.h - margin - box.h : row === "m" ? (page.h - box.h) / 2 : margin;
  return { x: Math.min(Math.max(x, 0), Math.max(0, page.w - box.w)), y: Math.min(Math.max(y, 0), Math.max(0, page.h - box.h)) };
}

// a box has to be this much taller and wider than the text to hold a white backing with some air around it
export const BACKING_PAD = 0.35; // of the type size, all round
