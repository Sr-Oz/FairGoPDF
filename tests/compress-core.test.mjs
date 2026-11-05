import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, SIZE_LEVELS, effectiveDpi, planImage, worthKeeping, targetBytes, describeSaving, breakdownLines, expectation } from "../assets/tools/compress-core.js";

const photo = { w: 3000, h: 2000, dispW: 432, dispH: 288, kind: 2, colourSpace: "/DeviceRGB", masked: false, stencil: false };

test("a picture's detail is counted in pixels for each inch it is drawn at", () => {
  assert.equal(Math.round(effectiveDpi(3000, 2000, 432, 288)), 500);
  assert.equal(effectiveDpi(100, 100, 0, 0), Infinity);
});

test("a picture with more detail than needed is shrunk to the target", () => {
  const p = planImage(photo, { dpi: 150, quality: 0.75 });
  assert.equal(p.action, "recompress");
  assert.equal(p.scaled, true);
  assert.equal(p.width, 900);
  assert.equal(p.height, 600);
});

test("a picture already at or under the target keeps its size and is only saved again", () => {
  const p = planImage({ ...photo, dispW: 1440, dispH: 960 }, { dpi: 150, quality: 0.75 });
  assert.deepEqual([p.action, p.scaled, p.width, p.height], ["recompress", false, 3000, 2000]);
});

test("masks, transparency, black-and-white, print colours, palettes and tiny pictures are left alone", () => {
  const opts = { dpi: 150, quality: 0.75 };
  assert.equal(planImage({ ...photo, stencil: true }, opts).reason, "a mask");
  assert.equal(planImage({ ...photo, masked: true }, opts).reason, "has transparency");
  assert.equal(planImage({ ...photo, kind: 3 }, opts).reason, "has transparency");
  assert.equal(planImage({ ...photo, kind: 1 }, opts).reason, "black and white");
  assert.equal(planImage({ ...photo, colourSpace: "/DeviceCMYK" }, opts).reason, "print colours");
  assert.equal(planImage({ ...photo, colourSpace: "/Separation" }, opts).reason, "print colours");
  assert.equal(planImage({ ...photo, colourSpace: "[/Indexed /DeviceRGB 255 12 0 R]" }, opts).reason, "a flat-colour picture");
  assert.equal(planImage({ ...photo, w: 100, h: 100 }, opts).reason, "small");
});

test("a new version is kept only when it is clearly smaller", () => {
  assert.equal(worthKeeping(1000, 900), true);
  assert.equal(worthKeeping(1000, 960), false);
  assert.equal(worthKeeping(1000, 1200), false);
});

test("the presets and the levels for a size go from sharper to smaller", () => {
  assert.ok(PRESETS.balanced.dpi > PRESETS.smaller.dpi && PRESETS.smaller.dpi > PRESETS.smallest.dpi);
  for (let i = 1; i < SIZE_LEVELS.length; i++) assert.ok(SIZE_LEVELS[i].dpi < SIZE_LEVELS[i - 1].dpi && SIZE_LEVELS[i].quality < SIZE_LEVELS[i - 1].quality);
});

test("a size is turned into bytes", () => {
  assert.equal(targetBytes(2, "MB"), 2097152);
  assert.equal(targetBytes("500", "KB"), 512000);
  assert.equal(targetBytes(1.5, "MB"), 1572864);
});

test("the saving is said in words", () => {
  assert.equal(describeSaving(1000, 400), "60% smaller");
  assert.equal(describeSaving(1000, 1000), "about the same size");
  assert.equal(describeSaving(1000, 1300), "30% larger");
  assert.equal(describeSaving(0, 5), "");
});

test("the breakdown lists the biggest first and skips what is empty", () => {
  const parts = { Pictures: { bytes: 9800, count: 14, noun: "picture" }, Fonts: { bytes: 600, count: 3, noun: "font" }, Other: { bytes: 0, count: 0, noun: "" }, Structure: { bytes: 2000, count: 0, noun: "" } };
  assert.deepEqual(breakdownLines(parts, (n) => `${n} B`), ["Pictures, 9800 B in 14 pictures", "Structure, 2000 B", "Fonts, 600 B in 3 fonts"]);
  assert.deepEqual(breakdownLines({ Pictures: { bytes: 5, count: 1, noun: "picture" } }, String), ["Pictures, 5 in 1 picture"]);
});

test("what to expect depends on how much of the file is pictures", () => {
  assert.match(expectation({ Pictures: { bytes: 80 } }, 100), /save a lot/);
  assert.match(expectation({ Pictures: { bytes: 30 } }, 100), /useful saving/);
  assert.match(expectation({ Pictures: { bytes: 5 } }, 100), /save only a little/);
  assert.match(expectation({}, 0), /save only a little/);
});
