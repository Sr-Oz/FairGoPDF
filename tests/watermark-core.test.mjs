import test from "node:test";
import assert from "node:assert/strict";
import { loadAsset } from "./load.mjs";

const core = await loadAsset("assets/tools/watermark-core.js");
const { boxExtent, bottomLeft, autoTextSize, layoutMarks, pagesFor, parseHex, describePages, CAP_HEIGHT, MAX_MARKS, SPACING } = core;

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const page = { w: 600, h: 800 };

test("a turned box needs a bigger box to hold it", () => {
  assert.deepEqual(boxExtent(100, 20, 0), { hw: 50, hh: 10 });
  const q = boxExtent(100, 20, 90);
  assert.ok(close(q.hw, 10) && close(q.hh, 50));
  const d = boxExtent(100, 20, 45);
  assert.ok(close(d.hw, (100 * Math.SQRT1_2 + 20 * Math.SQRT1_2) / 2));
  assert.ok(close(boxExtent(100, 20, -45).hw, d.hw));
});

test("the corner a drawing starts from puts its centre where it was asked", () => {
  for (const angle of [0, 30, 45, 90, -60, 180]) {
    const w = 120;
    const h = 30;
    const p = bottomLeft(300, 400, w, h, angle);
    const t = (angle * Math.PI) / 180;
    // the centre of the box, found by walking from that corner along the box's own sides
    const cx = p.x + (w / 2) * Math.cos(t) - (h / 2) * Math.sin(t);
    const cy = p.y + (w / 2) * Math.sin(t) + (h / 2) * Math.cos(t);
    assert.ok(close(cx, 300) && close(cy, 400), `angle ${angle}`);
  }
});

test("text sized to fit fills about four fifths of the page the way it is turned", () => {
  const at1 = 5; // text 5 wide at size 1
  const flat = autoTextSize({ textWidthAt1: at1, pageW: 600, pageH: 800, angle: 0 });
  assert.ok(close(flat * at1, 0.8 * 600, 1e-6));
  const turned = autoTextSize({ textWidthAt1: at1, pageW: 600, pageH: 800, angle: 45 });
  const { hw, hh } = boxExtent(at1 * turned, CAP_HEIGHT * turned, 45);
  assert.ok(2 * hw <= 0.8 * 600 + 1e-6 && 2 * hh <= 0.8 * 800 + 1e-6);
  assert.ok(close(2 * hw, 0.8 * 600) || close(2 * hh, 0.8 * 800)); // fills it along one side
  assert.equal(autoTextSize({ textWidthAt1: 0, pageW: 600, pageH: 800, angle: 0 }), 12);
  assert.equal(autoTextSize({ textWidthAt1: 0.001, pageW: 600, pageH: 800, angle: 0 }), 400); // never absurdly large
  assert.equal(autoTextSize({ textWidthAt1: 500, pageW: 600, pageH: 800, angle: 0 }), 8); // nor too small to read
});

test("one mark goes to the middle, or to a corner with a margin", () => {
  const mark = { w: 200, h: 40 };
  assert.deepEqual(layoutMarks({ page, mark }).marks, [{ cx: 300, cy: 400 }]);
  const tl = layoutMarks({ page, mark, position: "tl", margin: 30 }).marks[0];
  assert.ok(close(tl.cx, 30 + 100) && close(tl.cy, 800 - 30 - 20));
  const br = layoutMarks({ page, mark, position: "br", margin: 30 }).marks[0];
  assert.ok(close(br.cx, 600 - 30 - 100) && close(br.cy, 30 + 20));
  const tc = layoutMarks({ page, mark, position: "tc", margin: 30 }).marks[0];
  assert.ok(close(tc.cx, 300) && close(tc.cy, 750));
  const ml = layoutMarks({ page, mark, position: "ml", margin: 30 }).marks[0];
  assert.ok(close(ml.cx, 130) && close(ml.cy, 400));
});

test("a turned mark in a corner keeps its whole box inside the margin", () => {
  const mark = { w: 200, h: 40 };
  for (const position of ["tl", "tr", "bl", "br"]) {
    const { marks } = layoutMarks({ page, mark, angle: 45, position, margin: 20 });
    const { hw, hh } = boxExtent(mark.w, mark.h, 45);
    const m = marks[0];
    assert.ok(m.cx - hw >= 20 - 1e-6 && m.cx + hw <= 580 + 1e-6 && m.cy - hh >= 20 - 1e-6 && m.cy + hh <= 780 + 1e-6, position);
  }
});

test("a mark too big for the page is centred rather than pushed off", () => {
  const m = layoutMarks({ page: { w: 100, h: 100 }, mark: { w: 400, h: 50 }, position: "tl", margin: 10 }).marks[0];
  assert.ok(close(m.cx, 50));
});

test("tiled marks cover the page and each one touches it", () => {
  const mark = { w: 120, h: 24 };
  for (const angle of [0, 45, -30]) {
    const { marks, capped } = layoutMarks({ page, mark, angle, mode: "tiled", spacing: "normal" });
    assert.ok(marks.length > 6, `angle ${angle}`);
    assert.equal(capped, false);
    const { hw, hh } = boxExtent(mark.w, mark.h, angle);
    for (const m of marks) assert.ok(m.cx + hw > 0 && m.cx - hw < page.w && m.cy + hh > 0 && m.cy - hh < page.h);
    // the page's centre is in the grid
    assert.ok(marks.some((m) => close(m.cx, 300) && close(m.cy, 400)));
  }
});

test("wider spacing gives fewer marks, and staggering moves every other row", () => {
  const mark = { w: 120, h: 24 };
  const n = (spacing) => layoutMarks({ page, mark, mode: "tiled", spacing }).marks.length;
  assert.ok(n("tight") > n("normal") && n("normal") > n("wide"));
  const flat = layoutMarks({ page, mark, mode: "tiled", stagger: false }).marks;
  const stag = layoutMarks({ page, mark, mode: "tiled", stagger: true }).marks;
  // the nearest row above the middle is shifted by half a step when staggered
  const u = mark.w + SPACING.normal.x * mark.w;
  const rowY = 400 + (mark.h + SPACING.normal.y * mark.h);
  const row = (list) => list.filter((m) => close(m.cy, rowY)).map((m) => m.cx).sort((a, b) => a - b);
  const a = row(flat);
  const b = row(stag);
  assert.ok(a.length && b.length);
  assert.ok(close(Math.abs(a[0] - b[0]) % u, u / 2) || close(Math.abs(a[0] - b[0]) % u, u / 2, 1e-4));
});

test("tiling a tiny mark is held to a sensible number", () => {
  const { marks, capped } = layoutMarks({ page, mark: { w: 6, h: 2 }, mode: "tiled", spacing: "tight" });
  assert.equal(marks.length, MAX_MARKS);
  assert.equal(capped, true);
  // the ones kept are those nearest the middle
  const far = Math.max(...marks.map((m) => Math.hypot(m.cx - 300, m.cy - 400)));
  assert.ok(far < Math.hypot(300, 400));
});

test("pages are chosen all, all but the first, odd, even or by a list", () => {
  assert.deepEqual(pagesFor({ mode: "all", count: 4 }).pages, [0, 1, 2, 3]);
  assert.deepEqual(pagesFor({ mode: "notfirst", count: 4 }).pages, [1, 2, 3]);
  assert.deepEqual(pagesFor({ mode: "odd", count: 5 }).pages, [0, 2, 4]);
  assert.deepEqual(pagesFor({ mode: "even", count: 5 }).pages, [1, 3]);
  assert.deepEqual(pagesFor({ mode: "pages", spec: "1-2, 5", count: 6 }).pages, [0, 1, 4]);
  assert.deepEqual(pagesFor({ mode: "notfirst", count: 1 }).pages, []);
  assert.ok(pagesFor({ mode: "pages", spec: "abc", count: 6 }).error);
  assert.ok(pagesFor({ mode: "pages", spec: "", count: 6 }).error);
});

test("a colour is read from hex, with grey for anything else", () => {
  assert.deepEqual(parseHex("#ff0000"), { r: 1, g: 0, b: 0 });
  const g = parseHex("#808080");
  assert.ok(close(g.r, 128 / 255) && close(g.g, g.b));
  assert.ok(close(parseHex("nonsense").r, 0x88 / 255));
  assert.ok(close(parseHex("00ff00").g, 1));
});

test("the pages marked are put in words", () => {
  assert.equal(describePages(5, 5), "On every page.");
  assert.equal(describePages(1, 1), "On the page.");
  assert.equal(describePages(3, 5), "On 3 of 5 pages.");
  assert.equal(describePages(0, 5), "No pages selected.");
});
