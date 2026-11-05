import test from "node:test";
import assert from "node:assert/strict";
import { pagePlacement, shrinkPlan, turned, rotatedSize, suggestName, describePlan } from "../assets/tools/images-pdf-core.js";

const close = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

test("fit to the picture: the page is the picture at 96 pixels to the inch", () => {
  const p = pagePlacement({ w: 800, h: 400, size: "image" });
  assert.deepEqual([p.pw, p.ph, p.x, p.y, p.clip], [600, 300, 0, 0, null]);
});

test("fit to the picture with a margin grows the page, not the picture", () => {
  const p = pagePlacement({ w: 800, h: 400, size: "image", marginMm: 10 });
  const m = (10 * 72) / 25.4;
  assert.ok(close(p.pw, 600 + 2 * m) && close(p.ph, 300 + 2 * m));
  assert.ok(close(p.x, m) && close(p.width, 600));
});

test("A4 turns sideways for a wide picture and stays upright for a tall one", () => {
  const wide = pagePlacement({ w: 1600, h: 900, size: "a4" });
  assert.ok(wide.pw > wide.ph);
  const tall = pagePlacement({ w: 900, h: 1600, size: "a4" });
  assert.ok(tall.pw < tall.ph);
  assert.ok(close(tall.pw, (210 * 72) / 25.4));
});

test("a forced orientation wins over the picture's shape", () => {
  assert.ok(pagePlacement({ w: 1600, h: 900, size: "a4", orientation: "portrait" }).pw < 600);
  assert.ok(pagePlacement({ w: 900, h: 1600, size: "letter", orientation: "landscape" }).pw > 700);
});

test("inside keeps the whole picture, centred, with the margin clear", () => {
  const p = pagePlacement({ w: 1000, h: 1000, size: "a4", marginMm: 20 });
  const m = (20 * 72) / 25.4;
  assert.equal(p.clip, null);
  assert.ok(close(p.width, p.pw - 2 * m)); // a square on a tall page is limited by the width
  assert.ok(close(p.x, m) && close(p.y, (p.ph - p.height) / 2));
});

test("fill covers the page area and crops the overhang", () => {
  const p = pagePlacement({ w: 1000, h: 1000, size: "a4", marginMm: 10 });
  const f = pagePlacement({ w: 1000, h: 1000, size: "a4", marginMm: 10, fit: "fill" });
  assert.ok(f.width > p.width);
  assert.ok(close(f.clip.width, p.width) && f.clip.height > f.clip.width);
  assert.ok(f.width >= f.clip.width - 0.01 && f.height >= f.clip.height - 0.01);
  assert.ok(close(f.x + f.width / 2, f.pw / 2));
});

test("a margin cannot use up the page", () => {
  const p = pagePlacement({ w: 100, h: 100, size: "a5", marginMm: 500 });
  assert.ok(p.width > 0 && p.height > 0);
});

test("an unknown size falls back to the picture's size", () => {
  assert.equal(pagePlacement({ w: 400, h: 400, size: "nope" }).pw, 300);
});

test("shrinkPlan only touches a picture that is too big", () => {
  assert.deepEqual(shrinkPlan(4000, 3000, "original"), { width: 4000, height: 3000, shrink: false, quality: 0.92 });
  const b = shrinkPlan(4000, 3000, "balanced");
  assert.deepEqual([b.width, b.height, b.shrink, b.quality], [2480, 1860, true, 0.85]);
  const small = shrinkPlan(1200, 800, "small");
  assert.deepEqual([small.width, small.height, small.shrink], [1200, 800, false]);
  assert.equal(shrinkPlan(3000, 4000, "small").height, 1654);
});

test("turning keeps to 0, 90, 180, 270", () => {
  assert.equal(turned(0, 1), 90);
  assert.equal(turned(270, 1), 0);
  assert.equal(turned(0, -1), 270);
  assert.equal(turned(90, -1), 0);
});

test("a picture turned a quarter swaps its sides", () => {
  assert.deepEqual(rotatedSize(400, 300, 90), { w: 300, h: 400 });
  assert.deepEqual(rotatedSize(400, 300, 180), { w: 400, h: 300 });
});

test("the file is named after a single picture, or images", () => {
  assert.equal(suggestName(["Holiday 1.JPG"]), "Holiday 1");
  assert.equal(suggestName(["a.png", "b.png"]), "images");
  assert.equal(suggestName([]), "images");
});

test("describePlan reads in plain words", () => {
  assert.equal(describePlan({ count: 1, size: "a4", orientation: "auto", marginMm: 0, fit: "inside" }), "1 page, A4 turned sideways for wide pictures.");
  assert.equal(describePlan({ count: 3, size: "image", marginMm: 5 }), "3 pages, each the size of its picture, 5 mm margin.");
  assert.match(describePlan({ count: 2, size: "letter", orientation: "portrait", marginMm: 10, fit: "fill" }), /US Letter portrait, 10 mm margin, pictures fill the page and are cropped\.$/);
});
