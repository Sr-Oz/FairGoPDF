import test from "node:test";
import assert from "node:assert/strict";
import { parsePageSpec, compactPages, safeBaseName } from "../assets/tools/page-tools.js";

test("an empty box means every page", () => {
  assert.deepEqual(parsePageSpec("", 4).pages, [1, 2, 3, 4]);
  assert.equal(parsePageSpec("", 0).pending, true);
});

test("pages and ranges come out in the order typed, without repeats", () => {
  assert.deepEqual(parsePageSpec("1-3, 7", 10).pages, [1, 2, 3, 7]);
  assert.deepEqual(parsePageSpec("7, 1-2", 10).pages, [7, 1, 2]);
  assert.deepEqual(parsePageSpec("2, 2, 1-3", 10).pages, [2, 1, 3]);
});

test("open ranges and last", () => {
  assert.deepEqual(parsePageSpec("8-", 10).pages, [8, 9, 10]);
  assert.deepEqual(parsePageSpec("last", 5).pages, [5]);
  assert.deepEqual(parsePageSpec("3-last", 5).pages, [3, 4, 5]);
});

test("except takes everything but the listed pages", () => {
  assert.deepEqual(parsePageSpec("except 2, 4", 5).pages, [1, 3, 5]);
  assert.deepEqual(parsePageSpec("!1", 3).pages, [2, 3]);
  assert.deepEqual(parsePageSpec("not 2-3", 4).pages, [1, 4]);
  assert.match(parsePageSpec("except 1-3", 3).error, /no pages/i);
  assert.match(parsePageSpec("except", 3).error, /leave out/i);
});

test("mistakes are named, not guessed at", () => {
  assert.match(parsePageSpec("1-3, x", 10).error, /"x"/);
  assert.match(parsePageSpec("11", 10).error, /10 pages.*11/);
  assert.match(parsePageSpec("1-99", 10).error, /99/);
  assert.match(parsePageSpec("5-3", 10).error, /backwards/);
  assert.match(parsePageSpec("0", 10).error, /start at 1/);
  assert.match(parsePageSpec("2", 1).error, /1 page,/);
});

test("with the page count not yet known the box waits instead of failing", () => {
  assert.equal(parsePageSpec("1-3", 0).pending, true);
});

test("file names made safe", () => {
  assert.equal(safeBaseName("  My: report?.pdf "), "My report");
  assert.equal(safeBaseName("../../evil"), "evil");
  assert.equal(safeBaseName("???", "merged"), "merged");
  assert.equal(safeBaseName(""), "merged");
});

test("compactPages joins neighbouring pages into ranges", () => {
  assert.equal(compactPages([1, 2, 3, 7]), "1-3, 7");
  assert.equal(compactPages([7, 3, 2, 1, 2]), "1-3, 7");
  assert.equal(compactPages([5]), "5");
  assert.equal(compactPages([]), "");
  assert.equal(compactPages([1, 3, 5]), "1, 3, 5");
});
