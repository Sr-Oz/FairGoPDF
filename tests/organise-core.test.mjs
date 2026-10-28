import test from "node:test";
import assert from "node:assert/strict";
import { reorderBlock, moveStep, moveToEdge, idsBetween, pickPages, insertAfterSelection, duplicateAfter, turn, createHistory } from "../assets/tools/organise-core.js";

const order = ["a", "b", "c", "d", "e", "f"];
const S = (...x) => new Set(x);

test("dropping pages before or after a target keeps them together in order", () => {
  assert.deepEqual(reorderBlock(order, S("a"), "d", false), ["b", "c", "a", "d", "e", "f"]);
  assert.deepEqual(reorderBlock(order, S("a"), "d", true), ["b", "c", "d", "a", "e", "f"]);
  assert.deepEqual(reorderBlock(order, S("e", "b"), "a", false), ["b", "e", "a", "c", "d", "f"]);
  assert.deepEqual(reorderBlock(order, S("b", "c"), "f", true), ["a", "d", "e", "f", "b", "c"]);
});

test("dropping on yourself, or on another moving page, changes nothing", () => {
  assert.equal(reorderBlock(order, S("b", "c"), "c", false), order);
  assert.equal(reorderBlock(order, S("b"), "zzz", false), order);
});

test("moving one step earlier or later", () => {
  assert.deepEqual(moveStep(order, S("c"), -1), ["a", "c", "b", "d", "e", "f"]);
  assert.deepEqual(moveStep(order, S("c"), 1), ["a", "b", "d", "c", "e", "f"]);
});

test("a group of neighbours moves as a group, and stops at the edge", () => {
  assert.deepEqual(moveStep(order, S("c", "d"), -1), ["a", "c", "d", "b", "e", "f"]);
  assert.deepEqual(moveStep(order, S("c", "d"), 1), ["a", "b", "e", "c", "d", "f"]);
  assert.deepEqual(moveStep(order, S("a", "b"), -1), order);
  assert.deepEqual(moveStep(order, S("e", "f"), 1), order);
  assert.deepEqual(moveStep(order, S("a", "c"), -1), ["a", "c", "b", "d", "e", "f"]); // a is at the edge, c is not
});

test("moving to the start or end keeps their order", () => {
  assert.deepEqual(moveToEdge(order, S("d", "b"), false), ["b", "d", "a", "c", "e", "f"]);
  assert.deepEqual(moveToEdge(order, S("d", "b"), true), ["a", "c", "e", "f", "b", "d"]);
});

test("a shift-click range works in either direction", () => {
  assert.deepEqual(idsBetween(order, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(idsBetween(order, "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(idsBetween(order, "b", "nope"), []);
});

test("quick picks go by position", () => {
  assert.deepEqual([...pickPages(order, "odd", S())], ["a", "c", "e"]);
  assert.deepEqual([...pickPages(order, "even", S())], ["b", "d", "f"]);
  assert.deepEqual([...pickPages(order, "invert", S("a", "b"))], ["c", "d", "e", "f"]);
  assert.equal(pickPages(order, "none", S("a")).size, 0);
  assert.equal(pickPages(order, "all", S()).size, 6);
});

test("new pages go after the last chosen page, or at the end", () => {
  assert.deepEqual(insertAfterSelection(order, S("b", "c"), ["x"]), ["a", "b", "c", "x", "d", "e", "f"]);
  assert.deepEqual(insertAfterSelection(order, S(), ["x", "y"]), [...order, "x", "y"]);
});

test("a copy goes straight after each original", () => {
  let n = 0;
  const { order: out, copies } = duplicateAfter(["a", "b", "c"], S("a", "c"), () => `copy${++n}`);
  assert.deepEqual(out, ["a", "copy1", "b", "c", "copy2"]);
  assert.equal(copies.get("c"), "copy2");
});

test("turning wraps around in both directions", () => {
  assert.equal(turn(270, 90), 0);
  assert.equal(turn(0, -90), 270);
  assert.equal(turn(90, 180), 270);
  assert.equal(turn(0, 0), 0);
});

test("undo and redo step through states, and a new change forgets the redo list", () => {
  const h = createHistory();
  assert.equal(h.undo("s0"), null);
  h.push("s0");
  h.push("s1");
  assert.equal(h.undo("s2"), "s1");
  assert.equal(h.undo("s1"), "s0");
  assert.equal(h.canUndo(), false);
  assert.equal(h.redo("s0"), "s1");
  assert.equal(h.canRedo(), true);
  h.push("s1b"); // a fresh change
  assert.equal(h.canRedo(), false);
});

test("history keeps only the most recent states", () => {
  const h = createHistory(3);
  for (const s of ["a", "b", "c", "d", "e"]) h.push(s);
  assert.equal(h.undo("now"), "e");
  assert.equal(h.undo("e"), "d");
  assert.equal(h.undo("d"), "c");
  assert.equal(h.undo("c"), null);
});
