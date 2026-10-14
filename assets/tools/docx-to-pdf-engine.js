// Word (.docx) to PDF that keeps the document's look.
//
// How it works: docx-preview (Apache-2.0) turns the .docx into real HTML with the document's own fonts, sizes,
// colours, borders, tables and images. The browser then lays that HTML out, and this file reads the finished layout
// back (where every word, box, border and picture landed) and redraws it as vector PDF with pdf-lib. Pages are
// cut by the browser's own column fragmentation, so lines, table rows and pictures are not sliced in half.
//
// Fonts: the PDF embeds look-alike fonts with the same metrics as the Office defaults (Carlito for Calibri,
// Liberation for Arial / Times New Roman / Courier New, Caladea for Cambria), all SIL OFL. They are loaded into
// the page under the document's own font names first, so the browser measures with the same widths that the PDF uses.
import { PDFLib } from "/assets/tools/pdf-common.js";
import { subsetTtf } from "/assets/tools/ttf-subset.js";

const FONT_BASE = "/assets/vendor/docx/fonts/";
const PX_TO_PT = 0.75;
const COLUMN_GAP = 48; // px between the "page columns" used to paginate; only ever measured, never drawn

const FONT_FILES = {
  sans: ["LiberationSans-Regular", "LiberationSans-Bold", "LiberationSans-Italic", "LiberationSans-BoldItalic"],
  serif: ["LiberationSerif-Regular", "LiberationSerif-Bold", "LiberationSerif-Italic", "LiberationSerif-BoldItalic"],
  mono: ["LiberationMono-Regular", "LiberationMono-Bold", "LiberationMono-Italic", "LiberationMono-BoldItalic"],
  carlito: ["Carlito-Regular", "Carlito-Bold", "Carlito-Italic", "Carlito-BoldItalic"],
  caladea: ["Caladea-Regular", "Caladea-Bold", "Caladea-Italic", "Caladea-BoldItalic"],
};
const FACE_STYLES = [
  { weight: "400", style: "normal" },
  { weight: "700", style: "normal" },
  { weight: "400", style: "italic" },
  { weight: "700", style: "italic" },
];

export class DocxError extends Error {}

function familyGroup(name) {
  const n = name.toLowerCase();
  if (/calibri|carlito|candara|corbel|aptos|segoe|constantia(?!x)/.test(n) && !/serif/.test(n)) return n.includes("constantia") ? "serif" : "carlito";
  if (/cambria|caladea/.test(n)) return "caladea";
  if (/courier|consolas|lucida console|monaco|menlo|mono|typewriter/.test(n)) return "mono";
  if (/times|georgia|garamond|palatino|book antiqua|bookman|century schoolbook|baskerville|didot|minion|serif|roman/.test(n) && !/sans/.test(n)) return "serif";
  return "sans";
}

const fontBytesCache = new Map();
async function fontBytes(file) {
  if (!fontBytesCache.has(file)) {
    fontBytesCache.set(
      file,
      fetch(`${FONT_BASE}${file}.ttf`).then((r) => {
        if (!r.ok) throw new DocxError("Could not load a built-in font");
        return r.arrayBuffer();
      })
    );
  }
  return fontBytesCache.get(file);
}

function firstFamily(cssFamily) {
  return (cssFamily || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
}

// ---------------------------------------------------------------------------
// colour / style helpers
// ---------------------------------------------------------------------------

function parseColour(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value || "");
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  const a = p.length > 3 ? p[3] : 1;
  return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a };
}

function px(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function isVisible(cs) {
  return cs.display !== "none" && cs.visibility !== "hidden";
}

// ---------------------------------------------------------------------------
// list markers: docx-preview draws bullets and numbers as ::before content, which can't be measured.
// Turn each one into a real element that lines up the way Word does (marker in the hanging indent).
// ---------------------------------------------------------------------------

// Symbol / Wingdings bullets arrive as private-use characters that no ordinary font has; use the nearest real glyphs.
const BULLET_MAP = { "\uF0B7": "\u2022", "\uF0A7": "\u25AA", "\uF0D8": "\u25BA", "\uF076": "\u25C6", "\uF0FC": "\u2713", "\uF0A8": "\u25A1", "\uF06E": "\u25A0", "\uF06C": "\u25CF" };
function mapBullets(text) {
  return text.replace(/[\uF000-\uF0FF]/g, (ch) => BULLET_MAP[ch] || "\u2022");
}

function counterText(n, style) {
  const alpha = (v, upper) => {
    let out = "";
    let x = v;
    while (x > 0) {
      x--;
      out = String.fromCharCode(97 + (x % 26)) + out;
      x = Math.floor(x / 26);
    }
    return upper ? out.toUpperCase() : out;
  };
  const roman = (v, upper) => {
    const map = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let out = "";
    let x = v;
    for (const [val, sym] of map) {
      while (x >= val) {
        out += sym;
        x -= val;
      }
    }
    return upper ? out.toUpperCase() : out;
  };
  switch (style) {
    case "lower-alpha":
    case "lower-latin":
      return alpha(n, false);
    case "upper-alpha":
    case "upper-latin":
      return alpha(n, true);
    case "lower-roman":
      return roman(n, false);
    case "upper-roman":
      return roman(n, true);
    case "decimal-leading-zero":
      return String(n).padStart(2, "0");
    default:
      return String(n);
  }
}

function unescapeCss(str) {
  return str.replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_, hex, ch) => {
    if (hex) return hex === "9" ? "\t" : hex.toLowerCase() === "a" ? "\n" : String.fromCodePoint(parseInt(hex, 16));
    return ch;
  });
}

function materialiseMarkers(host) {
  const css = [...host.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  // docx-preview numbers lists with CSS counters; CSS gives no way to read the result, so replay them here
  const resets = new Map(); // class -> [[counter, value]]
  for (const m of css.matchAll(/p\.(docx-num-\d+-\d+)\s*\{([^}]*)\}/g)) {
    const cs = /counter-set:\s*([^;]+)/.exec(m[2]);
    if (!cs) continue;
    const toks = cs[1].trim().split(/\s+/);
    const pairs = resets.get(m[1]) || [];
    for (let i = 0; i + 1 < toks.length; i += 2) pairs.push([toks[i], parseInt(toks[i + 1], 10) || 0]);
    resets.set(m[1], pairs);
  }
  const increments = new Map(); // class -> counter name
  for (const m of css.matchAll(/p\.(docx-num-\d+-\d+):before\s*\{[^}]*counter-increment:\s*([^;}\s]+)/g)) increments.set(m[1], m[2]);

  const counters = new Map();
  const jobs = [];
  for (const p of host.querySelectorAll("p")) {
    const cls = [...p.classList].find((c) => /^docx-num-\d+-\d+$/.test(c));
    if (!cls) continue;
    const template = getComputedStyle(p, "::before").content;
    if (!template || template === "none" || template === "normal") continue;
    for (const [name, value] of resets.get(cls) || []) counters.set(name, value);
    const incName = increments.get(cls) || cls;
    counters.set(incName, (counters.get(incName) || 0) + 1);
    let text = "";
    for (const t of template.matchAll(/"((?:\\.|[^"\\])*)"|counter\(\s*([^,)\s]+)\s*(?:,\s*([^)\s]+)\s*)?\)/g)) {
      if (t[2]) text += counterText(counters.get(t[2]) || 0, t[3] || "decimal");
      else text += unescapeCss(t[1] || "");
    }
    text = mapBullets(text.replace(/[\t\n]/g, "").trim());
    const firstSpan = p.querySelector("span");
    const pcs = getComputedStyle(p);
    jobs.push({ p, text, firstSpan, hanging: Math.max(0, -px(pcs.textIndent)) });
  }
  for (const { p, text, firstSpan, hanging } of jobs) {
    p.classList.add("fgp-marked");
    if (!text) continue;
    const span = document.createElement("span");
    span.className = "fgp-marker";
    span.textContent = text;
    const src = firstSpan ? getComputedStyle(firstSpan) : getComputedStyle(p);
    const isNumber = /^[A-Za-z0-9]+[.)]?$/.test(text);
    span.style.cssText =
      "display:inline-block;white-space:pre;overflow:visible;text-indent:0;" +
      `width:${Math.max(hanging, 1)}px;font-family:${src.fontFamily};font-size:${src.fontSize};color:${src.color};` +
      `font-weight:${isNumber ? src.fontWeight : "400"};font-style:normal;`;
    p.insertBefore(span, p.firstChild);
  }
}

// ---------------------------------------------------------------------------
// page-number fields: docx-preview drops PAGE / NUMPAGES fields from headers and footers, so swap each one for a
// placeholder run (a character style it keeps as a class name) before rendering, and fill in the real number when drawing.
// ---------------------------------------------------------------------------

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function fieldKind(instr) {
  const word = (instr || "").trim().toUpperCase().split(/\s+/)[0];
  if (word === "PAGE") return "FgpPage";
  if (word === "NUMPAGES") return "FgpPages";
  return null;
}

function makeFieldRun(xml, styleId, rPrSource) {
  const run = xml.createElementNS(W_NS, "w:r");
  const rPr = xml.createElementNS(W_NS, "w:rPr");
  const rStyle = xml.createElementNS(W_NS, "w:rStyle");
  rStyle.setAttributeNS(W_NS, "w:val", styleId);
  rPr.appendChild(rStyle);
  if (rPrSource) {
    for (const child of rPrSource.childNodes) {
      if (child.localName !== "rStyle") rPr.appendChild(child.cloneNode(true));
    }
  }
  run.appendChild(rPr);
  const t = xml.createElementNS(W_NS, "w:t");
  t.textContent = "0";
  run.appendChild(t);
  return run;
}

export async function injectPageFields(buffer) {
  let zip;
  try {
    zip = await window.JSZip.loadAsync(buffer);
  } catch (err) {
    return buffer; // docx-preview will report the real problem
  }
  let touched = false;
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const text = await zip.file(name).async("string");
    if (!/PAGE/i.test(text)) continue;
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) continue;
    let changed = false;
    for (const p of [...xml.getElementsByTagNameNS(W_NS, "p")]) {
      for (const simple of [...p.getElementsByTagNameNS(W_NS, "fldSimple")]) {
        const kind = fieldKind(simple.getAttributeNS(W_NS, "instr"));
        if (!kind) continue;
        const rPr = simple.getElementsByTagNameNS(W_NS, "rPr")[0] || null;
        simple.parentNode.replaceChild(makeFieldRun(xml, kind, rPr), simple);
        changed = true;
      }
      let collecting = null;
      for (const run of [...p.childNodes]) {
        if (run.localName !== "r") continue;
        const types = [...run.getElementsByTagNameNS(W_NS, "fldChar")].map((f) => f.getAttributeNS(W_NS, "fldCharType"));
        if (types.includes("begin")) collecting = { runs: [], instr: "" };
        if (!collecting) continue;
        collecting.runs.push(run);
        for (const it of run.getElementsByTagNameNS(W_NS, "instrText")) collecting.instr += it.textContent;
        if (types.includes("end")) {
          const kind = fieldKind(collecting.instr);
          if (kind) {
            const withText = collecting.runs.find((r) => r.getElementsByTagNameNS(W_NS, "t").length) || collecting.runs[0];
            const rPr = withText.getElementsByTagNameNS(W_NS, "rPr")[0] || null;
            const fresh = makeFieldRun(xml, kind, rPr);
            p.insertBefore(fresh, collecting.runs[0]);
            for (const r of collecting.runs) p.removeChild(r);
            changed = true;
          }
          collecting = null;
        }
      }
    }
    if (changed) {
      zip.file(name, new XMLSerializer().serializeToString(xml));
      touched = true;
    }
  }
  if (!touched) return buffer;
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile) {
    let styles = await stylesFile.async("string");
    const add = ["FgpPage", "FgpPages"]
      .filter((id) => !styles.includes(`w:styleId="${id}"`))
      .map((id) => `<w:style w:type="character" w:customStyle="1" w:styleId="${id}"><w:name w:val="${id}"/></w:style>`)
      .join("");
    styles = styles.replace("</w:styles>", `${add}</w:styles>`);
    zip.file("word/styles.xml", styles);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

// ---------------------------------------------------------------------------
// reading the laid-out DOM into drawing items
// ---------------------------------------------------------------------------

function makeCollector(origin) {
  // origin: { left, top, articleLeft, pitch } of the section being read; items carry a page index.
  const items = [];
  const place = (r) => {
    const col = Math.max(0, Math.floor((r.left - origin.articleLeft + 1) / origin.pitch));
    return { page: col, x: r.left - origin.left - col * origin.pitch, y: r.top - origin.top, w: r.width, h: r.height };
  };
  return { items, place };
}

function collectBoxes(el, cs, col) {
  const rects = [...el.getClientRects()].filter((r) => r.width > 0.1 && r.height > 0.1);
  if (!rects.length) return;
  const bg = parseColour(cs.backgroundColor);
  const isInline = cs.display === "inline";
  if (bg && bg.a > 0.01) {
    for (const r of rects) col.items.push({ kind: "fill", ...col.place(r), colour: bg });
  }
  if (isInline) return;
  const sides = ["Top", "Right", "Bottom", "Left"];
  const widths = sides.map((s) => px(cs[`border${s}Width`]));
  if (!widths.some((w) => w > 0)) return;
  const styles = sides.map((s) => cs[`border${s}Style`]);
  const colours = sides.map((s) => parseColour(cs[`border${s}Color`]));
  rects.forEach((r, i) => {
    const first = i === 0;
    const last = i === rects.length - 1;
    sides.forEach((side, k) => {
      if (!(widths[k] > 0) || styles[k] === "none" || styles[k] === "hidden" || !colours[k]) return;
      if (side === "Top" && !first) return;
      if (side === "Bottom" && !last) return;
      col.items.push({ kind: "border", side, width: widths[k], style: styles[k], colour: colours[k], ...col.place(r) });
    });
  });
}

function collectImage(el, col) {
  const r = el.getBoundingClientRect();
  if (r.width < 0.5 || r.height < 0.5) return;
  col.items.push({ kind: "image", el, ...col.place(r) });
}

function collectText(node, cs, col, linkHref) {
  const text = node.nodeValue;
  const fieldClass = node.parentElement && node.parentElement.className;
  const field = /docx_fgppages(?![a-z])/.test(fieldClass) ? "pages" : /docx_fgppage(?![a-z])/.test(fieldClass) ? "page" : null;
  if (!text || !text.trim()) return;
  const fs = px(cs.fontSize);
  const colour = parseColour(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
  const weight = parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === "bold";
  const italic = cs.fontStyle === "italic" || cs.fontStyle === "oblique";
  const family = firstFamily(cs.fontFamily);
  const decoLine = cs.textDecorationLine || "";
  const letterSpacing = cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing);
  const transform = cs.textTransform;
  const range = document.createRange();
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.01);
    if (!rects.length) continue;
    if (rects.length === 1) {
      words.push({ text: m[0], rect: rects[0] });
    } else {
      // a long word broken across lines: take it character by character
      for (let i = 0; i < m[0].length; i++) {
        range.setStart(node, m.index + i);
        range.setEnd(node, m.index + i + 1);
        const cr = range.getClientRects()[0];
        if (!cr) continue;
        const prev = words[words.length - 1];
        if (prev && prev.chars && Math.abs(prev.rect.top - cr.top) < fs * 0.4) {
          prev.text += m[0][i];
          prev.rect = new DOMRect(prev.rect.left, prev.rect.top, cr.right - prev.rect.left, prev.rect.height);
        } else {
          words.push({ text: m[0][i], rect: cr, chars: true });
        }
      }
    }
  }
  if (!words.length) return;
  // group into lines
  const lines = [];
  for (const w of words) {
    const line = lines[lines.length - 1];
    const last = line && line[line.length - 1];
    if (last && Math.abs(last.rect.top - w.rect.top) < fs * 0.45 && w.rect.left >= last.rect.left - 1) line.push(w);
    else lines.push([w]);
  }
  for (const line of lines) {
    line.forEach((w, i) => {
      let s = w.text;
      if (transform === "uppercase") s = s.toUpperCase();
      else if (transform === "lowercase") s = s.toLowerCase();
      else if (transform === "capitalize") s = s.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());
      col.items.push({
        kind: "text",
        field,
        text: s,
        space: i < line.length - 1,
        fontSize: fs,
        colour,
        bold: weight,
        italic,
        family,
        letterSpacing,
        ...col.place(w.rect),
      });
    });
    if (decoLine && decoLine !== "none") {
      const first = line[0].rect;
      const last = line[line.length - 1].rect;
      const decoColour = parseColour(cs.textDecorationColor) || colour;
      const placed = col.place(new DOMRect(first.left, first.top, last.right - first.left, first.height));
      col.items.push({
        kind: "decoration",
        underline: decoLine.includes("underline"),
        strike: decoLine.includes("line-through"),
        fontSize: fs,
        colour: decoColour,
        family,
        bold: weight,
        italic,
        ...placed,
      });
    }
  }
}

function walkTree(root, col) {
  const visit = (node, link) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent) return;
      collectText(node, getComputedStyle(parent), col, link);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "style" || tag === "script") return;
    const cs = getComputedStyle(node);
    if (!isVisible(cs)) return;
    if (tag === "img") {
      collectImage(node, col);
      return;
    }
    if (tag === "svg") {
      collectImage(node, col);
      return;
    }
    collectBoxes(node, cs, col);
    let nextLink = link;
    if (tag === "a" && node.getAttribute("href")) {
      nextLink = node.getAttribute("href");
      for (const r of node.getClientRects()) {
        if (r.width > 0.5 && r.height > 0.5) col.items.push({ kind: "link", href: nextLink, ...col.place(r) });
      }
    }
    for (const child of node.childNodes) visit(child, nextLink);
  };
  visit(root, null);
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

async function toPngBytes(el, w, h) {
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  let img;
  if (el.tagName.toLowerCase() === "svg") {
    const clone = el.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("width")) clone.setAttribute("width", String(w));
    if (!clone.getAttribute("height")) clone.setAttribute("height", String(h));
    const svg = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not draw a shape"));
      i.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
  } else {
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function embedImage(pdf, cache, item) {
  const el = item.el;
  const isSvg = el.tagName.toLowerCase() === "svg";
  const key = isSvg ? null : el.currentSrc || el.src;
  if (key && cache.has(key)) return cache.get(key);
  let embedded = null;
  try {
    if (!isSvg && /^data:image\/(png|jpe?g)/i.test(key)) {
      const bytes = new Uint8Array(await (await fetch(key)).arrayBuffer());
      embedded = /png/i.test(key.slice(0, 20)) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } else {
      embedded = await pdf.embedPng(await toPngBytes(el, item.w, item.h));
    }
  } catch (err) {
    embedded = null;
  }
  if (key) cache.set(key, embedded);
  return embedded;
}


// The browser kerns text (pulls pairs like "r," or "AV" together); PDF text does not. Work out where the kerned layout
// drifts from the plain one and split the word there, so each piece can be placed at the browser's position.
const KERN_FEATURES = { liga: false, clig: false, dlig: false, calt: false, kern: true };
function kernSegments(parsed, text, sizePt) {
  try {
    const chars = [...text];
    const run = parsed.layout(text, KERN_FEATURES);
    if (run.glyphs.length !== chars.length) return [{ text, dx: 0 }];
    const upm = parsed.unitsPerEm;
    const segments = [];
    let kerned = 0;
    let plain = 0;
    let segStart = 0;
    let segDx = 0;
    let startDeviation = 0;
    for (let i = 0; i < chars.length; i++) {
      const deviation = kerned - plain;
      if (i > 0 && Math.abs(deviation - startDeviation) * sizePt / upm > 0.12) {
        segments.push({ text: chars.slice(segStart, i).join(""), dx: segDx });
        segStart = i;
        segDx = kerned * sizePt / upm;
        startDeviation = deviation;
      }
      kerned += run.positions[i].xAdvance;
      plain += run.glyphs[i].advanceWidth;
    }
    segments.push({ text: chars.slice(segStart).join(""), dx: segDx });
    return segments;
  } catch (err) {
    return [{ text, dx: 0 }];
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function docxToPdf(arrayBuffer, { fileName = "", onProgress } = {}) {
  if (!window.docx || !window.JSZip || !window.fontkit) throw new DocxError("The Word engine did not load. Refresh the page and try again.");
  const progress = (message, done, total) => onProgress && onProgress({ message, done, total });

  // 1. render the .docx to HTML in an off-screen shadow root, so the site's own styles can't leak into the layout
  const outer = document.createElement("div");
  outer.style.cssText = "position:absolute;left:-30000px;top:0;width:3000px;pointer-events:none;";
  document.body.appendChild(outer);
  const shadow = outer.attachShadow({ mode: "open" });
  const sheet = document.createElement("style");
  sheet.textContent =
    ":host{all:initial;display:block}" +
    ".docx-wrapper{background:none!important;padding:0!important;display:block!important}" +
    ".docx-wrapper>section.docx{box-shadow:none!important;margin:0!important}" +
    "p.fgp-marked::before{content:none!important}" +
    // Word does not use ligatures by default, and PDF text drawn with them loses its spacing, so switch them off
    "*{font-variant-ligatures:none!important;font-feature-settings:\"liga\" 0,\"clig\" 0,\"dlig\" 0!important}";
  shadow.appendChild(sheet);
  const host = document.createElement("div");
  shadow.appendChild(host);
  const notes = [];
  const addedFonts = [];

  try {
    progress("Reading the document…");
    try {
      const prepared = await injectPageFields(arrayBuffer);
      await window.docx.renderAsync(prepared, host, null, {
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,
        ignoreFonts: true,
        experimental: false,
      });
    } catch (err) {
      throw new DocxError("That file couldn't be read as a Word document. Is it a .docx file (not an older .doc)?");
    }
    const sections = [...host.querySelectorAll("section.docx")];
    if (!sections.length) throw new DocxError("This document has no content to convert.");

    // 2. load look-alike fonts under the document's own font names
    progress("Loading fonts…");
    const wanted = new Map(); // docx family name -> group
    const counted = new Set(["Times New Roman"]); // docx-preview's default when nothing is set
    for (const t of host.querySelectorAll("span,p,td,th,li")) counted.add(firstFamily(getComputedStyle(t).fontFamily));
    for (const fam of counted) if (fam) wanted.set(fam, familyGroup(fam));
    const faceBytes = new Map();
    for (const group of new Set(wanted.values())) {
      const bytes = await Promise.all(FONT_FILES[group].map((f) => fontBytes(f)));
      faceBytes.set(group, bytes);
    }
    const loadJobs = [];
    for (const [fam, group] of wanted) {
      FONT_FILES[group].forEach((_, i) => {
        const face = new FontFace(fam, faceBytes.get(group)[i].slice(0), FACE_STYLES[i]);
        addedFonts.push(face);
        document.fonts.add(face);
        loadJobs.push(face.load());
      });
    }
    await Promise.all(loadJobs);
    await document.fonts.ready;

    // 3. lay out each section into page-sized columns, and read the result
    materialiseMarkers(host);
    const sectionData = [];
    let lastHeader = null;
    let lastFooter = null;
    const totalSections = sections.length;
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      progress("Laying out the pages…", si, totalSections);
      const article = sec.querySelector(":scope > article");
      if (!article) continue;
      const cs = getComputedStyle(sec);
      const pageW = px(cs.width);
      const pageH = px(cs.minHeight) || px(cs.height);
      const padT = px(cs.paddingTop);
      const padR = px(cs.paddingRight);
      const padB = px(cs.paddingBottom);
      const padL = px(cs.paddingLeft);
      const contentW = pageW - padL - padR;
      const contentH = pageH - padT - padB;
      if (contentW < 50 || contentH < 50) throw new DocxError("This document's page size looks wrong, so it can't be converted.");

      // header and footer: read them once with the article clipped, then draw them on every page.
      // A section with none of its own repeats the previous section's (Word's "link to previous").
      const headerEls = [...sec.children].filter((c) => /^header$/i.test(c.tagName));
      const footerEls = [...sec.children].filter((c) => /^footer$/i.test(c.tagName));
      let headerItems = null;
      let footerItems = null;
      if (headerEls.length || footerEls.length) {
        article.style.height = `${contentH}px`;
        article.style.overflow = "hidden";
        sec.style.height = `${pageH}px`;
        const secRect0 = sec.getBoundingClientRect();
        const read = (els) => {
          const c = makeCollector({ left: secRect0.left, top: secRect0.top, articleLeft: secRect0.left, pitch: 1e9 });
          for (const h of els) walkTree(h, c);
          return c.items;
        };
        if (headerEls.length) headerItems = read(headerEls);
        if (footerEls.length) {
          footerItems = read(footerEls);
          for (const it of footerItems) it.bottomGap = pageH - it.y;
        }
        for (const h of [...headerEls, ...footerEls]) h.style.display = "none";
        article.style.overflow = "";
      }
      if (headerItems) lastHeader = headerItems;
      if (footerItems) lastFooter = footerItems;
      const repeating = [
        ...(headerItems || lastHeader || []),
        ...(footerItems || (lastFooter ? lastFooter.map((it) => ({ ...it, y: pageH - it.bottomGap })) : [])),
      ];

      // paginate with CSS columns: one column per page
      sec.style.display = "block";
      sec.style.minHeight = "0";
      sec.style.height = `${pageH}px`;
      sec.style.overflow = "visible";
      article.style.cssText +=
        `;display:block;margin:0;width:${contentW}px;height:${contentH}px;column-width:${contentW}px;column-count:auto;` +
        `column-gap:${COLUMN_GAP}px;column-fill:auto;overflow:visible;`;
      for (const tr of article.querySelectorAll("tr")) tr.style.breakInside = "avoid";
      for (const im of article.querySelectorAll("img,svg")) im.style.breakInside = "avoid";
      for (const p of article.querySelectorAll("p")) {
        p.style.orphans = "2";
        p.style.widows = "2";
      }
      void sec.offsetHeight;
      const secRect = sec.getBoundingClientRect();
      const artRect = article.getBoundingClientRect();
      const pitch = contentW + COLUMN_GAP;
      const col = makeCollector({ left: secRect.left, top: secRect.top, articleLeft: artRect.left, pitch });
      walkTree(article, col);

      const pagesInSection = Math.max(1, ...col.items.map((it) => it.page + 1));
      const all = col.items.concat(...Array.from({ length: pagesInSection }, (_, p) => repeating.map((it) => ({ ...it, page: p }))));
      sectionData.push({ pageW, pageH, pagesInSection, items: all });
    }

    // 4. fonts: subset each face to the glyphs actually used, then embed
    progress("Building the PDF…");
    const pdf = await PDFLib.PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    const usedChars = new Map(); // font file -> Set of characters
    const fileFor = (family, bold, italic) => FONT_FILES[familyGroup(family)][(bold ? 1 : 0) + (italic ? 2 : 0)];
    for (const sd of sectionData) {
      for (const it of sd.items) {
        if (it.kind !== "text" && it.kind !== "decoration") continue;
        if (it.kind === "decoration") continue;
        const file = fileFor(it.family, it.bold, it.italic);
        if (!usedChars.has(file)) usedChars.set(file, new Set([" "]));
        for (const ch of it.text) usedChars.get(file).add(ch);
        if (it.field) for (const ch of "0123456789") usedChars.get(file).add(ch);
      }
    }
    const pdfFonts = new Map();
    const parsedFonts = new Map();
    for (const [file, chars] of usedChars) {
      const bytes = await fontBytes(file);
      const parsed = window.fontkit.create(new Uint8Array(bytes));
      parsedFonts.set(file, parsed);
      const ids = new Set();
      for (const ch of chars) ids.add(parsed.glyphForCodePoint(ch.codePointAt(0)).id);
      const small = subsetTtf(bytes, ids);
      pdfFonts.set(file, await pdf.embedFont(small, { subset: false, features: { liga: false, clig: false, dlig: false, calt: false } }));
    }
    const getPdfFont = (family, bold, italic) => pdfFonts.get(fileFor(family, bold, italic));
    const imageCache = new Map();

    // 5. draw
    const totalPages = sectionData.reduce((n, sd) => n + sd.pagesInSection, 0);
    let pageNumber = 0;
    let missingGlyphs = 0;
    for (const sd of sectionData) {
      const { pageW, pageH, pagesInSection, items } = sd;
      const pageObjs = [];
      for (let p = 0; p < pagesInSection; p++) pageObjs.push(pdf.addPage([pageW * PX_TO_PT, pageH * PX_TO_PT]));
      const H = pageH * PX_TO_PT;
      for (const it of items) {
        const page = pageObjs[it.page];
        if (!page) continue;
        const x = it.x * PX_TO_PT;
        const y = H - (it.y + it.h) * PX_TO_PT; // bottom edge of the box in PDF space
        const w = it.w * PX_TO_PT;
        const h = it.h * PX_TO_PT;
        if (it.kind === "fill") {
          page.drawRectangle({ x, y, width: w, height: h, color: PDFLib.rgb(it.colour.r, it.colour.g, it.colour.b), opacity: it.colour.a });
        } else if (it.kind === "border") {
          const t = it.width * PX_TO_PT;
          const dash = it.style === "dashed" ? [t * 3, t * 2] : it.style === "dotted" ? [t, t] : undefined;
          let sx, sy, ex, ey;
          if (it.side === "Top") { sx = x; ex = x + w; sy = ey = y + h - t / 2; }
          else if (it.side === "Bottom") { sx = x; ex = x + w; sy = ey = y + t / 2; }
          else if (it.side === "Left") { sx = ex = x + t / 2; sy = y; ey = y + h; }
          else { sx = ex = x + w - t / 2; sy = y; ey = y + h; }
          const common = { thickness: t, color: PDFLib.rgb(it.colour.r, it.colour.g, it.colour.b), opacity: it.colour.a, dashArray: dash };
          if (it.style === "double" && t >= 1.5) {
            const third = t / 3;
            const off = third * 1;
            const d = it.side === "Top" || it.side === "Bottom" ? [0, off] : [off, 0];
            page.drawLine({ start: { x: sx - d[0], y: sy - d[1] }, end: { x: ex - d[0], y: ey - d[1] }, ...common, thickness: third });
            page.drawLine({ start: { x: sx + d[0], y: sy + d[1] }, end: { x: ex + d[0], y: ey + d[1] }, ...common, thickness: third });
          } else {
            page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, ...common });
          }
        } else if (it.kind === "image") {
          const emb = await embedImage(pdf, imageCache, it);
          if (emb) page.drawImage(emb, { x, y, width: w, height: h });
        } else if (it.kind === "text") {
          const font = getPdfFont(it.family, it.bold, it.italic);
          const size = it.fontSize * PX_TO_PT;
          // the browser reports the text's content box; the baseline sits ascent below its top
          const ascent = (it.family && font.heightAtSize(size, { descender: false })) || size * 0.9;
          const baseline = H - it.y * PX_TO_PT - ascent;
          const shownText = it.field === "page" ? String(pageNumber + it.page + 1) : it.field === "pages" ? String(totalPages) : it.text;
          let s = shownText.replace(/[ \t]/g, " ") + (it.space ? " " : "");
          const set = font.getCharacterSet();
          for (const ch of s) {
            if (!set.includes(ch.codePointAt(0)) && ch !== " ") {
              missingGlyphs++;
            }
          }
          s = [...s].filter((ch) => set.includes(ch.codePointAt(0)) || ch === " ").join("");
          if (!s.trim()) continue;
          if (it.letterSpacing) page.pushOperators(PDFLib.setCharacterSpacing(it.letterSpacing * PX_TO_PT));
          const trailing = s.endsWith(" ") ? " " : "";
          const word = trailing ? s.slice(0, -1) : s;
          const pieces = it.letterSpacing ? [{ text: s, dx: 0 }] : kernSegments(parsedFonts.get(fileFor(it.family, it.bold, it.italic)), word, size);
          pieces.forEach((piece, k) => {
            const text = k === pieces.length - 1 ? piece.text + trailing : piece.text;
            if (!text) return;
            page.drawText(text, { x: x + piece.dx, y: baseline, size, font, color: PDFLib.rgb(it.colour.r, it.colour.g, it.colour.b), opacity: it.colour.a });
          });
          if (it.letterSpacing) page.pushOperators(PDFLib.setCharacterSpacing(0));
        } else if (it.kind === "decoration") {
          const size = it.fontSize * PX_TO_PT;
          const font = getPdfFont(it.family, it.bold, it.italic);
          const ascent = font.heightAtSize(size, { descender: false });
          const baseline = H - it.y * PX_TO_PT - ascent;
          const thick = Math.max(0.5, size * 0.06);
          const colour = PDFLib.rgb(it.colour.r, it.colour.g, it.colour.b);
          if (it.underline) page.drawLine({ start: { x, y: baseline - size * 0.12 }, end: { x: x + w, y: baseline - size * 0.12 }, thickness: thick, color: colour });
          if (it.strike) page.drawLine({ start: { x, y: baseline + size * 0.28 }, end: { x: x + w, y: baseline + size * 0.28 }, thickness: thick, color: colour });
        } else if (it.kind === "link") {
          if (!/^(https?:|mailto:|tel:)/i.test(it.href)) continue;
          const annot = pdf.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [x, y, x + w, y + h],
            Border: [0, 0, 0],
            A: { Type: "Action", S: "URI", URI: PDFLib.PDFString.of(it.href) },
          });
          page.node.addAnnot(pdf.context.register(annot));
        }
      }
      pageNumber += pagesInSection;
    }
    if (missingGlyphs) notes.push(`${missingGlyphs} character${missingGlyphs > 1 ? "s" : ""} had no glyph in the built-in fonts and were left out`);

    pdf.setTitle(fileName.replace(/\.docx$/i, "") || "Document");
    pdf.setCreator("Fair Go PDF");
    pdf.setProducer("Fair Go PDF");
    progress("Saving…");
    const bytes = await pdf.save();
    return { bytes, pageCount: pageNumber, notes: [...new Set(notes)] };
  } finally {
    for (const f of addedFonts) document.fonts.delete(f);
    outer.remove();
  }
}
