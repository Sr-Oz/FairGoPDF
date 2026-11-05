import test from "node:test";
import assert from "node:assert/strict";
import { buildDocument } from "../assets/tools/pdf-layout.js";
import { escapeMarkdown, runsToText, blocksToText, layoutPage, countWords, findAll, stepMatch, emptyPages, describeEmpty } from "../assets/tools/text-core.js";

const run = (text, extra = {}) => ({ text, bold: false, italic: false, link: null, ...extra });
const p = (text, extra = {}) => ({ type: "p", runs: [run(text)], ...extra });

test("Markdown gets bold, italic and links, and plain text gets just the words", () => {
  const runs = [run("Hello "), run("big", { bold: true }), run(" and "), run("slanted", { italic: true }), run(" "), run("site", { link: "https://example.com" })];
  assert.equal(runsToText(runs, true), "Hello **big** and *slanted* [site](https://example.com)");
  assert.equal(runsToText(runs, false), "Hello big and slanted site");
  assert.equal(runsToText([run(" padded ", { bold: true })], true), " **padded** ");
  assert.equal(runsToText([run("both", { bold: true, italic: true })], true), "***both***");
  // a link that is its own text is just the address
  assert.equal(runsToText([run("https://example.com/a", { link: "https://example.com/a" })], true), "<https://example.com/a>");
  assert.equal(runsToText([run("see https://x.org"), run(".", { link: null })], true), "see https://x.org.");
});

test("characters that would turn into Markdown are escaped", () => {
  assert.equal(escapeMarkdown("a*b_c [d] `e` <f> | g"), "a\\*b\\_c \\[d\\] \\`e\\` \\<f\\> \\| g");
  assert.equal(escapeMarkdown("# not a heading"), "\\# not a heading");
  assert.equal(escapeMarkdown("- not a list"), "\\- not a list");
  assert.equal(escapeMarkdown("1. not a list"), "1\\. not a list");
  assert.equal(escapeMarkdown("plain text"), "plain text");
  assert.equal(runsToText([run("snake_case*")], true), "snake\\_case\\*");
});

test("paragraphs are separated by a blank line, headings get # in Markdown only", () => {
  const blocks = [p("Title", { heading: 1 }), p("First paragraph."), p("Sub", { heading: 2 }), p("Second paragraph.")];
  assert.equal(blocksToText(blocks, { format: "txt" }), "Title\n\nFirst paragraph.\n\nSub\n\nSecond paragraph.");
  assert.equal(blocksToText(blocks, { format: "md" }), "# Title\n\nFirst paragraph.\n\n## Sub\n\nSecond paragraph.");
});

test("a run of list items stays together, numbered from where it starts, with nesting", () => {
  const blocks = [
    p("Intro"),
    p("one", { list: { id: 1, kind: "decimal", level: 0, start: 1 } }),
    p("two", { list: { id: 1, kind: "decimal", level: 0, start: 1 } }),
    p("nested", { list: { id: 1, kind: "decimal", level: 1, start: 1 } }),
    p("After"),
    p("apple", { list: { id: 2, kind: "bullet", level: 0, start: 0 } }),
    p("pear", { list: { id: 2, kind: "bullet", level: 0, start: 0 } }),
    p("later", { list: { id: 3, kind: "decimal", level: 0, start: 5 } }),
  ];
  assert.equal(blocksToText(blocks, { format: "txt" }), "Intro\n\n1. one\n2. two\n  3. nested\n\nAfter\n\n• apple\n• pear\n\n5. later");
  assert.equal(blocksToText(blocks, { format: "md" }).split("\n\n")[3], "- apple\n- pear");
  const letters = [p("a", { list: { id: 9, kind: "lowerLetter", level: 0, start: 1 } }), p("b", { list: { id: 9, kind: "lowerLetter", level: 0, start: 1 } })];
  assert.equal(blocksToText(letters, { format: "txt" }), "a. a\nb. b");
});

test("page markers say where each page begins, using the real page numbers", () => {
  const blocks = [p("page one text"), p("page three text", { pageBreakBefore: true }), { type: "p", runs: [], pageBreakBefore: true }, p("page six text", { pageBreakBefore: true })];
  const txt = blocksToText(blocks, { format: "txt", markers: true, pageNumbers: [1, 3, 4, 6] });
  assert.equal(txt, "--- Page 1 ---\n\npage one text\n\n--- Page 3 ---\n\npage three text\n\n--- Page 4 ---\n\n--- Page 6 ---\n\npage six text");
  assert.equal(blocksToText(blocks, { format: "txt", markers: false }), "page one text\n\npage three text\n\npage six text");
  assert.match(blocksToText(blocks, { format: "md", markers: true, pageNumbers: [1, 3, 4, 6] }), /---\n\n\*Page 3\*/);
});

const cell = (t, span = 1) => ({ runs: [run(t)], align: "left", span });
test("a table comes out as padded columns, or as a Markdown table", () => {
  const table = { type: "table", rows: [[cell("Item"), cell("Price")], [cell("Coffee"), cell("$4.50")], [cell("Tea | herbal"), cell("$3")]] };
  assert.equal(blocksToText([table], { format: "txt" }), "Item          Price\nCoffee        $4.50\nTea | herbal  $3");
  assert.equal(blocksToText([table], { format: "md" }), "| Item | Price |\n| --- | --- |\n| Coffee | $4.50 |\n| Tea \\| herbal | $3 |");
  // the heading row of a Markdown table is not also bold
  const headed = { type: "table", rows: [[{ runs: [run("Item", { bold: true })], align: "left", span: 1 }], [cell("x")]] };
  assert.equal(blocksToText([headed], { format: "md" }).split("\n")[0], "| Item |");
  const span = { type: "table", rows: [[cell("Wide heading", 2)], [cell("a"), cell("b")]] };
  assert.equal(blocksToText([span], { format: "md" }).split("\n")[0], "| Wide heading |  |");
});

const T = (str, x, y, size = 10) => ({ str, x, y, w: str.length * size * 0.5, size });
test("laid-out text keeps columns lined up and gaps open", () => {
  const items = [T("Name", 50, 100), T("Amount", 250, 100), T("Jane", 50, 114), T("$40", 250, 114), T("Total", 50, 142), T("$40", 250, 142)];
  const lines = layoutPage(items).split("\n");
  assert.equal(lines.length, 4); // a bigger gap is a blank line
  assert.equal(lines[2], "");
  assert.equal(lines[0].indexOf("Amount"), lines[1].indexOf("$40"));
  assert.equal(lines[3].indexOf("$40"), lines[1].indexOf("$40"));
  assert.equal(layoutPage([]), "");
});

test("two columns stay side by side when laid out", () => {
  const items = [T("left one", 50, 100), T("right one", 300, 100), T("left two", 50, 114), T("right two", 300, 114)];
  const lines = layoutPage(items).split("\n");
  assert.equal(lines[0].indexOf("right one"), lines[1].indexOf("right two"));
  assert.ok(lines[0].indexOf("right one") > 10);
});

test("words are counted in any language, with apostrophes and hyphens inside a word", () => {
  assert.equal(countWords("Hello, world!"), 2);
  assert.equal(countWords("don't well-known 42"), 3);
  assert.equal(countWords("Hēmi Māori"), 2);
  assert.equal(countWords("  \n "), 0);
  assert.equal(countWords("日本語 text"), 2);
});

test("a search finds each place, ignoring case unless asked, and steps through them", () => {
  const text = "Cat, cat, CAT. Concatenate.";
  assert.deepEqual(findAll(text, "cat"), [0, 5, 10, 18]);
  assert.deepEqual(findAll(text, "cat", true), [5, 18]);
  assert.deepEqual(findAll(text, ""), []);
  assert.deepEqual(findAll("aaaa", "aa"), [0, 2]);
  const m = [0, 5, 10, 18];
  assert.equal(stepMatch(m, 0, 1), 0);
  assert.equal(stepMatch(m, 6, 1), 2);
  assert.equal(stepMatch(m, 19, 1), 0); // goes round
  assert.equal(stepMatch(m, 10, -1), 1);
  assert.equal(stepMatch(m, 0, -1), 3); // goes round
  assert.equal(stepMatch([], 0), -1);
});

test("pages with nothing to read are found and described", () => {
  const pages = [{ number: 1, items: [T("hello", 0, 0)], rotated: "" }, { number: 2, items: [], rotated: "" }, { number: 3, items: [{ str: "  " }], rotated: "" }, { number: 4, items: [], rotated: "sideways" }];
  assert.deepEqual(emptyPages(pages), [2, 3]);
  assert.equal(describeEmpty([], 4), "");
  assert.match(describeEmpty([2, 3], 4), /Pages 2, 3 have no text/);
  assert.match(describeEmpty([2], 4), /Page 2 has no text/);
  assert.match(describeEmpty([1, 2, 3], 3), /None of these 3 pages/);
  assert.match(describeEmpty([1], 1), /This page has no text/);
  assert.match(describeEmpty([1, 2, 3, 4, 5, 6, 7, 8], 20), /and 2 more/);
});

// the real layout code, and the text made from it
const L = (str, x, y, size = 11, extra = {}) => ({ str, x, y, w: str.length * size * 0.5, size, bold: false, italic: false, family: "Arial", ...extra });
test("a real page goes from positioned text to headed paragraphs and a list", () => {
  const FULL = "x".repeat(90);
  const items = [L("A Heading", 72, 90, 20, { bold: true }), L(FULL, 72, 130), L(FULL, 72, 144), L("end of paragraph", 72, 158), L("1. first", 72, 190), L("2. second", 72, 204)];
  const doc = buildDocument([{ number: 1, width: 595, height: 842, items, images: [], rotated: "" }], { pageBreaks: true });
  const text = blocksToText(doc.sections.flatMap((s) => s.blocks), { format: "md" });
  assert.match(text, /^# A Heading\n\n/);
  assert.match(text, /end of paragraph/);
  assert.match(text, /1\. first\n2\. second$/);
});
