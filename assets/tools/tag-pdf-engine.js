// Tag PDF engine: reads an untagged PDF, works out headings, paragraphs, lists,
// figures and links from where the text sits, then rewrites each page's content
// stream with marked content and writes the structure tree, bookmarks and metadata.
// Everything runs in the browser. pdf.js supplies text geometry; pdf-lib writes.
import { PDFLib, pdfjsLib } from "/assets/tools/pdf-common.js";

const {
  PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream,
} = PDFLib;

export class TagError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------- 1. Content stream tokenizer (operators with raw byte ranges) ---------- */

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isReg = (c) => !WS.has(c) && !DELIM.has(c);

export function tokenize(bytes) {
  const ops = [];
  const n = bytes.length;
  let i = 0;
  let operands = [];
  let opStart = 0;

  const skipWs = () => {
    while (i < n) {
      if (WS.has(bytes[i])) i++;
      else if (bytes[i] === 0x25) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; }
      else break;
    }
  };

  const readString = () => {
    let depth = 0;
    const start = i;
    while (i < n) {
      const c = bytes[i++];
      if (c === 0x5c) i++;
      else if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) break;
    }
    return { t: "str", s: start, e: i };
  };

  const readValue = () => {
    const c = bytes[i];
    const s = i;
    if (c === 0x28) return readString();
    if (c === 0x2f) { i++; while (i < n && isReg(bytes[i])) i++; return { t: "name", s, e: i }; }
    if (c === 0x5b) {
      i++;
      const items = [];
      for (;;) {
        skipWs();
        if (i >= n || bytes[i] === 0x5d) { i++; break; }
        items.push(readValue());
      }
      return { t: "arr", s, e: i, items };
    }
    if (c === 0x3c && bytes[i + 1] === 0x3c) {
      i += 2;
      let depth = 1;
      while (i < n && depth) {
        if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) { depth++; i += 2; }
        else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { depth--; i += 2; }
        else if (bytes[i] === 0x28) readString();
        else i++;
      }
      return { t: "dict", s, e: i };
    }
    if (c === 0x3c) { i++; while (i < n && bytes[i] !== 0x3e) i++; i++; return { t: "hex", s, e: i }; }
    while (i < n && isReg(bytes[i])) i++;
    if (i === s) i++;
    return { t: "tok", s, e: i };
  };

  for (;;) {
    skipWs();
    if (i >= n) break;
    if (!operands.length) opStart = i;
    const v = readValue();
    const text = v.t === "tok" ? String.fromCharCode(...bytes.subarray(v.s, v.e)) : null;
    const isNumber = text !== null && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text);
    if (v.t === "tok" && !isNumber && text !== "true" && text !== "false" && text !== "null") {
      let end = v.e;
      if (text === "BI") {
        let j = v.e;
        while (j < n && !(WS.has(bytes[j - 1]) && bytes[j] === 0x49 && bytes[j + 1] === 0x44 && WS.has(bytes[j + 2]))) j++;
        j += 3;
        while (j < n && !(WS.has(bytes[j - 1]) && bytes[j] === 0x45 && bytes[j + 1] === 0x49 && (j + 2 >= n || WS.has(bytes[j + 2])))) j++;
        end = Math.min(n, j + 2);
        i = end;
      }
      ops.push({ op: text, args: operands, s: opStart, e: end });
      operands = [];
    } else {
      operands.push({ ...v, text });
    }
  }
  return ops;
}

/* ---------- 2. Page content and resources ---------- */

function decodeStreams(doc, obj) {
  const ctx = doc.context;
  const parts = [];
  const add = (o) => {
    const s = ctx.lookup(o);
    if (s instanceof PDFArray) { for (let k = 0; k < s.size(); k++) add(s.get(k)); return; }
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else if (s && typeof s.getUnencodedContents === "function") parts.push(s.getUnencodedContents());
  };
  add(obj);
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length + 1, 0));
  let p = 0;
  for (const s of parts) { out.set(s, p); p += s.length; out[p++] = 10; }
  return out;
}

const pageContentBytes = (doc, page) => decodeStreams(doc, page.node.Contents());

function xobjectDict(doc, page) {
  const res = page.node.Resources();
  return res ? doc.context.lookupMaybe(res.get(PDFName.of("XObject")), PDFDict) : null;
}

function imageXObjectNames(doc, page) {
  const names = new Set();
  const xo = xobjectDict(doc, page);
  if (!xo) return names;
  for (const [k, v] of xo.entries()) {
    const obj = doc.context.lookup(v);
    const sub = obj && obj.dict && obj.dict.get(PDFName.of("Subtype"));
    if (sub && sub.toString() === "/Image") names.add(k.toString());
  }
  return names;
}

/* ---------- 3. Text positions of each show operator ---------- */

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const num = (bytes, a) => parseFloat(String.fromCharCode(...bytes.subarray(a.s, a.e)));
const SHOW = new Set(["Tj", "TJ", "'", '"']);
const PATH_BUILD = new Set(["m", "l", "c", "v", "y", "h", "re"]);
const PATH_PAINT = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
const PAINTING = new Set([...PATH_PAINT, "Do", "sh", "BI"]);
const STATE_OPS = new Set(["cm", "gs", "rg", "RG", "g", "G", "k", "K", "w", "J", "j", "M", "d", "ri", "i", "cs", "CS", "sc", "scn", "SC", "SCN"]);

function annotateOps(bytes, ops) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = tm;
  let leading = 0;
  let rise = 0;
  let repositioned = true;
  for (const o of ops) {
    const a = o.args;
    switch (o.op) {
      case "q": stack.push(ctm.slice()); break;
      case "Q": if (stack.length) ctm = stack.pop(); break;
      case "cm": ctm = mul(a.map((x) => num(bytes, x)), ctm); break;
      case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm; repositioned = true; break;
      case "Tm": tm = a.map((x) => num(bytes, x)); tlm = tm; repositioned = true; break;
      case "Td": case "TD": {
        const tx = num(bytes, a[0]);
        const ty = num(bytes, a[1]);
        if (o.op === "TD") leading = -ty;
        tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; repositioned = true;
        break;
      }
      case "TL": leading = num(bytes, a[0]); break;
      case "Ts": rise = num(bytes, a[0]); break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; repositioned = true; break;
      default: break;
    }
    if (o.op === "'" || o.op === '"') { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; repositioned = true; }
    if (o.op === "Do") o.place = { x: ctm[4], y: ctm[5], w: Math.hypot(ctm[0], ctm[1]), h: Math.hypot(ctm[2], ctm[3]), m: ctm.slice() };
    if (SHOW.has(o.op)) {
      const m = mul(tm, ctm);
      o.show = { x: m[4] + m[2] * rise, y: m[5] + m[3] * rise, fresh: repositioned };
      repositioned = false;
    }
  }
}

// Balanced q..Q groups and BT..ET objects, so a unit that belongs to one block
// can sit inside a single marked-content sequence.
function splitUnits(ops) {
  const units = [];
  let i = 0;
  while (i < ops.length) {
    const o = ops[i];
    if (o.op === "q") {
      let depth = 0;
      let j = i;
      for (; j < ops.length; j++) {
        if (ops[j].op === "q") depth++;
        else if (ops[j].op === "Q" && --depth === 0) break;
      }
      if (j < ops.length) { units.push({ group: ops.slice(i, j + 1) }); i = j + 1; continue; }
    }
    if (o.op === "BT") {
      let j = i;
      while (j < ops.length && ops[j].op !== "ET") j++;
      if (j < ops.length) { units.push({ group: ops.slice(i, j + 1) }); i = j + 1; continue; }
    }
    units.push({ op: o });
    i++;
  }
  return units;
}

/* ---------- 4. Layout analysis from pdf.js text items ---------- */

const BULLET = /^\s*([•●◦▪–—*\-·]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;
const PAGE_NUMBER = /^\s*(page\s*)?\d+(\s*(of|\/)\s*\d+)?\s*$/i;

async function extractLines(pdfPage) {
  const tc = await pdfPage.getTextContent();
  await pdfPage.getOperatorList().catch(() => {});
  const isBold = (fontName) => {
    try {
      const f = pdfPage.commonObjs.has(fontName) ? pdfPage.commonObjs.get(fontName) : null;
      const nm = (f && (f.name || f.fallbackName)) || "";
      return !!(f && (f.bold || f.black)) || /bold|black|heavy|semibold/i.test(nm);
    } catch (e) { return false; }
  };
  const items = tc.items
    .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
    .map((it, idx) => ({
      idx, str: it.str, x: it.transform[4], y: it.transform[5], w: it.width,
      size: Math.hypot(it.transform[2], it.transform[3]), bold: isBold(it.fontName),
    }));

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const ln = lines.find((l) => Math.abs(l.y - it.y) < Math.max(1.5, 0.35 * it.size));
    if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x0 = l.items[0].x;
    l.x1 = Math.max(...l.items.map((i) => i.x + i.w));
    l.text = l.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    const chars = {};
    l.items.forEach((i) => { chars[i.size.toFixed(1)] = (chars[i.size.toFixed(1)] || 0) + i.str.length; });
    l.size = parseFloat(Object.entries(chars).sort((a, b) => b[1] - a[1])[0][0]);
    l.bold = l.items.filter((i) => i.bold).reduce((a, i) => a + i.str.length, 0) > l.text.length / 2;
    let wide = 0;
    for (let k = 1; k < l.items.length; k++) {
      const gap = l.items[k].x - (l.items[k - 1].x + l.items[k - 1].w);
      if (gap > 3 * l.size && l.items[k].str.trim().length > 2 && l.items[k - 1].str.trim().length > 2) wide++;
    }
    l.wideGaps = wide;
  }
  lines.sort((a, b) => b.y - a.y);
  return { lines, items };
}

function bodySizeOf(lines) {
  const weight = {};
  lines.forEach((l) => { weight[l.size.toFixed(1)] = (weight[l.size.toFixed(1)] || 0) + l.text.length; });
  return parseFloat(Object.entries(weight).sort((a, b) => b[1] - a[1])[0]?.[0] || "11");
}

const repeatKey = (text) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const inMargin = (l, pageHeight) => l.y / pageHeight < 0.08 || 1 - l.y / pageHeight < 0.08;

function repeatedMarginText(extracted, heights) {
  const pagesWith = new Map();
  extracted.forEach((e, p) => {
    const seen = new Set();
    e.lines.forEach((l) => { if (inMargin(l, heights[p]) && l.text.length < 120) seen.add(repeatKey(l.text)); });
    seen.forEach((k) => pagesWith.set(k, (pagesWith.get(k) || 0) + 1));
  });
  const minPages = Math.max(3, Math.ceil(0.4 * extracted.length));
  const keys = new Set();
  if (extracted.length >= 4) pagesWith.forEach((count, k) => { if (count >= minPages) keys.add(k); });
  return keys;
}

function buildBlocks({ lines, items }, body, pageHeight, repeated) {
  for (const l of lines) {
    if (inMargin(l, pageHeight) && (PAGE_NUMBER.test(l.text) || repeated.has(repeatKey(l.text)))) l.kind = "artifact";
    else if ((l.size >= body * 1.2 && l.text.length <= 140) || (l.bold && l.size >= body && l.text.length < 90)) l.kind = "heading";
    else if (BULLET.test(l.text)) l.kind = "li";
    else l.kind = "text";
  }

  const blocks = [];
  let cur = null;
  for (const l of lines) {
    const prev = cur && cur.lines[cur.lines.length - 1];
    const gap = prev ? prev.y - l.y : 0;
    const close = prev && gap <= 1.9 * Math.max(l.size, prev.size);
    const startNew = !cur
      || l.kind === "li" || l.kind === "artifact"
      || cur.kind !== l.kind || !close
      || (l.kind === "text" && Math.abs(l.size - prev.size) > 0.6)
      || (l.kind === "heading" && Math.abs(l.size - prev.size) > 0.6);
    if (startNew) {
      cur = { kind: l.kind, lines: [l], size: l.size };
      blocks.push(cur);
    } else cur.lines.push(l);
  }

  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (b.kind === "text" && last && last.kind === "li" && b.lines[0].x0 > last.lines[0].x0 + 0.5 * last.size
      && last.lines[last.lines.length - 1].y - b.lines[0].y <= 1.9 * b.size) {
      last.lines.push(...b.lines);
    } else merged.push(b);
  }
  merged.forEach((b) => {
    if (b.kind === "heading" && (b.lines.length > 3 || b.lines.map((l) => l.text).join(" ").length > 220)) b.kind = "text";
  });

  const out = [];
  for (const b of merged) {
    if (b.kind === "li") {
      const last = out[out.length - 1];
      if (last && last.kind === "list") last.items.push(b); else out.push({ kind: "list", items: [b] });
    } else out.push(b);
  }
  out.forEach((b) => { b.autoKind = b.kind; });
  return { blocks: out, items };
}

const blockText = (b) => b.lines.map((l) => l.text).join(" ");

/* ---------- 5. Analysis (what the review screen shows) ---------- */

const rectOf = (doc, annot) => {
  const r = annot.get(PDFName.of("Rect"));
  const arr = r && doc.context.lookup(r);
  if (!(arr instanceof PDFArray) || arr.size() < 4) return null;
  const v = Array.from({ length: 4 }, (_, i) => doc.context.lookup(arr.get(i)).asNumber());
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
};

function unembeddedFontCount(doc) {
  const seen = new Set();
  let missing = 0;
  const ctx = doc.context;
  for (const page of doc.getPages()) {
    const res = page.node.Resources();
    const fonts = res && ctx.lookupMaybe(res.get(PDFName.of("Font")), PDFDict);
    if (!fonts) continue;
    for (const [, ref] of fonts.entries()) {
      const key = ref.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      let f = ctx.lookupMaybe(ref, PDFDict);
      if (!f) continue;
      const sub = f.get(PDFName.of("Subtype"));
      if (sub && sub.toString() === "/Type3") continue;
      if (sub && sub.toString() === "/Type0") {
        const desc = ctx.lookupMaybe(f.get(PDFName.of("DescendantFonts")), PDFArray);
        f = desc && ctx.lookupMaybe(desc.get(0), PDFDict);
        if (!f) continue;
      }
      const d = ctx.lookupMaybe(f.get(PDFName.of("FontDescriptor")), PDFDict);
      const embedded = d && (d.has(PDFName.of("FontFile")) || d.has(PDFName.of("FontFile2")) || d.has(PDFName.of("FontFile3")));
      if (!embedded) missing++;
    }
  }
  return missing;
}

export async function analysePdf(inputBytes, { onProgress } = {}) {
  let doc;
  try {
    doc = await PDFDocument.load(inputBytes.slice());
  } catch (err) {
    if (/encrypt/i.test(err.message || "")) throw new TagError("encrypted", "This PDF is password protected.");
    throw new TagError("unreadable", err.message || "This file couldn't be read as a PDF.");
  }
  if (doc.catalog.has(PDFName.of("StructTreeRoot"))) {
    throw new TagError("tagged", "This PDF already has tags.");
  }

  const pdfjsDoc = await pdfjsLib.getDocument({ data: inputBytes.slice() }).promise;
  const pages = doc.getPages();
  const heights = pages.map((p) => p.getSize().height);

  const extracted = [];
  for (let p = 0; p < pages.length; p++) {
    if (onProgress) onProgress({ phase: "Reading text", done: p, total: pages.length });
    extracted.push(await extractLines(await pdfjsDoc.getPage(p + 1)));
    if (p % 5 === 4) await tick();
  }

  const allLines = extracted.flatMap((e) => e.lines);
  const chars = allLines.reduce((a, l) => a + l.text.length, 0);
  if (chars < 15 * Math.max(1, pages.length * 0.5)) {
    throw new TagError("no-text", "No selectable text found.");
  }

  const docBody = bodySizeOf(allLines);
  const repeated = repeatedMarginText(extracted, heights);
  const layouts = extracted.map((e, p) => buildBlocks(e, docBody, heights[p], repeated));

  const rawLevel = (size) => { const r = size / docBody; return r >= 2.4 ? 1 : r >= 1.8 ? 2 : r >= 1.45 ? 3 : r >= 1.2 ? 4 : 5; };
  const used = [...new Set(layouts.flatMap((l) => l.blocks.filter((b) => b.kind === "heading").map((b) => rawLevel(b.size))))].sort((a, b) => a - b);

  const headings = [];
  layouts.forEach((l, p) => l.blocks.forEach((b, bi) => {
    b.id = `${p}:${bi}`;
    if (b.kind === "heading") {
      b.autoLevel = Math.min(6, used.indexOf(rawLevel(b.size)) + 1);
      headings.push({ id: b.id, page: p + 1, text: blockText(b), level: b.autoLevel, size: b.size });
    }
  }));

  const images = [];
  const links = [];
  let otherAnnots = 0;
  let autoDecorative = 0;
  for (let p = 0; p < pages.length; p++) {
    if (onProgress) onProgress({ phase: "Finding images and links", done: p, total: pages.length });
    const page = pages[p];
    const bytes = pageContentBytes(doc, page);
    const ops = tokenize(bytes);
    annotateOps(bytes, ops);
    const names = imageXObjectNames(doc, page);
    const area = page.getWidth() * page.getHeight();
    ops.forEach((o, oi) => {
      if (o.op !== "Do" || !o.args[0] || !names.has(String.fromCharCode(...bytes.subarray(o.args[0].s, o.args[0].e)))) return;
      const a = o.place.w * o.place.h;
      if (a > 0.6 * area || a < 0.002 * area) { autoDecorative++; return; }
      const m = o.place.m;
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
      const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      images.push({ id: `${p}:${oi}`, page: p + 1, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    });
    const annots = page.node.get(PDFName.of("Annots"));
    const arr = annots && doc.context.lookupMaybe(annots, PDFArray);
    for (let i = 0; arr && i < arr.size(); i++) {
      const d = doc.context.lookupMaybe(arr.get(i), PDFDict);
      if (!d) continue;
      const sub = d.get(PDFName.of("Subtype"));
      if (sub && sub.toString() === "/Link") { if (rectOf(doc, d)) links.push(p); }
      else if (!(sub && sub.toString() === "/Widget")) otherAnnots++;
    }
    if (p % 5 === 4) await tick();
  }

  let columnPages = 0;
  let tablePages = 0;
  extracted.forEach((e) => {
    const n = e.lines.length;
    if (n < 8) return;
    if (e.lines.filter((l) => l.wideGaps >= 1).length >= Math.max(6, 0.3 * n)) columnPages++;
    if (e.lines.filter((l) => l.wideGaps >= 2).length >= 4) tablePages++;
  });

  const missingFonts = unembeddedFontCount(doc);
  const hasForm = doc.catalog.has(PDFName.of("AcroForm"));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const findings = [];
  if (columnPages >= Math.max(2, 0.15 * pages.length) || (pages.length < 14 && columnPages >= 1 && columnPages / pages.length >= 0.3)) {
    findings.push({ level: "warn", code: "columns", message: `${plural(columnPages, "page looks", "pages look")} like ${columnPages === 1 ? "it uses" : "they use"} several columns. Reading order may be wrong there, so check the result.` });
  }
  if (tablePages >= Math.max(2, 0.15 * pages.length) || (pages.length < 14 && tablePages >= 1)) {
    findings.push({ level: "warn", code: "tables", message: `${plural(tablePages, "page seems", "pages seem")} to contain tables. Tables aren't tagged yet, so their cells will be read as ordinary text.` });
  }
  if (missingFonts) findings.push({ level: "warn", code: "fonts", message: `${plural(missingFonts, "font isn't", "fonts aren't")} embedded in the file. PDF/UA requires embedded fonts, and tagging can't change that.` });
  if (hasForm) findings.push({ level: "warn", code: "forms", message: "This PDF has form fields. They won't be tagged." });
  if (otherAnnots) findings.push({ level: "warn", code: "annots", message: `${plural(otherAnnots, "other annotation", "other annotations")} (comments, highlights and similar) won't be tagged.` });
  if (links.length) findings.push({ level: "info", code: "links", message: `${plural(links.length, "link", "links")} will be tagged as links, but the link text isn't nested inside them yet.` });
  if (autoDecorative) findings.push({ level: "info", code: "decorative", message: `${plural(autoDecorative, "background or very small image", "background or very small images")} will be marked as decorative.` });
  if (pages.length > 150) findings.push({ level: "info", code: "big", message: "This is a long document, so tagging may take a minute." });
  pdfjsDoc.loadingTask.destroy();

  const info = pdfjsDoc.numPages ? await pdfjsDoc.getMetadata().catch(() => null) : null;
  const existingTitle = (info && info.info && info.info.Title) || "";
  const suggestedTitle = (existingTitle || (headings[0] && headings[0].text) || "").replace(/\s+/g, " ").trim().slice(0, 150);
  const existingLang = doc.catalog.get(PDFName.of("Lang"));

  return {
    pageCount: pages.length,
    suggestedTitle,
    lang: existingLang ? existingLang.decodeText() : "",
    headings,
    images,
    linkCount: links.length,
    findings,
    _inputBytes: inputBytes,
    _layouts: layouts,
    _docBody: docBody,
  };
}

/* ---------- 6. Bookmarks and metadata ---------- */

function buildOutline(doc, headings) {
  if (!headings.length) return;
  const ctx = doc.context;
  const rootDict = ctx.obj({ Type: "Outlines" });
  const rootRef = ctx.register(rootDict);
  const root = { level: 0, children: [], dict: rootDict, ref: rootRef };
  const stack = [root];
  for (const h of headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    const parent = stack[stack.length - 1];
    const dict = ctx.obj({ Title: PDFHexString.fromText(h.text.slice(0, 200)), Parent: parent.ref, Dest: [h.page.ref, "XYZ", 0, h.top, null] });
    const node = { level: h.level, dict, ref: ctx.register(dict), children: [] };
    parent.children.push(node);
    stack.push(node);
  }
  const link = (node) => {
    const kids = node.children;
    if (!kids.length) return 0;
    let total = kids.length;
    kids.forEach((k, i) => {
      if (i > 0) k.dict.set(PDFName.of("Prev"), kids[i - 1].ref);
      if (i < kids.length - 1) k.dict.set(PDFName.of("Next"), kids[i + 1].ref);
      total += link(k);
    });
    node.dict.set(PDFName.of("First"), kids[0].ref);
    node.dict.set(PDFName.of("Last"), kids[kids.length - 1].ref);
    node.dict.set(PDFName.of("Count"), PDFNumber.of(total));
    return total;
  };
  link(root);
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

const xmlEscape = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function writeXmp(doc, title, lang) {
  const ctx = doc.context;
  const block = `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title><dc:language><rdf:Bag><rdf:li>${xmlEscape(lang)}</rdf:li></rdf:Bag></dc:language></rdf:Description>`;
  const existing = doc.catalog.get(PDFName.of("Metadata"));
  const stream = existing && ctx.lookup(existing);
  if (stream instanceof PDFRawStream) {
    try {
      const xml = new TextDecoder("utf-8").decode(decodePDFRawStream(stream).decode());
      if (/<dc:title[\s>]/.test(xml) || !xml.includes("</rdf:RDF>")) return;
      const merged = xml.replace("</rdf:RDF>", block.replace(/<dc:language>.*<\/dc:language>/, /<dc:language[\s>]/.test(xml) ? "" : "$&") + "</rdf:RDF>");
      doc.catalog.set(PDFName.of("Metadata"), ctx.register(ctx.stream(new TextEncoder().encode(merged), { Type: "Metadata", Subtype: "XML" })));
    } catch (e) { /* leave the existing metadata alone */ }
    return;
  }
  const xml = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${block}</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(ctx.stream(new TextEncoder().encode(xml), { Type: "Metadata", Subtype: "XML" })));
}

/* ---------- 7. Tagging ---------- */

export async function tagPdf(analysis, options = {}, { onProgress } = {}) {
  const {
    title = analysis.suggestedTitle || "Untitled",
    lang = analysis.lang || "en-AU",
    headingLevels = {},
    images: imageChoices = {},
    bookmarks = true,
    tagLinks = true,
  } = options;

  const doc = await PDFDocument.load(analysis._inputBytes.slice());
  const ctx = doc.context;
  const pages = doc.getPages();
  const layouts = analysis._layouts;
  const stats = { headings: 0, paragraphs: 0, lists: 0, figures: 0, links: 0, bookmarks: 0, imagesNeedingAlt: 0 };

  // Apply the visitor's heading choices to a fresh copy of the automatic result.
  layouts.forEach((l) => l.blocks.forEach((b) => {
    b.kind = b.autoKind;
    if (b.autoKind !== "heading") return;
    const chosen = headingLevels[b.id];
    if (chosen === 0) b.kind = "text";
    else b.level = chosen || b.autoLevel;
  }));

  const structRoot = ctx.obj({ Type: "StructTreeRoot" });
  const structRootRef = ctx.register(structRoot);
  const docElem = ctx.obj({ Type: "StructElem", S: "Document", P: structRootRef });
  const docElemRef = ctx.register(docElem);
  const docKids = ctx.obj([]);
  docElem.set(PDFName.of("K"), docKids);
  structRoot.set(PDFName.of("K"), docElemRef);

  const parentTreeNums = ctx.obj([]);
  const linkParentEntries = [];
  let nextStructParent = pages.length;
  const outlineHeadings = [];

  for (let p = 0; p < pages.length; p++) {
    if (onProgress) onProgress({ phase: "Tagging page", done: p, total: pages.length });
    if (p % 3 === 2) await tick();
    const page = pages[p];
    const { height } = page.getSize();
    const layout = layouts[p];
    const bytes = pageContentBytes(doc, page);
    const ops = tokenize(bytes);
    annotateOps(bytes, ops);
    const units = splitUnits(ops);
    const imageNames = imageXObjectNames(doc, page);

    const lineOf = new Map();
    layout.blocks.forEach((b) => {
      const lines = b.kind === "list" ? b.items.flatMap((i) => i.lines) : b.lines;
      lines.forEach((l) => l.items.forEach((it) => lineOf.set(it, { block: b, owner: b.kind === "list" ? b.items.find((i) => i.lines.includes(l)) : b })));
    });
    const findOwner = (x, y) => {
      let best = null;
      let bestD = Infinity;
      for (const it of layout.items) {
        if (Math.abs(it.y - y) > Math.max(1.5, 0.45 * it.size)) continue;
        if (x < it.x - 1.5 || x > it.x + it.w + 1.5) continue;
        const d = Math.abs(it.x - x);
        if (d < bestD) { best = it; bestD = d; }
      }
      return best && lineOf.get(best);
    };

    const elemFor = new Map();
    const mcidElems = [];
    let nextMcid = 0;
    const pageRef = page.ref;
    const pageElems = [];
    const makeElem = (role, parentRef, extra = {}) => {
      const d = ctx.obj({ Type: "StructElem", S: role, P: parentRef, Pg: pageRef, ...extra });
      return { dict: d, ref: ctx.register(d), kids: ctx.obj([]) };
    };
    const ensure = (owner) => {
      if (elemFor.has(owner.owner)) return elemFor.get(owner.owner);
      const b = owner.block;
      let e;
      if (b.kind === "list") {
        let listE = elemFor.get(b);
        if (!listE) {
          listE = makeElem("L", docElemRef);
          listE.dict.set(PDFName.of("K"), listE.kids);
          listE.items = [];
          elemFor.set(b, listE);
          pageElems.push({ kind: "list", e: listE });
        }
        const li = makeElem("LI", listE.ref);
        li.dict.set(PDFName.of("K"), li.kids);
        listE.kids.push(li.ref);
        const body = makeElem("LBody", li.ref);
        body.dict.set(PDFName.of("K"), body.kids);
        li.kids.push(body.ref);
        listE.items.push({ li, body });
        e = { ...body, role: "LBody" };
      } else {
        const role = b.kind === "heading" ? `H${b.level}` : "P";
        e = makeElem(role, docElemRef);
        e.dict.set(PDFName.of("K"), e.kids);
        pageElems.push({ kind: "elem", e });
        e.role = role;
      }
      elemFor.set(owner.owner, e);
      return e;
    };

    const nameOf = (o) => (o.args[0] ? String.fromCharCode(...bytes.subarray(o.args[0].s, o.args[0].e)) : null);
    const isImageDo = (o) => o.op === "Do" && o.args[0] && imageNames.has(nameOf(o));
    const xobjs = xobjectDict(doc, page);
    const formTextInfo = (o) => {
      if (o.op !== "Do" || !xobjs || isImageDo(o)) return null;
      const nm = nameOf(o);
      if (!nm) return null;
      const obj = ctx.lookup(xobjs.get(PDFName.of(nm.slice(1))));
      if (!(obj instanceof PDFRawStream)) return null;
      const subtype = obj.dict.get(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Form") return null;
      let hasText = false;
      try { hasText = tokenize(decodePDFRawStream(obj).decode()).some((x) => x.op === "BT" || SHOW.has(x.op)); } catch (e) { return null; }
      if (!hasText) return null;
      const bb = obj.dict.get(PDFName.of("BBox"));
      const arr = bb && ctx.lookup(bb);
      const v = arr && Array.from({ length: 4 }, (_, i) => ctx.lookup(arr.get(i)).asNumber());
      const mat = obj.dict.get(PDFName.of("Matrix"));
      const ma = mat && ctx.lookup(mat);
      const fm = ma ? Array.from({ length: 6 }, (_, i) => ctx.lookup(ma.get(i)).asNumber()) : [1, 0, 0, 1, 0, 0];
      const m = mul(fm, o.place.m);
      const ys = v ? [v[1], v[3]].flatMap((y) => [v[0], v[2]].map((x) => x * m[1] + y * m[3] + m[5])) : [o.place.y + o.place.h];
      return { top: Math.max(...ys) };
    };

    const imageById = new Map(analysis.images.map((im) => [im.id, im]));
    const formFor = new Map();
    const figFor = new Map();
    const entries = layout.blocks.map((b) => ({ kind: "block", b, top: b.kind === "list" ? b.items[0].lines[0].y + b.items[0].size : b.lines[0].y + b.size }));
    ops.forEach((o, oi) => {
      if (isImageDo(o)) {
        const im = imageById.get(`${p}:${oi}`);
        if (!im) return; // background or tiny image: stays an artifact
        const choice = imageChoices[im.id] || {};
        if (choice.decorative) return;
        entries.push({ kind: "fig", o, im, choice, top: im.bbox[3] });
      } else {
        const fi = formTextInfo(o);
        if (fi) entries.push({ kind: "form", o, top: fi.top });
      }
    });

    if (tagLinks) {
      const annots = page.node.get(PDFName.of("Annots"));
      const arr = annots && ctx.lookupMaybe(annots, PDFArray);
      for (let i = 0; arr && i < arr.size(); i++) {
        const ref = arr.get(i);
        const d = ctx.lookupMaybe(ref, PDFDict);
        const sub = d && d.get(PDFName.of("Subtype"));
        if (!d || !sub || sub.toString() !== "/Link") continue;
        const rect = rectOf(doc, d);
        if (!rect) continue;
        let text = layout.items
          .filter((it) => it.x >= rect[0] - 2 && it.x <= rect[2] + 2 && it.y >= rect[1] - it.size * 0.4 && it.y <= rect[3] + it.size * 0.4)
          .map((it) => it.str.trim()).join(" ").replace(/\s+/g, " ").trim();
        if (!text) {
          const action = ctx.lookupMaybe(d.get(PDFName.of("A")), PDFDict);
          const uri = action && action.get(PDFName.of("URI"));
          text = uri && uri.decodeText ? uri.decodeText() : "Link";
        }
        entries.push({ kind: "link", la: { ref, d, rect, text: text.slice(0, 200) }, top: rect[3] });
      }
    }

    entries.sort((x, y) => y.top - x.top);
    for (const e of entries) {
      if (e.kind === "form") {
        const fe = makeElem("P", docElemRef);
        fe.dict.set(PDFName.of("K"), fe.kids);
        pageElems.push({ kind: "elem", e: fe });
        formFor.set(e.o, fe);
      } else if (e.kind === "fig") {
        const extra = { A: ctx.obj({ O: "Layout", BBox: e.im.bbox }) };
        const alt = (e.choice.alt || "").trim();
        extra.Alt = PDFHexString.fromText(alt);
        if (!alt) stats.imagesNeedingAlt++;
        const fig = makeElem("Figure", docElemRef, extra);
        pageElems.push({ kind: "fig", e: fig });
        figFor.set(e.o, fig);
      } else if (e.kind === "link") {
        const la = e.la;
        const key = nextStructParent++;
        const linkE = makeElem("Link", docElemRef, { Alt: PDFHexString.fromText(la.text) });
        linkE.dict.set(PDFName.of("K"), ctx.obj([ctx.obj({ Type: "OBJR", Obj: la.ref, Pg: pageRef })]));
        la.d.set(PDFName.of("StructParent"), PDFNumber.of(key));
        if (!la.d.has(PDFName.of("Contents"))) la.d.set(PDFName.of("Contents"), PDFHexString.fromText(la.text));
        linkParentEntries.push([key, linkE.ref]);
        pageElems.push({ kind: "link", e: linkE });
        stats.links++;
      } else if (e.b.kind === "list") {
        e.b.items.forEach((it) => ensure({ block: e.b, owner: it }));
      } else if (e.b.kind !== "artifact") {
        ensure({ block: e.b, owner: e.b });
      }
    }

    const enc = (str) => Uint8Array.from([...str].map((c) => c.charCodeAt(0)));
    const chunks = [];
    const emit = (u8) => { chunks.push(u8); chunks.push(Uint8Array.of(10)); };
    const raw = (o) => bytes.subarray(o.s, o.e);

    let open = null;
    let pending = [];
    let inText = false;
    let pathBuf = [];
    let lastOwner = null;
    const closeOpen = () => { if (open) { emit(enc("EMC")); open = null; } };
    const flushPending = () => { pending.forEach((x) => emit(raw(x))); pending = []; };
    const newMcid = (elem) => { const m = nextMcid++; mcidElems[m] = elem.ref; return m; };

    const processOp = (o) => {
      if (o.op === "BT") { inText = true; emit(raw(o)); return; }
      if (o.op === "ET") { flushPending(); closeOpen(); inText = false; emit(raw(o)); return; }

      if (SHOW.has(o.op) && inText) {
        let owner = o.show.fresh ? findOwner(o.show.x, o.show.y) : lastOwner;
        if (!owner) owner = lastOwner || null;
        if (owner && owner.block.kind === "artifact") {
          closeOpen(); flushPending();
          emit(enc("/Artifact BMC")); emit(raw(o)); emit(enc("EMC"));
          lastOwner = owner;
          return;
        }
        if (!owner) owner = { block: { kind: "text", lines: [], size: 0 }, owner: { synthetic: true } };
        lastOwner = owner;
        if (!open || open.owner !== owner.owner) {
          closeOpen(); flushPending();
          const e = ensure(owner);
          const mcid = newMcid(e);
          e.kids.push(PDFNumber.of(mcid));
          emit(enc(`/${e.role} <</MCID ${mcid}>> BDC`));
          open = { owner: owner.owner };
        } else flushPending();
        emit(raw(o));
        return;
      }

      if (inText) { pending.push(o); return; }

      if (PATH_BUILD.has(o.op) || o.op === "W" || o.op === "W*") { pathBuf.push(o); return; }
      if (PATH_PAINT.has(o.op) || o.op === "n") {
        if (o.op === "n" && !pathBuf.length) { emit(raw(o)); return; }
        const paints = o.op !== "n";
        if (paints) emit(enc("/Artifact BMC"));
        pathBuf.forEach((x) => emit(raw(x))); pathBuf = [];
        emit(raw(o));
        if (paints) emit(enc("EMC"));
        return;
      }
      if (formFor.has(o)) {
        const fe = formFor.get(o);
        const mcid = newMcid(fe);
        fe.kids.push(PDFNumber.of(mcid));
        emit(enc(`/P <</MCID ${mcid}>> BDC`)); emit(raw(o)); emit(enc("EMC"));
        return;
      }
      if (figFor.has(o)) {
        const fig = figFor.get(o);
        const mcid = newMcid(fig);
        fig.dict.set(PDFName.of("K"), PDFNumber.of(mcid));
        emit(enc(`/Figure <</MCID ${mcid}>> BDC`)); emit(raw(o)); emit(enc("EMC"));
        return;
      }
      if (o.op === "Do" || o.op === "sh" || o.op === "BI") {
        emit(enc("/Artifact BMC")); emit(raw(o)); emit(enc("EMC"));
        return;
      }
      emit(raw(o));
    };

    let pageOpen = null;
    let pendingTop = [];
    const closePage = () => { if (pageOpen) { emit(enc("EMC")); pageOpen = null; } };
    const flushTop = () => { pendingTop.forEach((x) => emit(raw(x))); pendingTop = []; };

    const unitOwner = (group) => {
      let owner = null;
      let last = lastOwner;
      let hasText = false;
      for (const o of group) {
        if (PAINTING.has(o.op)) return { mixed: true };
        if (SHOW.has(o.op)) {
          hasText = true;
          const cur = (o.show.fresh ? findOwner(o.show.x, o.show.y) : last) || last;
          if (!cur) return { mixed: true };
          if (owner && owner.owner !== cur.owner) return { mixed: true };
          owner = cur;
          last = cur;
        }
      }
      return !hasText || !owner ? { mixed: true } : { owner };
    };

    for (const u of units) {
      if (u.group) {
        const info = unitOwner(u.group);
        if (!info.mixed && info.owner.block.kind !== "artifact") {
          if (pageOpen && pageOpen.owner === info.owner.owner) flushTop();
          else {
            closePage(); flushTop();
            const e = ensure(info.owner);
            const mcid = newMcid(e);
            e.kids.push(PDFNumber.of(mcid));
            emit(enc(`/${e.role} <</MCID ${mcid}>> BDC`));
            pageOpen = { owner: info.owner.owner };
          }
          lastOwner = info.owner;
          u.group.forEach((x) => emit(raw(x)));
          continue;
        }
        if (!info.mixed) {
          closePage(); flushTop();
          emit(enc("/Artifact BMC")); u.group.forEach((x) => emit(raw(x))); emit(enc("EMC"));
          lastOwner = info.owner;
          continue;
        }
        closePage(); flushTop();
        u.group.forEach(processOp);
        continue;
      }
      const o = u.op;
      if (STATE_OPS.has(o.op) && pageOpen) { pendingTop.push(o); continue; }
      closePage(); flushTop();
      processOp(o);
    }
    closePage(); flushTop();
    closeOpen();
    pathBuf.forEach((x) => emit(raw(x)));

    for (const pe of pageElems) {
      if (pe.kind === "list") {
        for (let i = pe.e.items.length - 1; i >= 0; i--) {
          const it = pe.e.items[i];
          if (it.body.kids.size() === 0) { const idx = pe.e.kids.indexOf(it.li.ref); if (idx >= 0) pe.e.kids.remove(idx); }
        }
        if (pe.e.kids.size() > 0) { docKids.push(pe.e.ref); stats.lists++; }
      } else if (pe.kind === "elem") {
        if (pe.e.kids.size() > 0) {
          docKids.push(pe.e.ref);
          if (pe.e.role && pe.e.role.startsWith("H")) stats.headings++; else stats.paragraphs++;
        }
      } else if (pe.kind === "fig") {
        if (pe.e.dict.has(PDFName.of("K"))) { docKids.push(pe.e.ref); stats.figures++; }
      } else {
        docKids.push(pe.e.ref);
      }
    }

    const outBytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let q = 0;
    for (const c of chunks) { outBytes.set(c, q); q += c.length; }
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(outBytes)));
    page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
    page.node.set(PDFName.of("StructParents"), PDFNumber.of(p));
    parentTreeNums.push(PDFNumber.of(p));
    parentTreeNums.push(ctx.obj(mcidElems.map((r) => r)));

    layout.blocks.forEach((b) => {
      if (b.kind === "heading") outlineHeadings.push({ level: b.level, text: blockText(b), page, top: Math.min(height, b.lines[0].y + b.size * 1.2) });
    });
  }

  for (const [key, ref] of linkParentEntries) {
    parentTreeNums.push(PDFNumber.of(key));
    parentTreeNums.push(ref);
  }
  structRoot.set(PDFName.of("ParentTree"), ctx.register(ctx.obj({ Nums: parentTreeNums })));
  structRoot.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(nextStructParent));

  if (bookmarks) { buildOutline(doc, outlineHeadings); stats.bookmarks = outlineHeadings.length; }

  const catalog = doc.catalog;
  catalog.set(PDFName.of("StructTreeRoot"), structRootRef);
  catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));
  catalog.set(PDFName.of("Lang"), PDFString.of(lang));
  catalog.set(PDFName.of("ViewerPreferences"), ctx.obj({ DisplayDocTitle: true }));
  doc.setTitle(title);
  writeXmp(doc, title, lang);

  return { bytes: await doc.save(), stats };
}
