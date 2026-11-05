import test from "node:test";
import assert from "node:assert/strict";
import { normaliseRules, findTables } from "../assets/tools/pdf-tables.js";

const page = { width: 595, height: 842 };
const item = (str, x, y, size = 11, w = str.length * size * 0.5) => ({ str, x, y, w, size });
const hline = (y, x1, x2) => ({ x1, y1: y, x2, y2: y });
const vline = (x, y1, y2) => ({ x1: x, y1, x2: x, y2 });

// a 3 x 3 grid at x 72..372, y 100..172, rows 24 high
const gridRules = () => {
  const r = [];
  for (const y of [100, 124, 148, 172]) r.push(hline(y, 72, 372));
  for (const x of [72, 172, 272, 372]) r.push(vline(x, 100, 172));
  return r;
};
const cell = (str, c, r) => item(str, 72 + c * 100 + 6, 100 + r * 24 + 16);

test("pieces on one line are joined, and short or slanted ones are ignored", () => {
  const { h, v } = normaliseRules([hline(10, 0, 50), hline(10.5, 50, 120), vline(30, 0, 40), { x1: 0, y1: 0, x2: 30, y2: 30 }, hline(20, 0, 3)]);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].a, h[0].b], [0, 120]);
  assert.equal(v.length, 1);
});

test("a grid of rules gives a table with the text in its cells", () => {
  const items = [cell("A", 0, 0), cell("B", 1, 0), cell("C", 2, 0), cell("1", 0, 1), cell("2", 1, 1), cell("3", 2, 1), cell("x", 0, 2), cell("y", 1, 2), cell("z", 2, 2), item("Outside", 72, 300)];
  const { tables, rest } = findTables(items, gridRules(), page);
  assert.equal(tables.length, 1);
  const t = tables[0];
  assert.equal(t.ruled, true);
  assert.equal(t.ncols, 3);
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[1].map((c) => c.items.map((i) => i.str).join("")), ["1", "2", "3"]);
  assert.deepEqual(rest.map((i) => i.str), ["Outside"]);
});

test("a box with no inner lines is not a table, nor is a border round the page", () => {
  const box = [hline(100, 72, 372), hline(172, 72, 372), vline(72, 100, 172), vline(372, 100, 172)];
  assert.equal(findTables([cell("a", 0, 0)], box, page).tables.length, 0);
  const frame = [hline(10, 10, 585), hline(832, 10, 585), vline(10, 10, 832), vline(585, 10, 832), hline(400, 10, 585), vline(300, 10, 832)];
  assert.equal(findTables([item("a", 50, 100), item("b", 400, 100), item("c", 50, 500)], frame, page).tables.length, 0);
});

test("a table with only a few filled cells is left alone", () => {
  const { tables } = findTables([cell("A", 0, 0), cell("B", 1, 0)], gridRules(), page);
  assert.equal(tables.length, 0);
});

// text that lines up with no lines: a name column and two right-aligned number columns
const aligned = () => {
  const rows = [["Region", "Sales", "Growth"], ["North", "1,200", "4.5%"], ["South", "980", "-1.2%"], ["East", "15,410", "12.0%"]];
  const out = [];
  rows.forEach((r, i) => {
    const y = 300 + i * 18;
    out.push(item(r[0], 72, y));
    out.push(item(r[1], 340 - r[1].length * 5.5, y, 11, r[1].length * 5.5));
    out.push(item(r[2], 470 - r[2].length * 5.5, y, 11, r[2].length * 5.5));
  });
  return out;
};

test("text that lines up in columns becomes a table", () => {
  const items = aligned();
  const { tables, rest } = findTables(items, [], page);
  assert.equal(tables.length, 1);
  const t = tables[0];
  assert.equal(t.ruled, false);
  assert.equal(t.ncols, 3);
  assert.equal(t.rows.length, 4);
  assert.deepEqual(t.rows[2].map((c) => c.items.map((i) => i.str).join("")), ["South", "980", "-1.2%"]);
  assert.equal(rest.length, 0);
  assert.ok(t.edges[0] <= 72 && t.edges[3] >= 465);
});

test("ordinary paragraphs around a table stay out of it", () => {
  const items = [item("A paragraph of plain running text on one line", 72, 250, 11, 260), ...aligned(), item("Closing words under the table", 72, 420, 11, 150)];
  const { tables, rest } = findTables(items, [], page);
  assert.equal(tables.length, 1);
  assert.equal(rest.length, 2);
});

test("a header that spans two columns becomes a spanning cell", () => {
  const items = [...aligned(), item("Sales and growth", 300, 282, 11, 160)];
  const t = findTables(items, [], page).tables[0];
  assert.equal(t.rows.length, 5);
  assert.deepEqual([t.rows[0][0].col, t.rows[0][0].span], [1, 2]);
});

test("columns of running text are not a table", () => {
  const long = (s) => item(s.repeat(6), 0, 0, 11, 230);
  const items = [];
  for (let i = 0; i < 8; i++) {
    const y = 100 + i * 14;
    items.push({ ...long("A line of body text. "), x: 72, y });
    items.push({ ...long("More text over here. "), x: 330, y });
  }
  assert.equal(findTables(items, [], page).tables.length, 0);
});

test("a contents list with dot leaders is not a table", () => {
  const items = [];
  ["Introduction", "Methods", "Results", "Discussion"].forEach((t, i) => {
    const y = 100 + i * 16;
    items.push(item(t + " ........................", 72, y, 11, 280));
    items.push(item(String(i + 3), 480, y, 11, 10));
  });
  assert.equal(findTables(items, [], page).tables.length, 0);
});

test("two rows are not enough for a table with no lines", () => {
  const items = aligned().slice(0, 6);
  assert.equal(findTables(items, [], page).tables.length, 0);
});

test("the options can switch either kind off", () => {
  assert.equal(findTables(aligned(), [], page, { aligned: false }).tables.length, 0);
  const items = [cell("A", 0, 0), cell("B", 1, 0), cell("C", 2, 0), cell("1", 0, 1), cell("2", 1, 1)];
  assert.equal(findTables(items, gridRules(), page, { ruled: false }).tables.length, 0);
});

test("blank pieces that space the columns out do not join the cells", () => {
  const items = aligned();
  const spaced = [...items];
  // a blank piece stretched across each gap, as some PDFs write them
  for (let i = 0; i < 4; i++) spaced.push({ str: " ", x: 110, y: 300 + i * 18, w: 190, size: 11 });
  const { tables, rest } = findTables(spaced, [], page);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].ncols, 3);
  assert.equal(rest.length, 0);
});

test("each column of a table with no lines knows how it is lined up", () => {
  const t = findTables(aligned(), [], page).tables[0];
  assert.deepEqual(t.colAlign, ["left", "right", "right"]);
});
