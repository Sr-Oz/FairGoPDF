import test from "node:test";
import assert from "node:assert/strict";
import { nearestRun, charEdges, charAt, selectText, mergeLine, strokePath, arrowHead, boundsOf, moved, keepDelta, noteHeight, NOTE_PAD, describeItems } from "../assets/tools/annotate-core.js";

// every character 5 wide
const measure = (t) => [...t].length * 5;
const run = (str, x, y, h = 12) => ({ str, x, y, w: str.length * 5, h });

test("the run nearest a point is found, or none when the point is far from any text", () => {
  const runs = [run("hello world", 50, 100), run("second line", 50, 120)];
  assert.equal(nearestRun(runs, { x: 60, y: 105 }), 0);
  assert.equal(nearestRun(runs, { x: 60, y: 125 }), 1);
  assert.equal(nearestRun(runs, { x: 300, y: 105 }), -1); // far to the right
  assert.equal(nearestRun(runs, { x: 60, y: 400 }), -1);
  assert.equal(nearestRun(runs, { x: 300, y: 105 }, 400), 0);
  assert.equal(nearestRun([{ str: "  ", x: 0, y: 0, w: 10, h: 10 }], { x: 1, y: 1 }), -1);
});

test("characters sit at their share of the run's width", () => {
  const e = charEdges("abcd", 40, measure);
  assert.deepEqual(e, [0, 10, 20, 30, 40]);
  assert.equal(charAt(e, 12), 1);
  assert.equal(charAt(e, 16), 2);
  assert.equal(charAt(e, -5), 0);
  assert.equal(charAt(e, 99), 4);
  // wider letters take more of the width
  const wide = charEdges("iW", 30, (t) => [...t].reduce((n, c) => n + (c === "W" ? 3 : 1), 0));
  assert.deepEqual(wide, [0, 7.5, 30]);
});

test("a drag inside one run takes just the letters between its ends", () => {
  const runs = [run("hello world", 50, 100)]; // 55 wide, 5 a letter
  const boxes = selectText(runs, { x: 50 + 30 + 1, y: 105 }, { x: 50 + 55 - 1, y: 106 }, measure);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].x, 80);
  assert.ok(Math.abs(boxes[0].w - 25) < 1e-9); // "world"
  assert.equal(boxes[0].h, 12);
  // dragged the other way gives the same box
  assert.deepEqual(selectText(runs, { x: 104, y: 106 }, { x: 81, y: 105 }, measure), boxes);
});

test("a drag over several lines takes the end of the first, whole middle lines, and the start of the last", () => {
  const runs = [run("one two three", 50, 100), run("four five six", 50, 114), run("seven eight nine", 50, 128)];
  const boxes = selectText(runs, { x: 50 + 20, y: 105 }, { x: 50 + 25, y: 133 }, measure);
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes[0], { x: 70, y: 100, w: 65 - 20, h: 12 });
  assert.deepEqual(boxes[1], { x: 50, y: 114, w: 65, h: 12 });
  assert.deepEqual(boxes[2], { x: 50, y: 128, w: 25, h: 12 });
  // dragged upwards is the same
  assert.deepEqual(selectText(runs, { x: 75, y: 133 }, { x: 70, y: 105 }, measure), boxes);
});

test("a drag that starts or ends away from any text takes nothing, so the page can fall back to an area", () => {
  const runs = [run("hello world", 50, 100)];
  assert.deepEqual(selectText(runs, { x: 400, y: 400 }, { x: 60, y: 105 }, measure), []);
  assert.deepEqual(selectText(runs, { x: 60, y: 105 }, { x: 400, y: 400 }, measure), []);
  assert.deepEqual(selectText([], { x: 1, y: 1 }, { x: 2, y: 2 }, measure), []);
});

test("pieces on one line that almost touch are joined, those on different lines are not", () => {
  const joined = mergeLine([{ x: 10, y: 100, w: 30, h: 12 }, { x: 42, y: 100.5, w: 20, h: 12 }]);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].x, 10);
  assert.equal(joined[0].w, 52);
  assert.equal(mergeLine([{ x: 10, y: 100, w: 30, h: 12 }, { x: 10, y: 120, w: 30, h: 12 }]).length, 2);
  assert.equal(mergeLine([{ x: 10, y: 100, w: 30, h: 12 }, { x: 200, y: 100, w: 30, h: 12 }]).length, 2); // a big gap stays
});

test("a stroke is smoothed through its midpoints", () => {
  assert.equal(strokePath([]), "");
  assert.equal(strokePath([{ x: 1, y: 2 }]), "M1 2 L1.1 2");
  assert.equal(strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), "M0 0 L10 0");
  assert.equal(strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]), "M0 0 Q10 0 10 5 L10 10");
});

test("an arrow's head points back along the line from its tip", () => {
  const [tip, a, b] = arrowHead(0, 0, 100, 0, 2);
  assert.deepEqual(tip, { x: 100, y: 0 });
  assert.ok(a.x < 100 && b.x < 100);
  assert.ok(Math.abs(a.y + b.y) < 1e-9); // symmetric about the line
  assert.ok(Math.abs(Math.hypot(a.x - 100, a.y) - 9) < 1e-9); // 4.5 x the width, at least 8
  assert.ok(Math.hypot(arrowHead(0, 0, 100, 0, 0.5)[1].x - 100, arrowHead(0, 0, 100, 0, 0.5)[1].y) >= 8 - 1e-9);
});

test("every kind of item has a box, and can be moved and kept on the page", () => {
  const mark = { kind: "mark", style: "highlight", rects: [{ x: 10, y: 20, w: 30, h: 10 }, { x: 15, y: 32, w: 50, h: 10 }] };
  assert.deepEqual(boundsOf(mark), { x: 10, y: 20, w: 55, h: 22 });
  const ink = { kind: "ink", points: [{ x: 10, y: 10 }, { x: 30, y: 40 }], width: 4 };
  assert.deepEqual(boundsOf(ink), { x: 8, y: 8, w: 24, h: 34 });
  const shape = { kind: "shape", shape: "rect", x1: 50, y1: 60, x2: 20, y2: 10, width: 2 };
  assert.deepEqual(boundsOf(shape), { x: 19, y: 9, w: 32, h: 52 });
  const note = { kind: "note", x: 5, y: 6, w: 100, h: 40 };
  assert.deepEqual(boundsOf(note), { x: 5, y: 6, w: 100, h: 40 });
  assert.deepEqual(moved(mark, 5, 5).rects[1], { x: 20, y: 37, w: 50, h: 10 });
  assert.deepEqual(moved(ink, 1, 2).points[0], { x: 11, y: 12 });
  assert.equal(moved(shape, 10, 0).x2, 30);
  assert.equal(moved(note, 0, 4).y, 10);
  assert.equal(mark.rects[0].x, 10); // the original is left alone
  const page = { w: 200, h: 300 };
  assert.deepEqual(keepDelta({ x: 150, y: 10, w: 40, h: 20 }, 50, -30, page), { dx: 10, dy: -10 });
  assert.deepEqual(keepDelta({ x: 10, y: 10, w: 40, h: 20 }, 5, 5, page), { dx: 5, dy: 5 });
});

test("a note is as tall as its lines and its padding", () => {
  assert.equal(noteHeight(3, 10), 3 * 10 * 1.25 + 2 * NOTE_PAD);
  assert.equal(noteHeight(0, 10), 10 * 1.25 + 2 * NOTE_PAD);
});

test("what was added is put in words", () => {
  assert.equal(describeItems([]), "Nothing added yet.");
  assert.equal(describeItems([{ kind: "mark", style: "highlight", page: 0 }]), "1 highlight on 1 page.");
  assert.equal(describeItems([{ kind: "mark", style: "highlight", page: 0 }, { kind: "mark", style: "highlight", page: 1 }, { kind: "note", page: 1 }]), "2 highlights and 1 note on 2 pages.");
  assert.equal(describeItems([{ kind: "mark", style: "strike", page: 0 }, { kind: "ink", page: 0 }, { kind: "shape", page: 2 }]), "1 strikethrough, 1 drawing and 1 shape on 2 pages.");
});
