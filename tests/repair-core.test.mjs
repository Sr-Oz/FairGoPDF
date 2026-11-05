import test from "node:test";
import assert from "node:assert/strict";
import { sniff, scanObjects, analyse, describe, cutBack, withNewCatalog } from "../assets/tools/repair-core.js";

const bytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const str = (u) => { let s = ""; for (const c of u) s += String.fromCharCode(c); return s; };

// a small valid PDF: a catalog, a page list and `n` pages with a content stream each, a table and a trailer
function makePdf(n = 3) {
  const objs = [];
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Count ${n} /Kids [${kids}] >>`);
  for (let i = 0; i < n; i++) {
    const content = `BT /F1 12 Tf 72 700 Td (Page ${i + 1} text (with brackets)) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return out;
}

test("files that are not PDFs are named by their first bytes", () => {
  assert.equal(sniff(bytes("")).kind, "empty");
  assert.equal(sniff(bytes("<!DOCTYPE html><html><body>Sorry</body></html>")).kind, "web");
  assert.equal(sniff(bytes("PK\x03\x04rest")).kind, "zip");
  assert.equal(sniff(bytes("\xFF\xD8\xFF\xE0jpeg")).kind, "jpeg");
  assert.equal(sniff(bytes("\x89PNG\r\n")).kind, "png");
  assert.equal(sniff(bytes("{\\rtf1 hello")).kind, "rtf");
  assert.equal(sniff(bytes("\x00\x00\x00\x00\x00\x00")).kind, "blank");
  assert.equal(sniff(bytes("just some words")).kind, "other");
  assert.equal(sniff(bytes("%PDF-1.7\n")), null);
  assert.equal(sniff(bytes("junk before\n%PDF-1.4\n")), null);
});

test("every object of a healthy file is found, with its kind", () => {
  const objs = scanObjects(bytes(makePdf(3)));
  assert.equal(objs.length, 8);
  assert.ok(objs.every((o) => o.complete));
  assert.deepEqual(objs.map((o) => o.type).filter(Boolean), ["Catalog", "Pages", "Page", "Page", "Page"]);
  assert.equal(objs.filter((o) => o.stream).length, 3);
});

test("a stream whose length is wrong, and a string with brackets, are still read right", () => {
  const pdf = makePdf(2).replace(/\/Length \d+/, "/Length 5");
  const objs = scanObjects(bytes(pdf));
  assert.equal(objs.length, 6);
  assert.ok(objs.every((o) => o.complete));
});

test("a file cut part-way through an object has that object marked as incomplete", () => {
  const pdf = makePdf(3);
  const cutAt = pdf.indexOf("5 0 obj") + 30; // inside the third page's dictionary
  const objs = scanObjects(bytes(pdf.slice(0, cutAt)));
  assert.equal(objs.filter((o) => o.complete).length, 4);
  assert.equal(objs.at(-1).complete, false);
  assert.equal(objs.at(-1).num, 5);
});

test("a file cut part-way through a stream is also caught", () => {
  const pdf = makePdf(3);
  const cutAt = pdf.indexOf("Page 2 text") + 5;
  const objs = scanObjects(bytes(pdf.slice(0, cutAt)));
  assert.equal(objs.at(-1).complete, false);
  assert.equal(objs.at(-1).stream, true);
});

test("an object with no endobj, followed by another, is read as sloppy but kept", () => {
  const pdf = makePdf(2).replace("endobj\n3 0 obj", "\n3 0 obj");
  const objs = scanObjects(bytes(pdf));
  assert.equal(objs.length, 6);
  assert.ok(objs.every((o) => o.complete));
});

test("a healthy file reports nothing wrong", () => {
  const a = analyse(bytes(makePdf(3)));
  assert.equal(a.isPdf, true);
  assert.equal(a.truncated, false);
  assert.equal(a.startxrefValid, true);
  assert.deepEqual([a.catalogs, a.pageNums.length, a.headerAt, a.hasEof, a.hasTrailer], [[1], 3, 0, true, true]);
  assert.ok(describe(a).every((d) => d.level === "ok" || d.level === "note"));
});

test("a cut-off file is reported as cut off, with how much survives", () => {
  const pdf = makePdf(4);
  const a = analyse(bytes(pdf.slice(0, pdf.indexOf("7 0 obj") + 20)));
  assert.equal(a.truncated, true);
  assert.equal(a.hasEof, false);
  assert.equal(a.pageNums.length, 2);
  const d = describe(a);
  assert.ok(d.some((x) => x.level === "bad" && /cut short/.test(x.text)));
});

test("junk before the header, junk after the end and a wrong table pointer are each found", () => {
  const a = analyse(bytes("JUNK JUNK\n" + makePdf(2) + "X".repeat(200)));
  assert.equal(a.headerAt, 10);
  assert.ok(a.trailing > 64);
  const texts = describe(a).map((d) => d.text).join(" | ");
  assert.match(texts, /10 bytes of junk before/);
  assert.match(texts, /extra bytes after the end/);
  const bad = analyse(bytes(makePdf(2).replace(/startxref\n\d+/, "startxref\n99999")));
  assert.equal(bad.startxrefValid, false);
  assert.match(describe(bad).map((d) => d.text).join(" "), /points to the wrong place/);
});

test("with the trailer cut off the file is said to need one rebuilt", () => {
  const pdf = makePdf(2);
  const a = analyse(bytes(pdf.slice(0, pdf.indexOf("xref")) + "%%EOF\n"));
  assert.equal(a.hasTrailer, false);
  assert.match(describe(a).map((d) => d.text).join(" "), /trailer .* missing/);
});

test("cutting back keeps the file from its header to its last whole object", () => {
  const pdf = makePdf(3);
  const cutAt = pdf.indexOf("7 0 obj") + 25;
  const raw = bytes("GARBAGE\n" + pdf.slice(0, cutAt));
  const a = analyse(raw);
  const body = str(cutBack(raw, a));
  assert.ok(body.startsWith("%PDF-1.4"));
  assert.ok(body.trimEnd().endsWith("endobj"));
  assert.ok(!body.includes("7 0 obj"));
  assert.ok(!body.includes("GARBAGE"));
});

test("a new catalog and page list are built from the pages that survive", () => {
  const pdf = makePdf(4);
  const raw = bytes(pdf.slice(0, pdf.indexOf("9 0 obj") + 12)); // the file ends inside the fourth page's content
  const a = analyse(raw);
  const body = cutBack(raw, a);
  const fixed = withNewCatalog(body, a, a.pageNums.slice(0, 3));
  const b = analyse(fixed);
  assert.equal(b.truncated, false);
  assert.equal(b.startxrefValid, true);
  assert.ok(b.hasTrailer);
  const text = str(fixed);
  assert.match(text, /\/Type \/Pages \/Count 3 \/Kids \[3 0 R 5 0 R 7 0 R\]/);
  assert.match(text, /trailer\n<< \/Size \d+ \/Root \d+ 0 R >>/);
  // the table's offsets point at real objects
  const offsets = [...text.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  for (const at of offsets) assert.match(text.slice(at, at + 12), /^\d+ \d+ obj/);
});
