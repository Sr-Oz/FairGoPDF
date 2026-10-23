// enterShownSpace lets tools draw on a page the way a viewer shows it (crop box applied, /Rotate undone).
// The expected positions come from the geometry (a viewer turns the page clockwise), not from the code's own matrix.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPdfCommon } from "./load.mjs";

const { PDFLib, enterShownSpace } = await loadPdfCommon();

// a point (x, y) in the shown page, measured from its bottom-left -> the same point in the page's own coordinates,
// relative to the crop box (bw x bh is the crop box as stored)
const toStored = {
  0: (x, y) => [x, y],
  90: (x, y, bw) => [bw - y, x],
  180: (x, y, bw, bh) => [bw - x, bh - y],
  270: (x, y, bw, bh) => [y, bh - x],
};

for (const rotation of [0, 90, 180, 270]) {
  for (const crop of [null, { x: 10, y: 20, w: 150, h: 250 }]) {
    test(`rotation ${rotation}${crop ? " with a crop box" : ""}`, async () => {
      const doc = await PDFLib.PDFDocument.create();
      const page = doc.addPage([200, 300]);
      page.setRotation(PDFLib.degrees(rotation));
      if (crop) page.setCropBox(crop.x, crop.y, crop.w, crop.h);
      const { x: bx, y: by, width: bw, height: bh } = page.getCropBox();

      const shown = enterShownSpace(page);
      const turned = rotation % 180 !== 0;
      assert.equal(shown.width, turned ? bh : bw);
      assert.equal(shown.height, turned ? bw : bh);

      const cm = page.getContentStream().operators.find((op) => op.name === "cm");
      const [a, b, c, d, e, f] = cm.args.map((n) => n.asNumber());
      for (const [x, y] of [[0, 0], [10, 20], [shown.width, shown.height], [shown.width, 0]]) {
        const [u, v] = toStored[rotation](x, y, bw, bh);
        assert.deepEqual([a * x + c * y + e, b * x + d * y + f], [bx + u, by + v], `shown (${x}, ${y})`);
      }
    });
  }
}
