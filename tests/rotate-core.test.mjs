import test from "node:test";
import assert from "node:assert/strict";
import { turnBy, placeTurned, darkPoints, estimateSkew, describeTurns } from "../assets/tools/rotate-core.js";

test("turns wrap round at 360 in both directions", () => {
  assert.equal(turnBy(0, 90), 90);
  assert.equal(turnBy(270, 90), 0);
  assert.equal(turnBy(0, -90), 270);
  assert.equal(turnBy(90, 180), 270);
  assert.equal(turnBy(180, -270), 270);
});

// the corners of the page after it has been turned and placed, in the new page's own coordinates
const corners = (w, h, p) => [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [p.x + x * Math.cos(p.theta) - y * Math.sin(p.theta), p.y + x * Math.sin(p.theta) + y * Math.cos(p.theta)]);

test("a page turned by an angle fits inside a page that grows to hold it", () => {
  for (const angle of [3, -7.5, 45, -45, 20]) {
    const p = placeTurned({ w: 600, h: 800, angle });
    for (const [x, y] of corners(600, 800, p)) {
      assert.ok(x >= -0.01 && x <= p.pageW + 0.01 && y >= -0.01 && y <= p.pageH + 0.01, `${angle}: ${x}, ${y} outside ${p.pageW} x ${p.pageH}`);
    }
  }
});

test("a square turned 45 degrees needs a page 1.414 times as wide", () => {
  const p = placeTurned({ w: 100, h: 100, angle: 45 });
  assert.ok(Math.abs(p.pageW - 141.42) < 0.01 && Math.abs(p.pageH - 141.42) < 0.01);
});

test("keeping the size keeps the page's own size, swapped for a sideways page", () => {
  const p = placeTurned({ w: 600, h: 800, angle: 3, grow: false });
  assert.deepEqual([p.pageW, p.pageH], [600, 800]);
  const s = placeTurned({ w: 600, h: 800, base: 90, angle: 3, grow: false });
  assert.deepEqual([s.pageW, s.pageH], [800, 600]);
});

test("the page is centred whatever the angle", () => {
  const p = placeTurned({ w: 500, h: 700, angle: 12 });
  const c = corners(500, 700, p);
  const mx = (Math.min(...c.map((q) => q[0])) + Math.max(...c.map((q) => q[0]))) / 2;
  const my = (Math.min(...c.map((q) => q[1])) + Math.max(...c.map((q) => q[1]))) / 2;
  assert.ok(Math.abs(mx - p.pageW / 2) < 0.01 && Math.abs(my - p.pageH / 2) < 0.01);
});

// lines of text: dense rows of dots, tilted so that they rise to the right by `tilt` degrees
function textPage(tilt, lines = 22) {
  const pts = [];
  const slope = Math.tan((tilt * Math.PI) / 180);
  for (let l = 0; l < lines; l++) {
    for (let x = 80; x < 760; x += 2) {
      for (let t = 0; t < 5; t++) pts.push({ x, y: Math.round(90 + l * 28 + t - x * slope) });
    }
  }
  return pts;
}

test("the tilt of lines of text is found, and is the turn that levels them", () => {
  for (const tilt of [3, -5, 1.2, 9]) {
    const r = estimateSkew(textPage(tilt));
    assert.equal(r.found, true);
    assert.ok(Math.abs(r.angle - tilt) <= 0.3, `tilt ${tilt} gave ${r.angle}`);
  }
});

test("a page that is already level gives 0", () => {
  const r = estimateSkew(textPage(0));
  assert.deepEqual(r, { angle: 0, found: true });
});

test("scattered dots and too few dots give 0 and say nothing was found", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = Array.from({ length: 5000 }, () => ({ x: rnd() * 800, y: rnd() * 1000 }));
  assert.deepEqual(estimateSkew(noise), { angle: 0, found: false });
  assert.deepEqual(estimateSkew(noise.slice(0, 100)), { angle: 0, found: false });
});

test("dark pixels are picked out of picture data", () => {
  // a 4 x 2 picture: black, white, dark grey, transparent black
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 60, 60, 60, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  const pts = darkPoints(data, 4, 2);
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(darkPoints(data, 4, 2, { max: 2 }).length <= 2, true);
});

test("turns are described in words", () => {
  assert.equal(describeTurns(new Map([[1, 90], [2, 90], [3, 270], [4, 180]]), 4), "2 pages turned right, 1 page turned left, 1 page turned upside down");
  assert.equal(describeTurns(new Map(), 4), "no page is turned");
  assert.equal(describeTurns(new Map(), 0), "");
});
