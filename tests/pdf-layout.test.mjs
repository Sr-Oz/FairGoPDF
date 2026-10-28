import test from "node:test";
import assert from "node:assert/strict";
import { fontStyleOf, buildLines, findGutter, splitColumns, findRunningLines, listMarker, findMarkers, buildDocument } from "../assets/tools/pdf-layout.js";

// a line of text as one item: about half a size wide per character
const T = (str, x, y, size = 11, extra = {}) => ({ str, x, y, w: str.length * size * 0.5, size, bold: false, italic: false, family: "Arial", ...extra });
const page = (items, extra = {}) => ({ number: 1, width: 595, height: 842, items, images: [], rotated: "", ...extra });
const textOf = (doc) => doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === "p").map((b) => b.runs.map((r) => r.text).join(""));
const blocksOf = (doc) => doc.sections.flatMap((s) => s.blocks);

// a block of wrapped text: every line fills the width except the last
function paragraph(lines, x, y0, size = 11, pitch = 14) {
  return lines.map((s, i) => T(s, x, y0 + i * pitch, size));
}
const FULL = "x".repeat(90); // 90 chars at size 11 is 495pt, so lines run from 72 to 567

test("font names give a family, bold and italic", () => {
  assert.deepEqual(fontStyleOf("ABCDEF+TimesNewRomanPS-BoldItalicMT"), { family: "Times New Roman", bold: true, italic: true });
  assert.deepEqual(fontStyleOf("ArialMT"), { family: "Arial", bold: false, italic: false });
  assert.deepEqual(fontStyleOf("Helvetica-Bold"), { family: "Arial", bold: true, italic: false });
  assert.deepEqual(fontStyleOf("Calibri-LightItalic"), { family: "Calibri", bold: false, italic: true });
  assert.deepEqual(fontStyleOf("Cambria,Bold"), { family: "Cambria", bold: true, italic: false });
  assert.equal(fontStyleOf("SegoeUI-Semibold").family, "Segoe UI");
  assert.equal(fontStyleOf("g_d0_f3").family, null);
  assert.equal(fontStyleOf("Times-Roman").family, "Times New Roman");
});

test("pieces on one baseline make one line, with spaces where there are gaps", () => {
  const items = [T("Hello", 72, 100), T("world", 72 + 5 * 5.5 + 8, 100), T("again", 72 + 11 * 5.5 + 16, 100.3)];
  const lines = buildLines(items);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "Hello world again");
});

test("a big gap becomes a tab, and the line is marked as tabbed", () => {
  const [line] = buildLines([T("Item", 72, 100), T("$5.00", 400, 100)]);
  assert.equal(line.text, "Item\t$5.00");
  assert.equal(line.tabbed, true);
});

test("a small raised piece joins its line", () => {
  const [line] = buildLines([T("E = mc", 72, 100), { ...T("2", 72 + 6 * 5.5, 96, 7) }]);
  assert.equal(buildLines([T("E = mc", 72, 100), T("2", 72 + 33, 96, 7)]).length, 1);
  assert.match(line.text, /^E = mc/);
});

test("lines far apart stay apart, in reading order", () => {
  const lines = buildLines([T("second", 72, 140), T("first", 72, 100)]);
  assert.deepEqual(lines.map((l) => l.text), ["first", "second"]);
});

test("wrapped lines join into a paragraph, and a gap starts a new one", () => {
  const items = [...paragraph([FULL, FULL, "short end"], 72, 100), ...paragraph([FULL, "second para end"], 72, 100 + 3 * 14 + 10)];
  const doc = buildDocument([page(items)]);
  const ps = textOf(doc);
  assert.equal(ps.length, 2);
  assert.ok(ps[0].endsWith("short end"));
  assert.ok(ps[1].endsWith("second para end"));
  assert.ok(!ps[0].includes("\n"));
});

test("a line that stops short ends its paragraph even without a gap (an address)", () => {
  const items = [T("12 Example Street", 72, 100), T("Perth WA 6000", 72, 114), T("Australia", 72, 128), ...paragraph([FULL, FULL, "the end"], 72, 170)];
  const ps = textOf(buildDocument([page(items)]));
  assert.deepEqual(ps.slice(0, 3), ["12 Example Street", "Perth WA 6000", "Australia"]);
});

test("words split across lines are rejoined", () => {
  const items = paragraph(["a long sentence about the infor-", "mation that was split in two"], 72, 100);
  items[0] = T("x".repeat(80) + " infor-", 72, 100);
  const ps = textOf(buildDocument([page(items)]));
  assert.ok(ps[0].includes("information"), ps[0]);
  const kept = textOf(buildDocument([page(items)], { joinHyphens: false }));
  assert.ok(kept[0].includes("infor- mation"), kept[0]);
});

test("bigger text becomes headings, ranked by size", () => {
  const items = [T("Annual Report", 72, 80, 24), T("Overview", 72, 130, 16), ...paragraph([FULL, FULL, "end of text"], 72, 160), ...paragraph([FULL, FULL, "more text"], 72, 220)];
  const blocks = blocksOf(buildDocument([page(items)]));
  assert.equal(blocks[0].heading, 1);
  assert.equal(blocks[1].heading, 2);
  assert.equal(blocks[2].heading, undefined);
});

test("a short all-bold line at body size is a heading, but a bold paragraph is not", () => {
  const bold = (s, x, y) => T(s, x, y, 11, { bold: true });
  const items = [bold("1. Definitions", 72, 100), ...paragraph([FULL, FULL, FULL, FULL, FULL, FULL, "end"], 72, 125), bold("x".repeat(90), 72, 240), bold("x".repeat(90), 72, 254), bold("done bold text.", 72, 268)];
  const blocks = blocksOf(buildDocument([page(items)]));
  assert.ok(blocks[0].heading >= 2);
  assert.equal(blocks[2].heading, undefined);
});

test("a document that is mostly bold does not turn every line into a heading", () => {
  const bold = (s, x, y) => T(s, x, y, 11, { bold: true });
  const items = [bold("First short line", 72, 100), bold("Second short line", 72, 140), bold("Third short line", 72, 180), T("regular text here that goes on", 72, 220)];
  assert.ok(blocksOf(buildDocument([page(items)])).every((b) => !b.heading));
});

test("bold and italic runs are kept inside a paragraph", () => {
  const items = [T("Plain then ", 72, 100), T("bold", 72 + 11 * 5.5, 100, 11, { bold: true }), T(" and more", 72 + 15 * 5.5, 100)];
  const [b] = blocksOf(buildDocument([page(items)]));
  assert.deepEqual(b.runs.map((r) => [r.text, r.bold]), [["Plain then ", false], ["bold", true], [" and more", false]]);
});

test("styling off flattens bold and italic", () => {
  const items = [T("bold", 72, 100, 11, { bold: true, italic: true })];
  const [b] = blocksOf(buildDocument([page(items)], { styling: false }));
  assert.equal(b.runs[0].bold, false);
  assert.equal(b.runs[0].italic, false);
});

test("list markers", () => {
  assert.deepEqual(listMarker("• apples"), { kind: "bullet", value: 0, length: 2 });
  assert.equal(listMarker("2. second").kind, "decimal");
  assert.equal(listMarker("(a) first").kind, "lowerLetter");
  assert.equal(listMarker("iv) fourth").value, 4);
  assert.equal(listMarker("plain text"), null);
  assert.equal(listMarker("-no space"), null);
});

test("numbers only make a list when they run on", () => {
  const lines = buildLines([T("1. one", 72, 100), T("2. two", 72, 114), T("A. Smith wrote this", 72, 160), T("7. lone number", 72, 220)]);
  const found = findMarkers(lines);
  assert.ok(found.has(lines[0]) && found.has(lines[1]));
  assert.ok(!found.has(lines[2]));
  assert.ok(!found.has(lines[3]));
});

test("a bullet list keeps its wrapped lines and drops the marker", () => {
  const items = [T("• first item wraps onto", 72, 100), T("a second line of it", 90, 114), T("• second item", 72, 128), T("• third item", 72, 142)];
  const blocks = blocksOf(buildDocument([page(items)]));
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].list.kind, "bullet");
  assert.equal(blocks[0].runs.map((r) => r.text).join(""), "first item wraps onto a second line of it");
  assert.equal(blocks[0].list.id, blocks[2].list.id);
});

test("a numbered list starts from the number it begins with", () => {
  const items = [T("3. third", 72, 100), T("4. fourth", 72, 114), T("5. fifth", 72, 128)];
  const [b] = blocksOf(buildDocument([page(items)]));
  assert.equal(b.list.kind, "decimal");
  assert.equal(b.list.start, 3);
});

test("an indented list item sits one level down", () => {
  const items = [T("• top", 72, 100), T("• nested", 100, 114), T("• top again", 72, 128)];
  const levels = blocksOf(buildDocument([page(items)])).map((b) => b.list.level);
  assert.deepEqual(levels, [0, 1, 0]);
});

test("lists off leaves the markers in the text", () => {
  const [b] = blocksOf(buildDocument([page([T("• apples", 72, 100)])], { lists: false }));
  assert.equal(b.list, undefined);
  assert.ok(b.runs[0].text.startsWith("•"));
});

test("page numbers and repeated headers and footers are left out", () => {
  const mk = (n) => page([T("Company Ltd", 72, 30), ...paragraph([FULL, FULL, `text for page ${n}`], 72, 100 + n), T(`Page ${n} of 3`, 280, 810), T(String(n), 300, 825)], { number: n });
  const doc = buildDocument([mk(1), mk(2), mk(3)]);
  const all = textOf(doc).join("|");
  assert.ok(!all.includes("Company Ltd"));
  assert.ok(!/Page \d of 3/.test(all));
  assert.ok(all.includes("text for page 1"));
  assert.ok(doc.stats.removed >= 9);
  const kept = textOf(buildDocument([mk(1), mk(2), mk(3)], { dropRunning: false })).join("|");
  assert.ok(kept.includes("Company Ltd"));
});

test("a page number is dropped even on a one-page document, but real text in the margin stays", () => {
  const doc = buildDocument([page([...paragraph([FULL, "end"], 72, 100), T("1", 300, 820), T("Confidential draft", 72, 828)])]);
  const all = textOf(doc).join("|");
  assert.ok(!/(^|\|)1(\||$)/.test(all));
  assert.ok(all.includes("Confidential draft")); // only one page, so it cannot be told apart from content
});

function twoColumns(rows = 14) {
  const items = [];
  for (let i = 0; i < rows; i++) {
    items.push(T("L".repeat(38) + ` ${i}`, 60, 100 + i * 14)); // about 215pt wide, so 60 to 275
    items.push(T("R".repeat(38) + ` ${i}`, 320, 100 + i * 14));
  }
  return items;
}

test("a gutter is found between two columns of running text", () => {
  const g = findGutter(twoColumns(), 11);
  assert.ok(g && g.x0 > 280 && g.x1 < 325, JSON.stringify(g));
});

test("columns are read one after the other", () => {
  const groups = splitColumns(twoColumns(), 11);
  assert.deepEqual(groups.map((g) => g.kind), ["left", "right"]);
  const doc = buildDocument([page(twoColumns())]);
  const all = textOf(doc).join(" ");
  assert.ok(all.indexOf("L") < all.indexOf("R"));
  assert.ok(all.lastIndexOf("L") < all.indexOf("R"), "all the left column comes before the right one");
});

test("a full-width heading above two columns stays on top", () => {
  const items = [T("A Wide Heading Across Both Columns Of The Page Here", 60, 70, 11), ...twoColumns()];
  const groups = splitColumns(items, 11);
  assert.deepEqual(groups.map((g) => g.kind), ["full", "left", "right"]);
});

test("short table cells are not mistaken for columns", () => {
  const items = [];
  for (let i = 0; i < 14; i++) { items.push(T("Name", 60, 100 + i * 14)); items.push(T("Qty", 320, 100 + i * 14)); }
  assert.equal(findGutter(items, 11), null);
});

test("columns off reads straight across", () => {
  const lines = buildLines(twoColumns(10));
  assert.match(lines[0].text, /^L+ 0 R+ 0$/);
});

test("a paragraph that runs over a page break is joined in flow mode, and left alone with page breaks", () => {
  const p1 = page(paragraph([FULL, FULL], 72, 700));
  const p2 = page(paragraph(["continues here and finishes.", ], 72, 80), { number: 2 });
  const flow = textOf(buildDocument([p1, p2]));
  assert.equal(flow.length, 1);
  assert.ok(flow[0].endsWith("finishes."));
  const split = buildDocument([p1, p2], { pageBreaks: true });
  assert.equal(textOf(split).length, 2);
  assert.equal(blocksOf(split)[1].pageBreakBefore, true);
});

test("a paragraph that ended with a full stop is not joined to the next page", () => {
  const p1 = page(paragraph([FULL, FULL + "."], 72, 700));
  const p2 = page(paragraph(["new paragraph on the next page"], 72, 80), { number: 2 });
  assert.equal(textOf(buildDocument([p1, p2])).length, 2);
});

test("centred lines are centred, and indents are measured from the left margin", () => {
  const items = [T("Centred Title Text", 270, 100), ...paragraph([FULL, FULL, "end"], 72, 150), T("indented line of text here", 108, 220)];
  const blocks = blocksOf(buildDocument([page(items)]));
  assert.equal(blocks[0].align, "center");
  assert.ok(blocks.at(-1).left > 30 && blocks.at(-1).left < 40, String(blocks.at(-1).left));
});

test("the space after a paragraph follows the gap on the page", () => {
  const items = [...paragraph([FULL, "end one"], 72, 100), ...paragraph([FULL, "end two"], 72, 100 + 2 * 14 + 12), T("tight", 72, 200)];
  const blocks = blocksOf(buildDocument([page(items)]));
  assert.ok(blocks[0].after >= 8 && blocks[0].after <= 14, String(blocks[0].after));
});

test("web addresses and emails become links", () => {
  const [b] = blocksOf(buildDocument([page([T("Visit https://example.com/page. or mail a.b@example.org today", 72, 100)])]));
  const links = b.runs.filter((r) => r.link).map((r) => r.link);
  assert.deepEqual(links, ["https://example.com/page", "mailto:a.b@example.org"]);
  assert.equal(b.runs.map((r) => r.text).join(""), "Visit https://example.com/page. or mail a.b@example.org today");
});

test("links from the PDF are kept, and links off removes them", () => {
  const items = [T("Click ", 72, 100), T("here", 72 + 33, 100, 11, { link: "https://example.org" })];
  const withLinks = blocksOf(buildDocument([page(items)]))[0];
  assert.ok(withLinks.runs.some((r) => r.link === "https://example.org"));
  const without = blocksOf(buildDocument([page(items)], { links: false }))[0];
  assert.ok(without.runs.every((r) => !r.link));
});

test("a picture sits between the paragraphs it is between", () => {
  const items = [...paragraph([FULL, "above"], 72, 100), ...paragraph([FULL, "below"], 72, 300)];
  const doc = buildDocument([page(items, { images: [{ id: "img1", sig: "a", x: 100, y: 150, w: 200, h: 100 }] })]);
  const kinds = blocksOf(doc).map((b) => b.type);
  assert.deepEqual(kinds, ["p", "image", "p"]);
});

test("a picture with text drawn over it is a background and is left out, and pictures off leaves them all out", () => {
  const items = Array.from({ length: 6 }, (_, i) => T("over the picture", 120, 130 + i * 14));
  const bg = { id: "bg", sig: "bg", x: 72, y: 100, w: 400, h: 200 };
  assert.equal(blocksOf(buildDocument([page(items, { images: [bg] })])).filter((b) => b.type === "image").length, 0);
  const real = { id: "p", sig: "p", x: 72, y: 400, w: 100, h: 80 };
  assert.equal(blocksOf(buildDocument([page(items, { images: [real] })])).filter((b) => b.type === "image").length, 1);
  assert.equal(blocksOf(buildDocument([page(items, { images: [real] })], { images: false })).filter((b) => b.type === "image").length, 0);
});

test("a logo repeated on every page is dropped with the headers", () => {
  const logo = { id: "l", sig: "logo", x: 72, y: 20, w: 80, h: 30 };
  const pages = [1, 2, 3].map((n) => page(paragraph([FULL, "end"], 72, 100), { number: n, images: [{ ...logo }] }));
  assert.equal(blocksOf(buildDocument(pages)).filter((b) => b.type === "image").length, 0);
  assert.equal(blocksOf(buildDocument(pages, { dropRunning: false })).filter((b) => b.type === "image").length, 3);
});

test("margins come from where the text sits, and the PDF's page size is kept", () => {
  const items = paragraph([FULL, FULL, "end"], 72, 90);
  const doc = buildDocument([page(items, { width: 612, height: 792 })]);
  const s = doc.sections[0];
  assert.deepEqual([s.pageW, s.pageH], [612, 792]);
  assert.ok(Math.abs(s.margins.left - 72) < 1);
  assert.ok(s.margins.top >= 72 && s.margins.top <= 90);
  const plain = buildDocument([page(items, { width: 612, height: 792 })], { usePdfPage: false }).sections[0];
  assert.deepEqual([plain.pageW, plain.pageH, plain.margins.left], [595.28, 841.89, 72]);
});

test("pages of different sizes become sections when each page keeps its own page", () => {
  const a = page(paragraph([FULL, "end"], 72, 100), { number: 1 });
  const b = page(paragraph([FULL, "end"], 72, 100), { number: 2, width: 842, height: 595 });
  const doc = buildDocument([a, b], { pageBreaks: true });
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[1].pageW, 842);
  assert.equal(doc.sections.flatMap((s) => s.blocks).length, 2);
});

test("a page with no text at all is counted, not crashed on", () => {
  const doc = buildDocument([page([])]);
  assert.equal(doc.stats.pages, 1);
  assert.equal(blocksOf(doc).length, 0);
});

test("the body style comes from the most common text", () => {
  const items = [T("Big", 72, 80, 20), ...paragraph([FULL, FULL, FULL, "end"], 72, 120, 10, 13)];
  const doc = buildDocument([page(items)]);
  assert.equal(doc.style.bodySize, 10);
  assert.ok(doc.style.headings[1] >= 20);
});

test("a bold numbered heading is a heading, not the start of a list", () => {
  const bold = (s, x, y) => T(s, x, y, 12, { bold: true });
  const items = [bold("1. Introduction", 72, 100), ...paragraph([FULL, FULL, FULL, FULL, FULL, "end"], 72, 125), bold("2. Results", 72, 240), ...paragraph([FULL, FULL, FULL, FULL, FULL, "end"], 72, 265)];
  const blocks = blocksOf(buildDocument([page(items)]));
  assert.ok(blocks[0].heading, "first heading");
  assert.equal(blocks[0].list, undefined);
  assert.equal(blocks[0].runs.map((r) => r.text).join(""), "1. Introduction");
  assert.ok(blocks[2].heading);
});

test("margins are the widest text area seen, so a short page does not make a huge bottom margin", () => {
  const full = page([...paragraph(Array(50).fill(FULL), 72, 100)], { number: 1 });
  const short = page(paragraph([FULL, "end"], 72, 100), { number: 2 });
  const s = buildDocument([short, full, short]).sections[0];
  assert.ok(s.margins.bottom < 80, String(s.margins.bottom)); // the full page decides, not the two short ones
  const justShort = buildDocument([short]).sections[0];
  assert.equal(justShort.margins.bottom, 108); // capped at 1.5 inches
});
