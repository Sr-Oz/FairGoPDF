import test from "node:test";
import assert from "node:assert/strict";
import { detectFormat, FORMATS, fence, tableToMarkdown, sheetsToMarkdown, detectDelimiter, parseDelimited, csvToMarkdown, jsonToMarkdown, xmlToMarkdown, textToMarkdown, pptxToMarkdown, joinSections, countWords } from "../assets/tools/markdown-core.js";

test("every format the page lists is found by its extension, in any letter case", () => {
  for (const f of FORMATS) for (const ext of f.exts) assert.equal(detectFormat(`Report.${ext.toUpperCase()}`), f.kind, ext);
  assert.equal(detectFormat("photo.png"), null);
  assert.equal(detectFormat("README"), null);
  assert.equal(detectFormat("archive.tar.gz"), null);
});

test("a table keeps its header, escapes pipes and line breaks, pads short rows and drops empty edges", () => {
  const md = tableToMarkdown([["Name", "Note", ""], ["A|B", "line one\nline two"], ["", "", ""], []]);
  assert.equal(md, ["| Name | Note |", "| --- | --- |", "| A\\|B | line one<br>line two |"].join("\n"));
  assert.equal(tableToMarkdown([]), "");
  assert.equal(tableToMarkdown([["", ""], ["", ""]]), "");
});

test("a long table is cut at the limit and says so", () => {
  const rows = [["n"], ...Array.from({ length: 10 }, (_, i) => [String(i)])];
  const md = tableToMarkdown(rows, { maxRows: 3 });
  assert.equal(md.split("\n").filter((l) => /^\| \d/.test(l)).length, 3);
  assert.match(md, /Showing the first 3 of 10 rows\./);
});

test("sheets become one section each, and an empty sheet is left out", () => {
  const md = sheetsToMarkdown([{ name: "Sales", rows: [["a"], ["1"]] }, { name: "Blank", rows: [[""]] }]);
  assert.match(md, /^## Sales\n\n\| a \|/);
  assert.doesNotMatch(md, /Blank/);
});

test("CSV: quoted commas, quotes and line breaks, a byte-order mark, and semicolon or tab files", () => {
  assert.deepEqual(parseDelimited('﻿a,b\n"x, y","say ""hi"""\n"two\nlines",z\n'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter('"a;b",c\n1,2'), ",");
  assert.equal(detectDelimiter("single column"), ",");
  assert.equal(csvToMarkdown("a;b\r\n1;2\r\n"), "| a | b |\n| --- | --- |\n| 1 | 2 |");
});

test("JSON is pretty-printed in a fence, and bad JSON is refused", () => {
  assert.equal(jsonToMarkdown('{"a":[1,2]}'), '```json\n{\n  "a": [\n    1,\n    2\n  ]\n}\n```');
  assert.throws(() => jsonToMarkdown("{nope"), /isn't valid JSON/);
});

test("a fence is longer than any run of backticks inside the code", () => {
  assert.equal(fence("a ``` b", "md").split("\n")[0], "````md");
  assert.equal(xmlToMarkdown("<a>\r\n<b/></a>\n"), "```xml\n<a>\n<b/></a>\n```");
});

test("plain text loses trailing spaces and line-ending differences only", () => {
  assert.equal(textToMarkdown("﻿one  \r\n  two\t\r\n"), "one\n  two");
});

// ---------------------------------------------------------------- PowerPoint

const enc = (s) => new TextEncoder().encode(s);
const NS = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
const para = (text, props = "") => `<a:p>${props}<a:r><a:t>${text}</a:t></a:r></a:p>`;
const sp = (ph, body) => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;

function deck() {
  const slide1 = `<p:sld ${NS}><p:cSld><p:spTree>
    ${sp('<p:ph type="ctrTitle"/>', para("Quarterly &amp; review"))}
    ${sp('<p:ph type="subTitle" idx="1"/>', para("Perth office"))}
    ${sp('<p:ph type="sldNum"/>', para("1"))}
  </p:spTree></p:cSld></p:sld>`;
  const slide2 = `<p:sld ${NS}><p:cSld><p:spTree>
    ${sp('<p:ph type="title"/>', para("Plan"))}
    ${sp('<p:ph idx="1"/>', para("First point") + para("Sub point", '<a:pPr lvl="1"/>') + para("Second point"))}
    ${sp("", para("A loose text box"))}
    <p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture" descr="A bar chart"/></p:nvPicPr></p:pic>
    <p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody>${para("Item")}</a:txBody></a:tc><a:tc><a:txBody>${para("Cost")}</a:txBody></a:tc></a:tr>
      <a:tr><a:tc><a:txBody>${para("Desk")}</a:txBody></a:tc><a:tc><a:txBody>${para("$200")}</a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const notes = `<p:notes ${NS}><p:cSld><p:spTree>
    ${sp('<p:ph type="sldImg"/>', "")}
    ${sp('<p:ph type="body" idx="1"/>', para("Say this out loud"))}
  </p:spTree></p:cSld></p:notes>`;
  return {
    // The presentation lists slide2 first, so file-name order and show order disagree on purpose.
    "ppt/presentation.xml": enc(`<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": enc(`<Relationships><Relationship Id="rId3" Type="http://x/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId7" Type="http://x/relationships/slide" Target="slides/slide2.xml"/></Relationships>`),
    "ppt/slides/slide1.xml": enc(slide1),
    "ppt/slides/slide2.xml": enc(slide2),
    "ppt/slides/_rels/slide2.xml.rels": enc(`<Relationships><Relationship Id="rId1" Type="http://x/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`),
    "ppt/notesSlides/notesSlide1.xml": enc(notes),
  };
}

test("PowerPoint: slides come out in the order shown, with titles, bullets, tables, picture text and speaker notes", () => {
  const md = pptxToMarkdown(deck());
  assert.equal(md, [
    "## Plan",
    "- First point\n  - Sub point\n- Second point",
    "A loose text box",
    "*Picture: A bar chart*",
    "| Item | Cost |\n| --- | --- |\n| Desk | $200 |",
    "### Notes\n\nSay this out loud",
    "## Quarterly & review",
    "Perth office",
  ].join("\n\n"));
});

test("PowerPoint: with no order in the file, slides go by file number, and a slide with no title is numbered", () => {
  const files = deck();
  delete files["ppt/presentation.xml"];
  files["ppt/slides/slide10.xml"] = enc(`<p:sld ${NS}><p:cSld><p:spTree>${sp("", para("Last"))}</p:spTree></p:cSld></p:sld>`);
  const md = pptxToMarkdown(files);
  assert.ok(md.indexOf("Quarterly") < md.indexOf("## Plan") && md.indexOf("## Plan") < md.indexOf("## Slide 3"));
  assert.match(md, /## Slide 3\n\nLast$/);
});

test("PowerPoint: a ZIP with no slides is refused", () => {
  assert.throws(() => pptxToMarkdown({ "word/document.xml": enc("<w/>") }), /no slides found/);
});

test("joined files each get a heading, and words are counted", () => {
  assert.equal(joinSections([{ name: "a.csv", markdown: "x" }, { name: "b.txt", markdown: "y" }]), "# a.csv\n\nx\n\n---\n\n# b.txt\n\ny");
  assert.equal(countWords("one two\n\nthree"), 3);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("| Name | Qty |\n| --- | --- |\n| Tea | 2 |"), 4);
});
