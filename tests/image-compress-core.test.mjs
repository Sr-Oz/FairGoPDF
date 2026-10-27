import test from "node:test";
import assert from "node:assert/strict";
import { planSize, validateResize, isResized, outputType, targetBytes, uniqueName } from "../assets/tools/image-compress-core.js";

test("no resize keeps the size", () => {
  const p = planSize(4000, 3000, { mode: "none" });
  assert.deepEqual([p.dw, p.dh, p.sw, p.sh], [4000, 3000, 4000, 3000]);
  assert.equal(isResized(p, 4000, 3000), false);
});

test("fit keeps proportions and respects the tighter limit", () => {
  const p = planSize(4000, 3000, { mode: "fit", maxW: 1600, maxH: 1600 });
  assert.deepEqual([p.dw, p.dh], [1600, 1200]);
  const q = planSize(4000, 3000, { mode: "fit", maxH: 600 });
  assert.deepEqual([q.dw, q.dh], [800, 600]);
});

test("fit never enlarges a small image", () => {
  const p = planSize(300, 200, { mode: "fit", maxW: 1600, maxH: 1600 });
  assert.deepEqual([p.dw, p.dh], [300, 200]);
  assert.equal(isResized(p, 300, 200), false);
});

test("percent scales both sides and stops at 100", () => {
  assert.deepEqual(Object.values(planSize(1000, 500, { mode: "percent", percent: 50 })).slice(0, 2), [500, 250]);
  assert.deepEqual(Object.values(planSize(1000, 500, { mode: "percent", percent: 250 })).slice(0, 2), [1000, 500]);
});

test("a very thin result is never zero pixels", () => {
  const p = planSize(4000, 10, { mode: "fit", maxW: 100 });
  assert.equal(p.dh, 1);
});

test("crop fills the box exactly and trims evenly from both sides", () => {
  const p = planSize(4000, 3000, { mode: "crop", width: 1000, height: 1000 });
  assert.deepEqual([p.dw, p.dh], [1000, 1000]);
  assert.equal(p.sh, 3000); // the short side is used whole
  assert.equal(p.sw, 3000); // the long side is cut to a square
  assert.equal(p.sx, 500); // 500 off each side
  assert.equal(p.sy, 0);
});

test("crop to a wider box trims the top and bottom instead", () => {
  const p = planSize(1000, 1000, { mode: "crop", width: 200, height: 100 });
  assert.equal(p.sw, 1000);
  assert.equal(p.sh, 500);
  assert.equal(p.sy, 250);
});

test("validateResize catches the settings that cannot be used", () => {
  assert.match(validateResize({ mode: "fit" }), /maximum/);
  assert.equal(validateResize({ mode: "fit", maxW: 800 }), "");
  assert.match(validateResize({ mode: "percent", percent: 0 }), /percentage/);
  assert.match(validateResize({ mode: "percent", percent: 101 }), /percentage/);
  assert.match(validateResize({ mode: "crop", width: 100 }), /both/);
  assert.match(validateResize({ mode: "crop", width: 100000, height: 10 }), /under/);
  assert.equal(validateResize({ mode: "none" }), "");
});

test("output type: keep, choose, and the big-PNG conversion", () => {
  const keep = { format: "keep", method: "quality", convertBig: false, convertMB: 5 };
  assert.equal(outputType("image/png", 9e6, keep), "image/png");
  assert.equal(outputType("image/png", 9e6, { ...keep, convertBig: true }), "image/jpeg");
  assert.equal(outputType("image/png", 1e6, { ...keep, convertBig: true }), "image/png"); // under the limit
  assert.equal(outputType("image/jpeg", 9e6, { ...keep, convertBig: true }), "image/jpeg"); // only PNG is converted
  assert.equal(outputType("image/jpeg", 1, { ...keep, format: "image/webp" }), "image/webp");
});

test("output type: a size target cannot stay PNG, and WebP falls back where it cannot be saved", () => {
  const target = { format: "keep", method: "target", convertBig: false, convertMB: 5 };
  assert.equal(outputType("image/png", 1e6, target), "image/webp");
  assert.equal(outputType("image/png", 1e6, target, false), "image/jpeg");
  assert.equal(outputType("image/webp", 1e6, { ...target, method: "quality" }, false), "image/jpeg");
});

test("target size in bytes", () => {
  assert.equal(targetBytes(500, 1024), 512000);
  assert.equal(targetBytes(1.5, 1048576), 1572864);
});

test("uniqueName adds a number only when needed", () => {
  const taken = new Set();
  assert.equal(uniqueName("a.jpg", taken), "a.jpg");
  assert.equal(uniqueName("a.jpg", taken), "a-2.jpg");
  assert.equal(uniqueName("a.jpg", taken), "a-3.jpg");
  assert.equal(uniqueName("b.jpg", taken), "b.jpg");
});
