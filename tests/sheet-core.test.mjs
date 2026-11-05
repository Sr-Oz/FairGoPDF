import test from "node:test";
import assert from "node:assert/strict";
import { pageGeometry, excelWidthPt, naturalWidths, planColumns, wrapText, paginate, parsePrintArea, columnIndex, fillColour, buildNotes } from "../assets/tools/sheet-core.js";

const monospace = (s) => s.length * 5; // 5 points a character

test("auto turns the page sideways only when the table is wide", () => {
  assert.ok(pageGeometry("a4", "auto", 700, 42).pageW > 800);
  assert.ok(pageGeometry("a4", "auto", 300, 42).pageW < 600);
  assert.ok(pageGeometry("a4", "portrait", 900, 42).pageW < 600);
  assert.ok(pageGeometry("letter", "landscape", 100, 42).pageW === 792);
});

test("excel widths are read from pixels or characters", () => {
  assert.equal(excelWidthPt({ wpx: 64 }), 48);
  assert.equal(excelWidthPt({ wch: 8.43 }), Math.round(8.43 * 7 + 5) * 0.75);
  assert.equal(excelWidthPt({}), null);
  assert.equal(excelWidthPt(), null);
});

test("natural widths: excel's own, else the text's, within limits", () => {
  assert.deepEqual(naturalWidths([60, null], [10, 100]), [60, 48]);
  assert.deepEqual(naturalWidths([null, null, null], [10, 100, 900]), [24, 100, 260]);
});

test("planColumns: fits when it can", () => {
  assert.deepEqual(planColumns([100, 100], 300), { scale: 1, groups: [[0, 1]] });
});

test("planColumns: shrinks to fit down to the smallest scale", () => {
  const p = planColumns([200, 200], 300, "fit", 0.55);
  assert.equal(p.groups.length, 1);
  assert.ok(Math.abs(p.scale - 0.75) < 1e-9);
});

test("planColumns: past the smallest scale the columns carry on over pages", () => {
  const p = planColumns([200, 200, 200, 200], 300, "fit", 0.55);
  assert.equal(p.scale, 0.55);
  assert.deepEqual(p.groups, [[0, 1], [2, 3]]);
});

test("planColumns: split keeps full size", () => {
  const p = planColumns([200, 200, 200], 300, "split");
  assert.equal(p.scale, 1);
  assert.deepEqual(p.groups, [[0], [1], [2]]);
});

test("planColumns: a column wider than the page still gets a group", () => {
  assert.deepEqual(planColumns([900, 50], 300, "split").groups, [[0], [1]]);
});

test("wrapText wraps on words and keeps blank lines", () => {
  assert.deepEqual(wrapText("one two three", 60, monospace), ["one two", "three"]);
  assert.deepEqual(wrapText("a\n\nb", 100, monospace), ["a", "", "b"]);
  assert.deepEqual(wrapText("", 100, monospace), [""]);
});

test("wrapText breaks a word that is too long", () => {
  assert.deepEqual(wrapText("abcdefghij", 25, monospace), ["abcde", "fghij"]);
  assert.deepEqual(wrapText("ab abcdefghij", 25, monospace), ["ab", "abcde", "fghij"]);
});

test("paginate cuts between rows and repeats the header", () => {
  const pages = paginate([10, 10, 10, 10, 10, 10], 35, 1);
  assert.deepEqual(pages.map((p) => p.rows), [[0, 1, 2], [3, 4], [5]]);
  assert.deepEqual(pages.map((p) => p.repeat), [false, true, true]);
  // the repeated header takes 10, so the second page holds header + 2 rows
  const more = paginate([10, 10, 10, 10, 10, 10, 10], 35, 1);
  assert.deepEqual(more.map((p) => p.rows), [[0, 1, 2], [3, 4], [5, 6]]);
});

test("paginate does not repeat a header that would crowd the page", () => {
  const pages = paginate([30, 10, 10, 10], 40, 1);
  assert.ok(pages.every((p) => !p.repeat));
});

test("paginate always moves on, even for a row taller than the page", () => {
  const pages = paginate([100, 5, 5], 50, 0);
  assert.deepEqual(pages.map((p) => p.rows), [[0], [1, 2]]);
});

test("paginate with nothing gives no pages", () => {
  assert.deepEqual(paginate([], 50, 1), []);
});

test("print areas are read, with quoted sheet names", () => {
  assert.deepEqual(parsePrintArea("Sheet1!$A$1:$F$40"), { sheet: "Sheet1", r1: 0, c1: 0, r2: 39, c2: 5, multiple: false });
  const q = parsePrintArea("'Q1 report''s'!$B$2:$D$9");
  assert.equal(q.sheet, "Q1 report's");
  assert.deepEqual([q.r1, q.c1, q.r2, q.c2], [1, 1, 8, 3]);
  assert.equal(parsePrintArea("Sheet1!A1:B2,Sheet1!D1:E2").multiple, true);
  assert.equal(parsePrintArea("Sheet1!$A:$C"), null);
  assert.equal(columnIndex("AA"), 26);
});

test("fill colours: white and nonsense are none", () => {
  assert.equal(fillColour("FFFFFF"), null);
  assert.equal(fillColour("nope"), null);
  assert.deepEqual(fillColour("FF0000"), { r: 1, g: 0, b: 0 });
  assert.deepEqual(fillColour("FF00FF00"), { r: 0, g: 1, b: 0 });
});

test("notes say what changed and what was lost", () => {
  const n = buildNotes({ shrunk: ["Sales"], split: ["Big", "Huge"], hiddenRows: 2, hiddenCols: 1, printArea: ["Sales"], empty: ["Blank"], noValue: 3, missing: "5 Arabic characters could not be drawn" });
  assert.equal(n.adjusted.length, 5);
  assert.match(n.adjusted[0], /^sheet Sales was reduced/);
  assert.match(n.adjusted[1], /^sheets Big, Huge are wider than a page/);
  assert.match(n.adjusted[2], /^2 hidden rows and 1 hidden column left out/);
  assert.equal(n.lost.length, 2);
  assert.match(n.lost[0], /^3 formulas have no saved result/);
  assert.deepEqual(buildNotes({}), { adjusted: [], lost: [] });
});
