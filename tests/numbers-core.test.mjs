import test from "node:test";
import assert from "node:assert/strict";
import { loadAsset } from "./load.mjs";

const core = await loadAsset("assets/tools/numbers-core.js");
const { formatNumber, labelFor, placeLabel, PRESETS, STYLES } = core;

test("numbers are written in the style chosen", () => {
  assert.equal(formatNumber(7), "7");
  assert.equal(formatNumber(7, "arabic", 4), "0007");
  assert.equal(formatNumber(4, "lower"), "iv");
  assert.equal(formatNumber(1994, "lower"), "mcmxciv");
  assert.equal(formatNumber(14, "upper"), "XIV");
  assert.equal(formatNumber(1, "letters"), "a");
  assert.equal(formatNumber(26, "letters"), "z");
  assert.equal(formatNumber(27, "letters"), "aa");
  assert.equal(formatNumber(52, "letters"), "az");
  assert.equal(formatNumber(53, "letters"), "ba");
  assert.equal(formatNumber(3, "capitals"), "C");
  assert.deepEqual(Object.keys(STYLES), ["arabic", "lower", "upper", "letters", "capitals"]);
});

test("a number a style can't write falls back to the ordinary way", () => {
  assert.equal(formatNumber(0, "lower"), "0");
  assert.equal(formatNumber(-3, "lower"), "-3");
  assert.equal(formatNumber(4000, "upper"), "4000");
  assert.equal(formatNumber(0, "letters"), "0");
  assert.equal(formatNumber(-2, "arabic", 3), "-002");
  assert.equal(formatNumber(2.9), "2");
});

test("a label carries the page's own number and the last page's", () => {
  assert.equal(labelFor({ template: "Page {n} of {total}", pageIndex: 2, total: 10 }), "Page 3 of 10");
  assert.equal(labelFor({ template: "{n}", pageIndex: 0, total: 3, start: 5 }), "5");
  assert.equal(labelFor({ template: "{n} / {total}", pageIndex: 1, total: 3, start: 5 }), "6 / 7");
  assert.equal(labelFor({ template: "DOC-{n}", pageIndex: 41, total: 100, digits: 6 }), "DOC-000042");
  assert.equal(labelFor({ template: "{N} of {TOTAL}", pageIndex: 0, total: 4, style: "lower" }), "i of iv");
  assert.equal(labelFor({ template: "", pageIndex: 0, total: 4 }), "1");
  assert.equal(labelFor({ template: "no tokens", pageIndex: 0, total: 4 }), "no tokens");
  // a start of 0 makes the second page "1", for a book whose cover is not counted
  assert.equal(labelFor({ template: "{n}", pageIndex: 1, total: 4, start: 0 }), "1");
});

test("the ready-made formats all make sense on a page", () => {
  for (const p of PRESETS) {
    const text = labelFor({ template: p.template, pageIndex: 0, total: 10, digits: p.digits || 1 });
    assert.ok(text.length > 0);
    assert.ok(!text.includes("{"), p.label);
  }
  assert.equal(PRESETS.find((p) => p.label === "Bates").digits, 6);
});

const page = { w: 600, h: 800 };
const box = { w: 100, h: 7.2 };

test("a label goes at the edge it is asked for, in from it by the margin", () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let p = placeLabel({ page, box, position: "bc", margin: 30 });
  assert.ok(near(p.x, 250) && near(p.y, 30));
  p = placeLabel({ page, box, position: "br", margin: 30 });
  assert.ok(near(p.x, 470) && near(p.y, 30));
  p = placeLabel({ page, box, position: "bl", margin: 30 });
  assert.ok(near(p.x, 30));
  p = placeLabel({ page, box, position: "tl", margin: 30 });
  assert.ok(near(p.x, 30) && near(p.y, 800 - 30 - box.h));
  p = placeLabel({ page, box, position: "tc", margin: 30 });
  assert.ok(near(p.x, 250) && near(p.y, 800 - 30 - box.h));
  p = placeLabel({ page, box, position: "mr", margin: 30 });
  assert.ok(near(p.x, 470) && near(p.y, (800 - box.h) / 2));
});

test("on facing pages the label can swap sides, as in a book", () => {
  const odd = placeLabel({ page, box, position: "br", margin: 30, mirror: true, pageIndex: 0 });
  const even = placeLabel({ page, box, position: "br", margin: 30, mirror: true, pageIndex: 1 });
  assert.equal(odd.x, 470);
  assert.equal(even.x, 30);
  // a centred label does not move, and without mirroring nothing moves
  assert.equal(placeLabel({ page, box, position: "bc", mirror: true, pageIndex: 1 }).x, 250);
  assert.equal(placeLabel({ page, box, position: "br", margin: 30, pageIndex: 1 }).x, 470);
});

test("a label too wide for the page stays on it", () => {
  const p = placeLabel({ page: { w: 80, h: 100 }, box: { w: 200, h: 8 }, position: "br", margin: 30 });
  assert.equal(p.x, 0);
});
