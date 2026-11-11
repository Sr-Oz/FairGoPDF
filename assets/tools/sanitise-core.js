// Sanitise PDF: what to look for in a PDF and what to take out, kept apart from the page so it can be tested. No DOM in here,
// and the PDF library is passed in (anything with pdf-lib's PDFName, PDFDict, PDFArray, PDFRef and PDFStream).
//
// Taking a reference out of a PDF does not take the object out of the file: pdf-lib saves every object it holds, referenced or not.
// So after anything is removed, sanitise() also deletes every object nothing points to any more, or the "removed" script, attachment
// or metadata would still be sitting in the saved file, just unlisted.
//
// Load the file with { updateMetadata: false }, or pdf-lib stamps its own Producer, Creator and dates in before this ever sees it.

const ACTIONS_TO_DROP = new Set(["/JavaScript", "/Launch"]);
const PER_OBJECT_METADATA = ["Metadata", "PieceInfo"]; // XMP and an application's private data; the catalog and each page can carry them

function tools(doc, lib) {
  const N = (s) => lib.PDFName.of(s);
  const follow = (x) => (x ? doc.context.lookup(x) : undefined);
  const dictOf = (x) => { const o = follow(x); return o instanceof lib.PDFDict ? o : undefined; };
  const arrayOf = (x) => { const o = follow(x); return o instanceof lib.PDFArray ? o : undefined; };
  const nameOf = (x) => { const o = follow(x); return o ? o.toString() : ""; };
  return { N, follow, dictOf, arrayOf, nameOf };
}

// Every annotation on every page, with the array it sits in (so it can be taken out of it).
function* annotations(doc, lib, t) {
  for (const page of doc.getPages()) {
    const annots = t.arrayOf(page.node.get(t.N("Annots")));
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = t.dictOf(annots.get(i));
      if (annot) yield { annot, annots, index: i };
    }
  }
}

// Form fields and their kids. A field can carry scripts of its own, apart from its widget on the page.
function* fields(doc, lib, t) {
  const seen = new Set();
  const stack = [];
  const form = t.dictOf(doc.catalog.get(t.N("AcroForm")));
  const roots = form && t.arrayOf(form.get(t.N("Fields")));
  if (roots) roots.asArray().forEach((r) => stack.push(r));
  while (stack.length) {
    const ref = stack.pop();
    const field = t.dictOf(ref);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    yield field;
    const kids = t.arrayOf(field.get(t.N("Kids")));
    if (kids) kids.asArray().forEach((k) => stack.push(k));
  }
}

// Scripts, auto-actions and launch actions. Counts what it finds, and takes it out when remove is true.
function walkScripts(doc, lib, remove) {
  const t = tools(doc, lib);
  let count = 0;
  const drop = (dict, key) => {
    if (dict.has(t.N(key))) { count++; if (remove) dict.delete(t.N(key)); }
  };
  const dropAction = (dict) => {
    const action = t.dictOf(dict.get(t.N("A")));
    if (action && ACTIONS_TO_DROP.has(t.nameOf(action.get(t.N("S"))))) { count++; if (remove) dict.delete(t.N("A")); }
  };

  drop(doc.catalog, "OpenAction");
  drop(doc.catalog, "AA");
  const names = t.dictOf(doc.catalog.get(t.N("Names")));
  if (names) drop(names, "JavaScript");
  for (const page of doc.getPages()) drop(page.node, "AA");
  for (const { annot } of annotations(doc, lib, t)) { drop(annot, "AA"); dropAction(annot); }
  for (const field of fields(doc, lib, t)) { drop(field, "AA"); dropAction(field); }
  return count;
}

// Files carried inside the PDF: the document's attachment list, and attachment annotations (the paperclip kind).
function walkFiles(doc, lib, remove) {
  const t = tools(doc, lib);
  let count = 0;
  const names = t.dictOf(doc.catalog.get(t.N("Names")));
  if (names && names.has(t.N("EmbeddedFiles"))) { count++; if (remove) names.delete(t.N("EmbeddedFiles")); }
  for (const { annot, annots, index } of annotations(doc, lib, t)) {
    if (t.nameOf(annot.get(t.N("Subtype"))) === "/FileAttachment") { count++; if (remove) annots.remove(index); }
  }
  return count;
}

// Metadata: the Info dictionary (title, author, dates and any custom entry such as a company name), and XMP and private
// application data on the catalog and on each page.
function metadataHolders(doc) {
  return [doc.catalog, ...doc.getPages().map((p) => p.node)].filter(Boolean);
}

function hasMetadata(doc, lib) {
  const t = tools(doc, lib);
  const info = t.dictOf(doc.context.trailerInfo.Info);
  if (info && info.keys().length > 0) return true;
  return metadataHolders(doc).some((h) => PER_OBJECT_METADATA.some((k) => h.has(t.N(k))));
}

function stripMetadata(doc, lib) {
  const t = tools(doc, lib);
  doc.context.trailerInfo.Info = undefined;
  for (const holder of metadataHolders(doc)) PER_OBJECT_METADATA.forEach((k) => holder.delete(t.N(k)));
}

// Deletes every object that cannot be reached from the document's root (or its Info or Encrypt entries).
function dropUnreachable(doc, lib) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const trailer = doc.context.trailerInfo;
  if (!(trailer.Root instanceof PDFRef)) return; // an odd file: leave it alone rather than guess
  const seen = new Set();
  const stack = [trailer.Root, trailer.Info, trailer.Encrypt].filter((r) => r instanceof PDFRef);
  const visit = (obj) => {
    if (obj instanceof PDFRef) stack.push(obj);
    else if (obj instanceof PDFStream) visit(obj.dict);
    else if (obj instanceof PDFDict) obj.values().forEach(visit);
    else if (obj instanceof PDFArray) obj.asArray().forEach(visit);
  };
  while (stack.length) {
    const ref = stack.pop();
    const key = ref.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    visit(doc.context.lookup(ref));
  }
  const orphans = [];
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!seen.has(ref.toString())) orphans.push(ref);
  orphans.forEach((ref) => doc.context.delete(ref));
}

// What is in the file, without changing it: { scripts, files, metadata }, the first two as counts and the last a yes or no.
export function inspect(doc, lib) {
  return { scripts: walkScripts(doc, lib, false), files: walkFiles(doc, lib, false), metadata: hasMetadata(doc, lib) };
}

// Takes out what was asked for and returns what was there: { scripts, files, metadata }, counted as in inspect().
export function sanitise(doc, lib, { scripts = false, files = false, metadata = false } = {}) {
  const removed = { scripts: 0, files: 0, metadata: false };
  if (scripts) removed.scripts = walkScripts(doc, lib, true);
  if (files) removed.files = walkFiles(doc, lib, true);
  if (metadata) { removed.metadata = hasMetadata(doc, lib); stripMetadata(doc, lib); }
  if (removed.scripts || removed.files || removed.metadata) dropUnreachable(doc, lib);
  return removed;
}
