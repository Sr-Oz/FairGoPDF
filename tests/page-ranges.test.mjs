import test from "node:test";
import assert from "node:assert/strict";
import { loadPdfCommon } from "./load.mjs";

const { parsePageRanges } = await loadPdfCommon();

test("ranges, single pages, spaces and duplicates", () => {
  assert.deepEqual(parsePageRanges("1-3, 5 , 3", 10), [1, 2, 3, 5]);
});

test("a backwards range is turned round", () => {
  assert.deepEqual(parsePageRanges("4-2", 10), [2, 3, 4]);
});

test("pages outside the document are dropped", () => {
  assert.deepEqual(parsePageRanges("0-2, 9-20, 99", 10), [1, 2, 9, 10]);
});

test("junk is ignored", () => {
  assert.deepEqual(parsePageRanges("abc, 2-x, -, ,", 10), []);
});

test("a huge range returns at once", () => {
  const t = performance.now();
  assert.equal(parsePageRanges("1-99999999999", 5).length, 5);
  assert.ok(performance.now() - t < 100);
});
