import test from "node:test";
import assert from "node:assert/strict";
import { planSplit, partitionBySize, fileNameFor, pageLabel } from "../assets/tools/split-core.js";

const pagesOf = (plan) => plan.parts.map((p) => p.pages);

test("labels say what is in a file", () => {
  assert.equal(pageLabel([5]), "page-5");
  assert.equal(pageLabel([1, 2, 3]), "pages-1-3");
  assert.equal(pageLabel([1, 2, 3, 7]), "pages-1-3_7");
});

test("selected pages: one file, or one each", () => {
  const one = planSplit({ mode: "selected-one", count: 10, selected: [7, 2, 3, 2] });
  assert.deepEqual(pagesOf(one), [[2, 3, 7]]);
  const each = planSplit({ mode: "selected-each", count: 10, selected: [7, 2] });
  assert.deepEqual(pagesOf(each), [[2], [7]]);
  assert.equal(each.parts[1].label, "page-7");
  assert.match(planSplit({ mode: "selected-one", count: 10, selected: [] }).error, /at least one/);
});

test("custom ranges: one file per line or semicolon, each can have several ranges", () => {
  const p = planSplit({ mode: "ranges", count: 12, ranges: "1-3\n4-6, 9 ; 10-" });
  assert.deepEqual(pagesOf(p), [[1, 2, 3], [4, 5, 6, 9], [10, 11, 12]]);
  assert.equal(p.parts[1].label, "pages-4-6_9");
});

test("custom ranges name the file with the mistake", () => {
  assert.match(planSplit({ mode: "ranges", count: 5, ranges: "1-2\n3-9" }).error, /^File 2: /);
  assert.match(planSplit({ mode: "ranges", count: 5, ranges: "  \n " }).error, /one file per line/);
});

test("every N pages leaves a shorter last file", () => {
  const p = planSplit({ mode: "every", count: 10, every: 4 });
  assert.deepEqual(pagesOf(p), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
});

test("every N pages refuses a pointless split", () => {
  assert.match(planSplit({ mode: "every", count: 10, every: 10 }).error, /whole PDF/);
  assert.match(planSplit({ mode: "every", count: 10, every: 0 }).error, /how many pages/);
});

test("equal parts share the extra pages out from the front", () => {
  const p = planSplit({ mode: "equal", count: 10, parts: 3 });
  assert.deepEqual(p.parts.map((x) => x.pages.length), [4, 3, 3]);
  assert.deepEqual(p.parts.flatMap((x) => x.pages), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(planSplit({ mode: "equal", count: 2, parts: 3 }).error, /cannot make 3/);
  assert.match(planSplit({ mode: "equal", count: 5, parts: 1 }).error, /two or more/);
});

test("bookmarks start a file each, with the pages before the first one kept as front pages", () => {
  const marks = [{ title: "Chapter 2", page: 6 }, { title: "Chapter 1", page: 3 }, { title: "Also page 3", page: 3 }];
  const p = planSplit({ mode: "bookmarks", count: 9, bookmarks: marks });
  assert.deepEqual(pagesOf(p), [[1, 2], [3, 4, 5], [6, 7, 8, 9]]);
  assert.deepEqual(p.parts.map((x) => x.label), ["Front pages", "Chapter 1", "Chapter 2"]);
});

test("bookmarks: none, or only one file's worth, is explained", () => {
  assert.match(planSplit({ mode: "bookmarks", count: 9, bookmarks: [] }).error, /no bookmarks/);
  assert.match(planSplit({ mode: "bookmarks", count: 9, bookmarks: [{ title: "Only", page: 1 }] }).error, /only make one file/);
  assert.match(planSplit({ mode: "bookmarks", count: 9, bookmarks: [{ title: "Off the end", page: 40 }] }).error, /no bookmarks/);
});

test("a bookmark title with awkward characters makes a safe file label", () => {
  const p = planSplit({ mode: "bookmarks", count: 4, bookmarks: [{ title: "Part: 1/2?", page: 1 }, { title: "B", page: 3 }] });
  assert.equal(p.parts[0].label, "Part 12");
});

test("size mode waits for real sizes", () => {
  assert.equal(planSplit({ mode: "size", count: 5 }).bySize, true);
  assert.match(planSplit({ mode: "size", count: 0 }).error, /Choose a PDF/);
});

// a pretend PDF: each page adds 100 bytes on top of a 50 byte header, except page 7, which is a huge scan
const sizeOfPages = (from, to) => 50 + range(from, to).reduce((n, p) => n + (p === 7 ? 5000 : 100), 0);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test("partitionBySize fills each file as far as the limit allows", async () => {
  let calls = 0;
  const parts = await partitionBySize(30, 1050, async (a, b) => { calls++; return 50 + (b - a + 1) * 100; });
  assert.deepEqual(parts.map((p) => p.pages.length), [10, 10, 10]); // 50 + 10 x 100 = 1050 fits exactly
  assert.ok(calls < 60, `took ${calls} tries`); // doubling and narrowing, not one try per page
});

test("partitionBySize gives an over-size page a file of its own", async () => {
  const parts = await partitionBySize(10, 1000, async (a, b) => sizeOfPages(a, b));
  assert.deepEqual(parts.map((p) => p.pages), [[1, 2, 3, 4, 5, 6], [7], [8, 9, 10]]);
  assert.deepEqual(parts.map((p) => !!p.oversize), [false, true, false]);
});

test("partitionBySize covers every page once and handles one page", async () => {
  const parts = await partitionBySize(1, 10, async () => 999);
  assert.deepEqual(parts.map((p) => p.pages), [[1]]);
  const many = await partitionBySize(37, 700, async (a, b) => 50 + (b - a + 1) * 100);
  assert.deepEqual(many.flatMap((p) => p.pages), range(1, 37));
});

test("file names", () => {
  assert.equal(fileNameFor("report", 0, 1, ""), "report.pdf");
  assert.equal(fileNameFor("report", 0, 1, "pages-1-3"), "report-pages-1-3.pdf");
  assert.equal(fileNameFor("report", 2, 12, "pages-7-9"), "report-03-pages-7-9.pdf");
  assert.equal(fileNameFor("report", 0, 3, ""), "report-1.pdf");
});
