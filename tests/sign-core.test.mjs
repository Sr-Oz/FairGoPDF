import test from "node:test";
import assert from "node:assert/strict";
import { placeBox, shownSize, formatDate, DATE_STYLES, pdfSafe, keepInside, describeItems } from "../assets/tools/sign-core.js";

const box = { x: 0, y: 0, width: 600, height: 800 };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("on an upright page the spot is measured from the top left and the bottom left corner is returned", () => {
  // a 100 x 50 point box whose top left is 10% across and 20% down
  const p = placeBox({ xFrac: 0.1, yFrac: 0.2, wPts: 100, hPts: 50, box, rotation: 0 });
  assert.ok(close(p.x, 60));
  assert.ok(close(p.y, 800 - (0.2 * 800 + 50)));
  assert.equal(p.rotate, 0);
});

test("a crop box that does not start at the origin moves the spot with it", () => {
  const p = placeBox({ xFrac: 0, yFrac: 0, wPts: 10, hPts: 10, box: { x: 36, y: 20, width: 500, height: 700 }, rotation: 0 });
  assert.ok(close(p.x, 36) && close(p.y, 20 + 700 - 10));
});

// the four corners of the drawing, in the page's own coordinates, once it is placed and turned
function corners(p, wPts, hPts) {
  const t = (p.rotate * Math.PI) / 180;
  return [[0, 0], [wPts, 0], [0, hPts], [wPts, hPts]].map(([u, v]) => [p.x + u * Math.cos(t) - v * Math.sin(t), p.y + u * Math.sin(t) + v * Math.cos(t)]);
}

test("on every rotation the drawing lands inside the page, upright as the viewer shows it", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const wPts = 120;
    const hPts = 40;
    const p = placeBox({ xFrac: 0.3, yFrac: 0.4, wPts, hPts, box, rotation });
    for (const [x, y] of corners(p, wPts, hPts)) {
      assert.ok(x >= -1e-6 && x <= 600 + 1e-6 && y >= -1e-6 && y <= 800 + 1e-6, `rotation ${rotation}: ${x}, ${y}`);
    }
  }
});

test("the drawing's top left, once turned, sits where it was picked as the page is shown", () => {
  // shown page for 90: width 800, height 600. A viewer turns a /Rotate 90 page clockwise, so the page's own bottom-left corner
  // is at the shown top-left. Picking the shown top-left (0, 0) should put the drawing's top-left at the page's own bottom-left.
  const p = placeBox({ xFrac: 0, yFrac: 0, wPts: 100, hPts: 30, box, rotation: 90 });
  const [bl, br, tl, tr] = corners(p, 100, 30);
  // the drawing's top-left corner is `tl`; for an upright reader it should be at the page's own bottom-left (0, 0)
  assert.ok(close(tl[0], 0) && close(tl[1], 0), `got ${tl}`);
  assert.ok(close(bl[0], 30) && close(bl[1], 0), `got ${bl}`);
});

test("the shown size swaps for a sideways page", () => {
  assert.deepEqual(shownSize(box, 0), { w: 600, h: 800 });
  assert.deepEqual(shownSize(box, 90), { w: 800, h: 600 });
  assert.deepEqual(shownSize(box, 270), { w: 800, h: 600 });
  assert.deepEqual(shownSize(box, 180), { w: 600, h: 800 });
  assert.deepEqual(shownSize(box, -90), { w: 800, h: 600 });
});

test("dates are set in the styles people write them in", () => {
  const d = new Date(2026, 10, 5);
  assert.equal(formatDate(d, "dmy"), "05/11/2026");
  assert.equal(formatDate(d, "short"), "5 Nov 2026");
  assert.equal(formatDate(d, "long"), "5 November 2026");
  assert.equal(formatDate(d, "iso"), "2026-11-05");
  assert.equal(formatDate(new Date(2026, 0, 1)), "01/01/2026");
  assert.deepEqual(Object.keys(DATE_STYLES), ["dmy", "short", "long", "iso"]);
});

test("text the built-in font cannot set is spotted", () => {
  assert.equal(pdfSafe("Jane Citizen, 12 High St."), true);
  assert.equal(pdfSafe("José Núñez €5 “quoted” – dash"), true);
  assert.equal(pdfSafe("Hēmi Māori"), false);
  assert.equal(pdfSafe("你好"), false);
  assert.equal(pdfSafe(""), true);
});

test("a box is moved back inside the page", () => {
  assert.deepEqual(keepInside({ x: 0.95, y: -0.1 }, 0.2, 0.1), { x: 0.8, y: 0 });
  assert.deepEqual(keepInside({ x: 0.3, y: 0.95 }, 0.2, 0.1), { x: 0.3, y: 0.9 });
  assert.deepEqual(keepInside({ x: 0.5, y: 0.5 }, 1.2, 1.2), { x: 0, y: 0 });
});

test("the items are described in words", () => {
  assert.equal(describeItems([]), "Nothing placed yet.");
  assert.equal(describeItems([{ kind: "signature", page: 0 }]), "1 signature on 1 page.");
  assert.equal(describeItems([{ kind: "signature", page: 0 }, { kind: "signature", page: 2 }, { kind: "date", page: 2 }]), "2 signatures and 1 date on 2 pages.");
  assert.equal(describeItems([{ kind: "signature", page: 0 }, { kind: "date", page: 0 }, { kind: "tick", page: 1 }]), "1 signature, 1 date and 1 tick on 2 pages.");
});
