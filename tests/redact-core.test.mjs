import test from "node:test";
import assert from "node:assert/strict";
import { boxFromDrag, boxToPixels, outputScale, MIN_DRAG_PX } from "../assets/tools/redact-core.js";

// A4 as pdf.js reports it, and the preview and final sizes the page would draw it at.
const W = 595.28;
const H = 841.89;
const PREVIEW = 700 / W; // the preview is 700 pixels wide
const canvasOf = (scale) => ({ w: Math.round(W * scale), h: Math.round(H * scale) }); // pdf.js rounds the canvas to whole pixels

test("a drag becomes the same box whichever way it is drawn", () => {
  const a = { x: 100, y: 200 };
  const b = { x: 300, y: 260 };
  const want = boxFromDrag(a, b, PREVIEW, W, H);
  assert.deepEqual(boxFromDrag(b, a, PREVIEW, W, H), want);
  assert.deepEqual(boxFromDrag({ x: a.x, y: b.y }, { x: b.x, y: a.y }, PREVIEW, W, H), want);
});

test("the box is measured from the bottom of the page, in points", () => {
  // The top 100 preview pixels of the page: its top edge is at the top of the page, so y is the page height less the box height.
  const box = boxFromDrag({ x: 0, y: 0 }, { x: 70, y: 100 }, 1, 700, 1000);
  assert.deepEqual(box, { x: 0, y: 900, w: 70, h: 100 });
});

test("a drag that runs past the edge of the page is trimmed to the page", () => {
  const box = boxFromDrag({ x: -50, y: -20 }, { x: 5000, y: 5000 }, PREVIEW, W, H);
  assert.deepEqual(box, { x: 0, y: 0, w: W, h: H });
  assert.equal(boxFromDrag({ x: 800, y: 100 }, { x: 900, y: 200 }, PREVIEW, W, H), null, "wholly outside the page leaves nothing");
});

test("a stray click or a sliver is not a box", () => {
  assert.equal(boxFromDrag({ x: 10, y: 10 }, { x: 10 + MIN_DRAG_PX - 1, y: 90 }, 1, W, H), null);
  assert.equal(boxFromDrag({ x: 10, y: 10 }, { x: 90, y: 10 + MIN_DRAG_PX - 1 }, 1, W, H), null);
  assert.ok(boxFromDrag({ x: 10, y: 10 }, { x: 10 + MIN_DRAG_PX, y: 10 + MIN_DRAG_PX }, 1, W, H));
});

test("the black pixels always cover the whole box, at any scale and wherever the box falls", () => {
  for (const scale of [1, PREVIEW, 2.5, 1.37]) {
    const { w: cw, h: ch } = canvasOf(scale);
    for (const box of [
      { x: 10.3, y: 700.7, w: 120.2, h: 14.9 },
      { x: 0, y: 0, w: 33.3, h: 33.3 }, // the bottom-left corner
      { x: W - 40.1, y: H - 20.9, w: 40.1, h: 20.9 }, // the top-right corner
      { x: 99.999999, y: 99.999999, w: 0.00001, h: 50 },
    ]) {
      const px = boxToPixels(box, scale, H, cw, ch);
      assert.ok(px.x <= box.x * scale + 1e-6, `left edge, scale ${scale}`);
      assert.ok(px.x + px.w >= Math.min((box.x + box.w) * scale, cw) - 1e-6, `right edge, scale ${scale}`);
      assert.ok(px.y <= (H - box.y - box.h) * scale + 1e-6, `top edge, scale ${scale}`);
      assert.ok(px.y + px.h >= Math.min((H - box.y) * scale, ch) - 1e-6, `bottom edge, scale ${scale}`);
      for (const n of [px.x, px.y, px.w, px.h]) assert.ok(Number.isInteger(n) && n >= 0);
    }
  }
});

test("a box that lands exactly on pixel lines is not made a pixel bigger", () => {
  assert.deepEqual(boxToPixels({ x: 10, y: 20, w: 30, h: 40 }, 2, 100, 200, 200), { x: 20, y: 80, w: 60, h: 80 });
});

test("a box on the bottom edge reaches the last row of pixels even though the canvas height is rounded", () => {
  const scale = 2.5; // 841.89 * 2.5 = 2104.725, so the canvas is 2105 rows
  const { w: cw, h: ch } = canvasOf(scale);
  assert.equal(ch, 2105);
  const px = boxToPixels({ x: 0, y: 0, w: 50, h: 10 }, scale, H, cw, ch);
  assert.equal(px.y + px.h, ch);
});

test("a box drawn on the preview lands on the same part of the page in the final picture", () => {
  const drawn = boxFromDrag({ x: 140, y: 300 }, { x: 420, y: 340 }, PREVIEW, W, H);
  const preview = boxToPixels(drawn, PREVIEW, H, ...Object.values(canvasOf(PREVIEW)));
  const final = boxToPixels(drawn, 2.5, H, ...Object.values(canvasOf(2.5)));
  // Compare in points: the two differ only by the whole-pixel rounding, which is under a pixel at each scale
  assert.ok(Math.abs(final.x / 2.5 - preview.x / PREVIEW) <= 1 / PREVIEW + 1 / 2.5);
  assert.ok(Math.abs(final.y / 2.5 - preview.y / PREVIEW) <= 1 / PREVIEW + 1 / 2.5);
  assert.ok(Math.abs(final.w / 2.5 - preview.w / PREVIEW) <= 2 / PREVIEW + 2 / 2.5);
  assert.ok(Math.abs(final.h / 2.5 - preview.h / PREVIEW) <= 2 / PREVIEW + 2 / 2.5);
});

test("a huge page is drawn smaller so the canvas stays within what browsers can draw", () => {
  assert.equal(outputScale(W, H), 2.5);
  const a0 = outputScale(2383.94, 3370.39);
  assert.ok(a0 < 2.5 && a0 * 2383.94 * (a0 * 3370.39) <= 16_000_000 + 1);
});
