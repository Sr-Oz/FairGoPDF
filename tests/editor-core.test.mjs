import test from "node:test";
import assert from "node:assert/strict";
import { wrapText, baselineFromTop, textHeight, lineX, keepOnPage, toHex, fromHex, medianColour, describeItems } from "../assets/tools/editor-core.js";

// every character 10 wide, so a width of 50 holds 5 characters
const m = (s) => [...s].length * 10;

test("text breaks at spaces so that no line is wider than the box", () => {
  assert.deepEqual(wrapText("the quick brown fox", 100, m), ["the quick", "brown fox"]);
  assert.deepEqual(wrapText("one two three", 120, m), ["one two", "three"]);
  assert.deepEqual(wrapText("short", 500, m), ["short"]);
  for (const line of wrapText("a bb ccc dddd eeeee ffffff", 70, m)) assert.ok(m(line) <= 70, line);
});

test("a line break that was typed is kept, blank lines too", () => {
  assert.deepEqual(wrapText("one\ntwo", 500, m), ["one", "two"]);
  assert.deepEqual(wrapText("one\n\nthree", 500, m), ["one", "", "three"]);
  assert.deepEqual(wrapText("a\r\nb", 500, m), ["a", "b"]);
  assert.deepEqual(wrapText("", 100, m), [""]);
  assert.deepEqual(wrapText("   ", 100, m), [""]);
});

test("a word wider than the box on its own is cut where it has to be", () => {
  assert.deepEqual(wrapText("abcdefghij", 40, m), ["abcd", "efgh", "ij"]);
  const lines = wrapText("hi abcdefghijkl yo", 50, m);
  for (const l of lines) assert.ok(m(l) <= 50, l);
  assert.equal(lines.join("").replace(/ /g, ""), "hiabcdefghijklyo");
  // a box narrower than one letter still ends, one letter to a line
  assert.deepEqual(wrapText("abc", 5, m), ["a", "b", "c"]);
});

test("trailing spaces do not count against the width, and are not kept", () => {
  assert.deepEqual(wrapText("abcde fghij", 50, m), ["abcde", "fghij"]);
  assert.deepEqual(wrapText("abcde  ", 50, m), ["abcde"]);
});

test("each line's baseline is set from the line's own box", () => {
  const first = baselineFromTop("Helvetica", 10, 1.2, 0);
  assert.ok(Math.abs(first - (6 + 3.465)) < 1e-9);
  assert.ok(Math.abs(baselineFromTop("Helvetica", 10, 1.2, 2) - (first + 24)) < 1e-9);
  assert.ok(baselineFromTop("Courier", 10, 1.2, 0) < baselineFromTop("Helvetica", 10, 1.2, 0));
  assert.equal(baselineFromTop("Unknown", 10, 1, 0), baselineFromTop("Helvetica", 10, 1, 0));
  assert.equal(textHeight(3, 10, 1.2), 36);
  assert.equal(textHeight(0, 10, 1.2), 12);
});

test("a line starts at the left, the middle or the right of its box", () => {
  const box = { x: 100, w: 200 };
  assert.equal(lineX(box, 80), 100);
  assert.equal(lineX(box, 80, "center"), 160);
  assert.equal(lineX(box, 80, "right"), 220);
});

test("a box is moved back onto the page", () => {
  const page = { w: 600, h: 800 };
  assert.deepEqual(keepOnPage({ x: -5, y: 790, w: 100, h: 50 }, page), { x: 0, y: 750, w: 100, h: 50 });
  assert.deepEqual(keepOnPage({ x: 590, y: 10, w: 100, h: 50 }, page), { x: 500, y: 10, w: 100, h: 50 });
  assert.deepEqual(keepOnPage({ x: 5, y: 5, w: 700, h: 900 }, page), { x: 0, y: 0, w: 700, h: 900 }); // too big: from the top left
});

test("colours go to hex and back", () => {
  assert.equal(toHex({ r: 255, g: 0, b: 16 }), "#ff0010");
  assert.deepEqual(fromHex("#ff0010"), { r: 255, g: 0, b: 16 });
  assert.deepEqual(fromHex("00ff00"), { r: 0, g: 255, b: 0 });
  assert.deepEqual(fromHex("nonsense"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(fromHex("nonsense", { r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
});

test("a page's background is the middle colour of the pixels, ignoring stray specks", () => {
  const px = [];
  for (let i = 0; i < 20; i++) px.push(250, 245, 230, 255); // cream paper
  px.push(0, 0, 0, 255, 10, 10, 10, 255); // two dark specks of text
  assert.deepEqual(medianColour(px), { r: 250, g: 245, b: 230 });
  assert.equal(medianColour([]), null);
  assert.equal(medianColour([1, 2, 3, 0, 4, 5, 6, 10]), null); // see-through pixels are left out
});

test("what was added is put in words", () => {
  assert.equal(describeItems([]), "Nothing added yet.");
  assert.equal(describeItems([{ kind: "text", page: 0 }]), "1 text box on 1 page.");
  assert.equal(describeItems([{ kind: "text", page: 0 }, { kind: "text", page: 2 }, { kind: "picture", page: 2 }]), "2 text boxes and 1 picture on 2 pages.");
  assert.equal(describeItems([{ kind: "text", page: 0 }, { kind: "box", page: 0 }, { kind: "picture", page: 1 }]), "1 text box, 1 box and 1 picture on 2 pages.");
});
