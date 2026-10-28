import test from "node:test";
import assert from "node:assert/strict";
import * as fflate from "../assets/vendor/fflate.min.js";
import { buildDocx } from "../assets/tools/docx-writer.js";

const style = { bodySize: 11, bodyFamily: "Calibri", lineMultiple: 1.1, headings: { 1: 20, 2: 16, 3: 13, 4: 11 } };
const sec = (blocks, extra = {}) => ({ pageW: 595.28, pageH: 841.89, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks, ...extra });
const run = (text, extra = {}) => ({ text, bold: false, italic: false, size: null, family: null, link: null, ...extra });
const para = (runs, extra = {}) => ({ type: "p", runs, align: "left", left: 0, firstLine: 0, after: 0, ...extra });
const unzip = (bytes) => Object.fromEntries(Object.entries(fflate.unzipSync(bytes)).map(([k, v]) => [k, new TextDecoder().decode(v)]));

// a small well-formedness check: every tag is closed in order, attributes are quoted, nothing stray
function wellFormed(xml) {
  const stack = [];
  const re = /<\?[^>]*\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  for (const m of xml.matchAll(re)) {
    if (/[<>]/.test(xml.slice(last, m.index).replace(/&[a-z]+;/g, ""))) return `stray markup before ${m.index}`;
    last = m.index + m[0].length;
    if (m[2] === undefined) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return `mismatched </${m[2]}>`; }
    else if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? `unclosed <${stack.at(-1)}>` : "ok";
}

test("a plain document has all its parts and every one is well-formed XML", () => {
  const files = unzip(buildDocx({ sections: [sec([para([run("Hello world")])])], style }, { title: "My title", author: "Someone" }));
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml", "docProps/core.xml"]) {
    assert.ok(files[name], `${name} is missing`);
    assert.equal(wellFormed(files[name]), "ok", name);
  }
  assert.ok(files["word/document.xml"].includes("Hello world"));
  assert.ok(files["docProps/core.xml"].includes("<dc:title>My title</dc:title>"));
});

test("headings use heading styles whose sizes come from the document", () => {
  const files = unzip(buildDocx({ sections: [sec([para([run("Big")], { heading: 1 })])], style }));
  assert.ok(files["word/document.xml"].includes('<w:pStyle w:val="Heading1"/>'));
  assert.ok(files["word/styles.xml"].includes('w:styleId="Heading1"'));
  assert.ok(files["word/styles.xml"].includes('<w:sz w:val="40"/>')); // 20pt
  assert.ok(files["word/styles.xml"].includes('w:ascii="Calibri"'));
});

test("bold, italic, size and font only appear on runs that differ", () => {
  const xml = unzip(buildDocx({ sections: [sec([para([run("plain "), run("bold", { bold: true }), run(" mono", { family: "Courier New", size: 9 })])])], style }))["word/document.xml"];
  assert.ok(xml.includes("<w:b/>"));
  assert.ok(xml.includes('w:ascii="Courier New"'));
  assert.ok(xml.includes('<w:sz w:val="18"/>'));
  assert.equal((xml.match(/<w:b\/>/g) || []).length, 1);
});

test("special characters and control codes cannot break the XML", () => {
  const xml = unzip(buildDocx({ sections: [sec([para([run('5 < 6 & "quoted" > 4 \u0000\u0008 ok')])])], style }))["word/document.xml"];
  assert.equal(wellFormed(xml), "ok");
  assert.ok(xml.includes("5 &lt; 6 &amp; &quot;quoted&quot; &gt; 4  ok"));
});

test("tabs become tab elements", () => {
  const xml = unzip(buildDocx({ sections: [sec([para([run("Item\t$5")])])], style }))["word/document.xml"];
  assert.ok(xml.includes("<w:tab/>"));
  assert.equal(wellFormed(xml), "ok");
});

test("links become hyperlinks with an external relationship, reused for the same address", () => {
  const files = unzip(buildDocx({ sections: [sec([para([run("see "), run("here", { link: "https://example.org/?a=1&b=2" }), run(" and "), run("again", { link: "https://example.org/?a=1&b=2" })])])], style }));
  assert.equal((files["word/document.xml"].match(/<w:hyperlink /g) || []).length, 2);
  assert.equal((files["word/_rels/document.xml.rels"].match(/TargetMode="External"/g) || []).length, 1);
  assert.ok(files["word/_rels/document.xml.rels"].includes("a=1&amp;b=2"));
  assert.equal(wellFormed(files["word/document.xml"]), "ok");
  assert.equal(wellFormed(files["word/_rels/document.xml.rels"]), "ok");
});

test("a bullet list and two numbered lists get numbering, the numbered ones restarting where they begin", () => {
  const item = (text, list) => para([run(text)], { list });
  const blocks = [item("a", { id: 1, kind: "bullet", level: 0, start: 0 }), item("b", { id: 1, kind: "bullet", level: 1, start: 0 }), item("one", { id: 2, kind: "decimal", level: 0, start: 1 }), item("five", { id: 3, kind: "decimal", level: 0, start: 5 })];
  const files = unzip(buildDocx({ sections: [sec(blocks)], style }));
  const num = files["word/numbering.xml"];
  assert.equal(wellFormed(num), "ok");
  assert.equal((num.match(/<w:num /g) || []).length, 3);
  assert.ok(num.includes('<w:startOverride w:val="5"/>'));
  const doc = files["word/document.xml"];
  assert.equal((doc.match(/<w:numId w:val="1"\/>/g) || []).length, 2); // both bullets share one list
  assert.ok(doc.includes('<w:ilvl w:val="1"/>'));
});

test("alignment, indents and page breaks", () => {
  const xml = unzip(buildDocx({ sections: [sec([para([run("c")], { align: "center" }), para([run("i")], { left: 36, firstLine: 18 }), para([run("h")], { left: 36, firstLine: -18 }), para([run("n")], { pageBreakBefore: true })])], style }))["word/document.xml"];
  assert.ok(xml.includes('<w:jc w:val="center"/>'));
  assert.ok(xml.includes('<w:ind w:left="720" w:firstLine="360"/>'));
  assert.ok(xml.includes('<w:ind w:left="720" w:hanging="360"/>'));
  assert.ok(xml.includes("<w:pageBreakBefore/>"));
});

test("pPr children keep the order Word expects", () => {
  const xml = unzip(buildDocx({ sections: [sec([para([run("x")], { heading: 2, pageBreakBefore: true, list: { id: 1, kind: "decimal", level: 0, start: 1 }, after: 6, align: "center" })])], style }))["word/document.xml"];
  const order = ["<w:pStyle", "<w:pageBreakBefore", "<w:numPr", "<w:spacing", "<w:jc"].map((t) => xml.indexOf(t));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), order.join(","));
});

test("a picture is stored once, linked, sized in points and scaled down to the text width", () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const images = new Map([["img", { bytes, ext: "png", pxW: 10, pxH: 10 }]]);
  const block = { type: "image", id: "img", w: 1000, h: 500, align: "center" };
  const files = fflate.unzipSync(buildDocx({ sections: [sec([block, block])], style }, { images }));
  assert.deepEqual(Object.keys(files).filter((n) => n.startsWith("word/media/")), ["word/media/image1.png"]);
  const doc = new TextDecoder().decode(files["word/document.xml"]);
  const textWidth = 595.28 - 144;
  assert.ok(doc.includes(`cx="${Math.round(textWidth * 12700)}"`));
  assert.ok(doc.includes(`cy="${Math.round(textWidth * 0.5 * 12700)}"`));
  assert.equal((doc.match(/<wp:inline /g) || []).length, 2);
  assert.ok(new TextDecoder().decode(files["[Content_Types].xml"]).includes('Extension="png"'));
  assert.equal(wellFormed(doc), "ok");
});

test("a picture with no file behind it is skipped, not written as a broken link", () => {
  const xml = unzip(buildDocx({ sections: [sec([{ type: "image", id: "gone", w: 10, h: 10 }, para([run("after")])])], style }))["word/document.xml"];
  assert.ok(!xml.includes("<w:drawing>"));
  assert.ok(xml.includes("after"));
});

test("landscape and the margins are written, and sections are separated", () => {
  const sections = [sec([para([run("one")])]), sec([para([run("two")])], { pageW: 842, pageH: 595, margins: { top: 40, right: 50, bottom: 40, left: 50 } })];
  const xml = unzip(buildDocx({ sections, style }))["word/document.xml"];
  assert.equal((xml.match(/<w:sectPr>/g) || []).length, 2);
  assert.ok(xml.includes('w:orient="landscape"'));
  assert.ok(xml.includes('w:left="1000"'));
  assert.equal(wellFormed(xml), "ok");
});

test("the language is set when asked, and left out otherwise", () => {
  const withLang = unzip(buildDocx({ sections: [sec([])], style }, { language: "en-AU" }))["word/styles.xml"];
  assert.ok(withLang.includes('<w:lang w:val="en-AU"'));
  const none = unzip(buildDocx({ sections: [sec([])], style }))["word/styles.xml"];
  assert.ok(!none.includes("<w:lang"));
});

test("an empty document is still a valid one", () => {
  const files = unzip(buildDocx({ sections: [sec([])], style }));
  assert.equal(wellFormed(files["word/document.xml"]), "ok");
  assert.ok(files["word/document.xml"].includes("<w:p/>"));
});
