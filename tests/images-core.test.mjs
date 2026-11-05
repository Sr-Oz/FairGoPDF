import test from "node:test";
import assert from "node:assert/strict";
import { planScale, usesTransparency, imageName, stitchName, planStitch, toGreyscale, toBlackWhite, describeSize, FORMATS } from "../assets/tools/images-core.js";

const A4 = { widthPt: 595, heightPt: 842 };

test("planScale: dpi scales from 72", () => {
  const p = planScale({ ...A4, mode: "dpi", dpi: 144 });
  assert.equal(p.scale, 2);
  assert.deepEqual([p.width, p.height, p.clamped], [1190, 1684, false]);
});

test("planScale: width and longest side modes hit the asked size", () => {
  assert.equal(planScale({ ...A4, mode: "width", px: 1000 }).width, 1000);
  const side = planScale({ ...A4, mode: "side", px: 2000 });
  assert.equal(side.height, 2000);
  assert.equal(side.width, Math.round(595 * (2000 / 842)));
});

test("planScale: a landscape page is limited on its longest side", () => {
  const p = planScale({ widthPt: 842, heightPt: 595, mode: "side", px: 1000 });
  assert.equal(p.width, 1000);
});

test("planScale: too large is scaled down and flagged", () => {
  const p = planScale({ ...A4, mode: "dpi", dpi: 2400 });
  assert.equal(p.clamped, true);
  assert.ok(p.width <= 16384 && p.height <= 16384);
  assert.ok(p.width * p.height <= 120e6 * 1.001);
  // the shape is kept
  assert.ok(Math.abs(p.width / p.height - 595 / 842) < 0.001);
});

test("planScale: a long thin page is clamped by its side, not its pixel count", () => {
  const p = planScale({ widthPt: 100, heightPt: 20000, mode: "dpi", dpi: 72 });
  assert.equal(p.height, 16384);
  assert.equal(p.clamped, true);
});

test("planScale: never a zero size", () => {
  assert.deepEqual([planScale({ widthPt: 1, heightPt: 1, mode: "width", px: 0.1 }).width], [1]);
});

test("usesTransparency: only PNG and WebP can be see-through", () => {
  assert.equal(usesTransparency("png", "transparent"), true);
  assert.equal(usesTransparency("webp", "transparent"), true);
  assert.equal(usesTransparency("jpg", "transparent"), false);
  assert.equal(usesTransparency("png", "white"), false);
  assert.equal(FORMATS.jpg.mime, "image/jpeg");
});

test("imageName pads to the page count", () => {
  assert.equal(imageName("doc", 2, 12, "png"), "doc-page-02.png");
  assert.equal(imageName("doc", 2, 120, "jpg"), "doc-page-002.jpg");
  assert.equal(imageName("doc", 2, 9, "png"), "doc-page-2.png");
  assert.equal(imageName("doc", 2, 12, "png", false), "doc-page-2.png");
});

test("stitchName", () => {
  assert.equal(stitchName("doc", 1, 12, "png"), "doc-pages-1-12.png");
  assert.equal(stitchName("doc", 4, 4, "webp"), "doc-page-4.webp");
});

test("planStitch: stacks pages centred with a gap", () => {
  const { width, groups } = planStitch([{ width: 100, height: 200 }, { width: 80, height: 150 }], 10);
  assert.equal(width, 100);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].height, 360);
  assert.deepEqual(groups[0].items.map((i) => [i.x, i.y]), [[0, 0], [10, 210]]);
});

test("planStitch: splits when the stack would be too tall, one page at least per image", () => {
  const sizes = Array.from({ length: 5 }, () => ({ width: 100, height: 400 }));
  const { groups } = planStitch(sizes, 0, 1000);
  assert.deepEqual(groups.map((g) => g.items.length), [2, 2, 1]);
  assert.deepEqual(groups.map((g) => g.height), [800, 800, 400]);
  const huge = planStitch([{ width: 10, height: 5000 }, { width: 10, height: 5000 }], 0, 1000);
  assert.deepEqual(huge.groups.map((g) => g.items.length), [1, 1]);
});

test("planStitch: the pixel budget also limits the height", () => {
  const { groups } = planStitch(Array.from({ length: 4 }, () => ({ width: 1000, height: 1000 })), 0, 16384, 2.5e6);
  assert.deepEqual(groups.map((g) => g.items.length), [2, 2]);
});

test("toGreyscale keeps alpha and equalises the channels", () => {
  const d = new Uint8ClampedArray([255, 0, 0, 77, 0, 255, 0, 255]);
  toGreyscale(d);
  assert.deepEqual([...d], [76, 76, 76, 77, 150, 150, 150, 255]);
});

test("toBlackWhite uses the threshold", () => {
  const d = new Uint8ClampedArray([200, 200, 200, 255, 60, 60, 60, 255]);
  toBlackWhite(d, 128);
  assert.deepEqual([...d], [255, 255, 255, 255, 0, 0, 0, 255]);
  const e = new Uint8ClampedArray([100, 100, 100, 255]);
  toBlackWhite(e, 90);
  assert.equal(e[0], 255);
});

test("describeSize", () => {
  assert.equal(describeSize([]), "");
  assert.equal(describeSize([{ width: 10, height: 20 }, { width: 10, height: 20 }]), "10 × 20 px");
  assert.match(describeSize([{ width: 10, height: 20 }, { width: 5, height: 20 }]), /differ/);
});
