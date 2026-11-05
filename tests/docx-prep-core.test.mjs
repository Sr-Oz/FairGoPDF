import test from "node:test";
import assert from "node:assert/strict";
import { ommlToRuns, pageSizeTwips, scriptName, summariseMissing, buildNotes } from "../assets/tools/docx-prep-core.js";

// small helpers to build the trees the page makes from the XML
const t = (text) => ({ n: "r", c: [{ n: "t", t: text }] });
const el = (n, ...c) => ({ n, c });
const props = (n, a) => ({ n, c: [], a });
const withPr = (n, prName, attr, ...c) => ({ n, c: [{ n: prName, c: [attr] }, ...c] });
const text = (runs) => runs.map((r) => r.text).join("");

test("a fraction becomes (a+b)/c and keeps simple parts bare", () => {
  const f = el("f", el("num", t("a+b")), el("den", t("c")));
  assert.equal(text(ommlToRuns(f)), "(a+b)/c");
  assert.equal(text(ommlToRuns(el("f", el("num", t("x")), el("den", t("2"))))), "x/2");
});

test("superscript and subscript are marked, not typed with ^", () => {
  const sup = ommlToRuns(el("sSup", el("e", t("x")), el("sup", t("2"))));
  assert.deepEqual(sup, [{ text: "x" }, { text: "2", sup: true, sub: undefined }]);
  const sub = ommlToRuns(el("sSub", el("e", t("x")), el("sub", t("i"))));
  assert.equal(sub[1].sub, true);
  const both = ommlToRuns(el("sSubSup", el("e", t("x")), el("sub", t("1")), el("sup", t("2"))));
  assert.deepEqual(both.map((r) => [r.text, !!r.sub, !!r.sup]), [["x", false, false], ["1", true, false], ["2", false, true]]);
});

test("a root: square root has no index, others raise it", () => {
  assert.equal(text(ommlToRuns(el("rad", el("deg"), el("e", t("x"))))), "√x");
  assert.equal(text(ommlToRuns(el("rad", el("deg"), el("e", t("x+1"))))), "√(x+1)");
  const cube = ommlToRuns(el("rad", el("deg", t("3")), el("e", t("x"))));
  assert.deepEqual(cube.map((r) => [r.text, !!r.sup]), [["3", true], ["√", false], ["x", false]]);
});

test("a sum shows its symbol, limits and body", () => {
  const sum = el("nary", { n: "naryPr", c: [props("chr", { val: "∑" })] }, el("sub", t("i=1")), el("sup", t("n")), el("e", t("i")));
  const runs = ommlToRuns(sum);
  assert.equal(text(runs), "∑i=1n i");
  assert.equal(runs[1].sub, true);
  assert.equal(runs[2].sup, true);
});

test("brackets use the given characters and separator", () => {
  const d = { n: "d", c: [{ n: "dPr", c: [props("begChr", { val: "[" }), props("endChr", { val: "]" })] }, el("e", t("a")), el("e", t("b"))] };
  assert.equal(text(ommlToRuns(d)), "[a|b]");
  assert.equal(text(ommlToRuns(el("d", el("e", t("x"))))), "(x)");
});

test("a function name is separated from its argument", () => {
  assert.equal(text(ommlToRuns(el("func", el("fName", t("sin")), el("e", t("x"))))), "sin x");
});

test("a matrix reads row by row", () => {
  const m = el("m", el("mr", el("e", t("1")), el("e", t("2"))), el("mr", el("e", t("3")), el("e", t("4"))));
  assert.equal(text(ommlToRuns(m)), "[1 2; 3 4]");
});

test("property elements add no text", () => {
  assert.deepEqual(ommlToRuns(el("r", el("rPr"), { n: "t", t: "ok" })), [{ text: "ok" }]);
});

test("pageSizeTwips keeps the orientation", () => {
  assert.deepEqual(pageSizeTwips("a4", 12240, 15840), { w: 11906, h: 16838 });
  assert.deepEqual(pageSizeTwips("letter", 16838, 11906), { w: 15840, h: 12240 });
  assert.equal(pageSizeTwips("keep", 1, 2), null);
});

test("scripts are named", () => {
  assert.equal(scriptName("你".codePointAt(0)), "Chinese, Japanese or Korean");
  assert.equal(scriptName("ب".codePointAt(0)), "Arabic");
  assert.equal(scriptName("א".codePointAt(0)), "Hebrew");
  assert.equal(scriptName("😀".codePointAt(0)), "emoji or symbol");
  assert.equal(scriptName(0x2f3), "other");
});

test("summariseMissing counts by script, most first", () => {
  assert.equal(summariseMissing([]), "");
  assert.match(summariseMissing([..."你好世"]), /^3 Chinese, Japanese or Korean characters could not be drawn/);
  assert.match(summariseMissing([..."你好ب"]), /^2 Chinese, Japanese or Korean characters and 1 Arabic character could not/);
});

test("buildNotes splits what changed from what was left out", () => {
  const { adjusted, lost } = buildNotes({ textBoxes: 1, equations: 2, footnotes: 3, charts: 1, shapes: 4, comments: 1 }, "5 Arabic characters could not be drawn");
  assert.equal(adjusted.length, 3);
  assert.match(adjusted[0], /^1 text box was placed/);
  assert.match(adjusted[1], /^2 equations were/);
  assert.match(adjusted[2], /^3 footnotes are listed at the end of their section/);
  assert.match(buildNotes({ footnotes: 1 }).adjusted[0], /^1 footnote is listed at the end of its section/);
  assert.deepEqual(lost, ["1 chart was left out", "4 drawn shapes were left out", "1 comment is not included", "5 Arabic characters could not be drawn"]);
  assert.deepEqual(buildNotes({}), { adjusted: [], lost: [] });
});
