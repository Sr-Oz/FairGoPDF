import test from "node:test";
import assert from "node:assert/strict";
import * as Std from "../assets/vendor/pdf-lib.esm.min.js";
import * as Cantoo from "../assets/vendor/cantoo-pdf-lib.esm.min.js";
import { inspect, sanitise } from "../assets/tools/sanitise-core.js";

// Every marker below is plain text inside the saved file, so "still in the file" can be checked by searching its bytes.
const MARKERS = {
  info: "Acme Legal", // a custom Info entry
  creation: "CreationDate",
  xmp: "XMP-SECRET",
  pageXmp: "PAGE-XMP-SECRET",
  attachment: "SECRET-ATTACHMENT-BYTES",
  paperclip: "PAPERCLIP-BYTES",
  launch: "LAUNCH-TARGET",
  annotJs: "ANNOT-JS",
  fieldJs: "FIELD-JS",
  openJs: "OPEN-JS",
  namesJs: "NAMES-JS",
  pageJs: "PAGE-JS",
};

async function dirtyPdf(lib) {
  const { PDFDocument, PDFName, PDFString } = lib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;
  const str = (s) => PDFString.of(s);
  const js = (s) => ctx.obj({ S: "JavaScript", JS: str(s) });

  doc.setTitle("Quarterly report");
  doc.setCreationDate(new Date("2020-01-02"));
  ctx.lookup(ctx.trailerInfo.Info).set(PDFName.of("Company"), str(MARKERS.info));

  const stream = (text, dict = {}) => ctx.register(ctx.stream(text, dict));
  doc.catalog.set(PDFName.of("Metadata"), stream(`<x:xmpmeta>${MARKERS.xmp}</x:xmpmeta>`, { Type: "Metadata", Subtype: "XML" }));
  page.node.set(PDFName.of("Metadata"), stream(`<x:xmpmeta>${MARKERS.pageXmp}</x:xmpmeta>`, { Type: "Metadata", Subtype: "XML" }));

  const filespec = (name, bytes) => ctx.register(ctx.obj({ Type: "Filespec", F: str(name), EF: { F: stream(bytes, { Type: "EmbeddedFile" }) } }));
  doc.catalog.set(PDFName.of("OpenAction"), js(MARKERS.openJs));
  doc.catalog.set(PDFName.of("Names"), ctx.obj({
    EmbeddedFiles: { Names: [str("secret.txt"), filespec("secret.txt", MARKERS.attachment)] },
    JavaScript: { Names: [str("boot"), ctx.register(js(MARKERS.namesJs))] },
  }));
  page.node.set(PDFName.of("AA"), ctx.obj({ O: js(MARKERS.pageJs) }));

  const rect = [10, 10, 40, 40];
  const widget = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Tx", T: str("f"), Rect: rect, AA: { K: js(MARKERS.fieldJs) } }));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [widget] }));
  page.node.set(PDFName.of("Annots"), ctx.obj([
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: rect, A: { S: "Launch", F: str(MARKERS.launch) } })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: rect, A: js(MARKERS.annotJs) })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: rect, A: { S: "URI", URI: str("https://example.com/kept") } })),
    ctx.register(ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: rect, FS: filespec("clip.txt", MARKERS.paperclip) })),
    widget,
  ]));
  return doc.save({ useObjectStreams: false });
}

const text = (bytes) => Buffer.from(bytes).toString("latin1");
const reload = (lib, bytes) => lib.PDFDocument.load(bytes, { updateMetadata: false });
const present = (bytes) => Object.entries(MARKERS).filter(([, m]) => text(bytes).includes(m)).map(([k]) => k);

for (const [label, lib] of [["pdf-lib", Std], ["pdf-lib with encryption", Cantoo]]) {
  test(`${label}: the test file really holds every marker, so the checks below mean something`, async () => {
    const bytes = await dirtyPdf(lib);
    assert.deepEqual(present(bytes), Object.keys(MARKERS));
    const found = inspect(await reload(lib, bytes), lib);
    assert.ok(found.scripts >= 6 && found.files === 2 && found.metadata === true, JSON.stringify(found));
  });

  test(`${label}: everything is gone from the saved file, and the file still opens`, async () => {
    const doc = await reload(lib, await dirtyPdf(lib));
    const removed = sanitise(doc, lib, { scripts: true, files: true, metadata: true });
    assert.ok(removed.scripts >= 6 && removed.files === 2 && removed.metadata === true);
    const out = await doc.save({ useObjectStreams: false });
    assert.deepEqual(present(out), [], "markers left in the file");
    for (const word of ["/FileAttachment", "/Launch", "/JavaScript", "/AA", "/OpenAction", "/EmbeddedFiles", "/Metadata", "/Info"]) {
      assert.ok(!text(out).includes(word), `${word} left in the file`);
    }
    const again = await reload(lib, out);
    assert.equal(again.getPageCount(), 1);
    assert.deepEqual(inspect(again, lib), { scripts: 0, files: 0, metadata: false });
    assert.ok(text(out).includes("https://example.com/kept"), "an ordinary web link must stay");
  });
}

test("only what was ticked is removed", async () => {
  const bytes = await dirtyPdf(Std);
  const scriptsOnly = await reload(Std, bytes);
  sanitise(scriptsOnly, Std, { scripts: true });
  const out = text(await scriptsOnly.save({ useObjectStreams: false }));
  for (const k of ["launch", "annotJs", "fieldJs", "openJs", "namesJs", "pageJs"]) assert.ok(!out.includes(MARKERS[k]), `${k} should be gone`);
  for (const k of ["attachment", "paperclip", "info", "xmp", "pageXmp"]) assert.ok(out.includes(MARKERS[k]), `${k} should stay`);

  const metadataOnly = await reload(Std, bytes);
  sanitise(metadataOnly, Std, { metadata: true });
  const out2 = text(await metadataOnly.save({ useObjectStreams: false }));
  for (const k of ["info", "creation", "xmp", "pageXmp"]) assert.ok(!out2.includes(MARKERS[k]), `${k} should be gone`);
  for (const k of ["attachment", "paperclip", "launch", "openJs"]) assert.ok(out2.includes(MARKERS[k]), `${k} should stay`);
});

test("a clean file is left as it is and nothing is reported", async () => {
  const doc = await Std.PDFDocument.create({ updateMetadata: false }); // pdf-lib would otherwise stamp its own Producer and dates
  doc.addPage([200, 200]);
  const clean = await reload(Std, await doc.save());
  assert.deepEqual(inspect(clean, Std), { scripts: 0, files: 0, metadata: false });
  assert.deepEqual(sanitise(clean, Std, { scripts: true, files: true, metadata: true }), { scripts: 0, files: 0, metadata: false });
  assert.equal((await reload(Std, await clean.save())).getPageCount(), 1);
});

test("a form field that lists itself as its own kid does not hang it", async () => {
  const doc = await Std.PDFDocument.create({ updateMetadata: false }); // pdf-lib would otherwise stamp its own Producer and dates
  doc.addPage();
  const ctx = doc.context;
  const field = ctx.nextRef();
  ctx.assign(field, ctx.obj({ FT: "Tx", T: Std.PDFString.of("loop"), Kids: [field] }));
  doc.catalog.set(Std.PDFName.of("AcroForm"), ctx.obj({ Fields: [field] }));
  const back = await reload(Std, await doc.save());
  assert.deepEqual(inspect(back, Std), { scripts: 0, files: 0, metadata: false });
});
