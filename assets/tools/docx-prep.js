// Word to PDF: tidies the .docx before docx-preview lays it out, for things it would otherwise drop or garble.
//  - text boxes: their text moves into a bordered one-cell table in the text flow (docx-preview skips DrawingML text boxes)
//  - equations: written as plain text with raised and lowered parts, so a fraction is not drawn as a jumble
//  - page size: optionally set to A4 or Letter
// It also counts what the document holds, so the result can say what was changed and what could not be carried over.
import { ommlToRuns, pageSizeTwips } from "/assets/tools/docx-prep-core.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const all = (root, local) => [...root.getElementsByTagNameNS("*", local)];
const attrOf = (el, local) => {
  for (const a of el.attributes) if (a.localName === local) return a.value;
  return null;
};
const wEl = (xml, name) => xml.createElementNS(W, `w:${name}`);
const setW = (el, name, value) => el.setAttributeNS(W, `w:${name}`, String(value));

function toTree(el) {
  const a = {};
  for (const at of el.attributes) a[at.localName] = at.value;
  const node = { n: el.localName, a, c: [] };
  if (el.localName === "t") node.t = el.textContent;
  for (const child of el.children) node.c.push(toTree(child));
  return node;
}

// ---------------------------------------------------------------- counting

function scan(xml) {
  const f = { textBoxes: 0, equations: 0, footnotes: 0, endnotes: 0, charts: 0, smartArt: 0, shapes: 0, trackedChanges: 0, comments: 0, continuousBreaks: 0 };
  f.footnotes = all(xml, "footnoteReference").length;
  f.endnotes = all(xml, "endnoteReference").length;
  f.comments = all(xml, "commentReference").length;
  for (const g of all(xml, "graphicData")) {
    const uri = attrOf(g, "uri") || "";
    if (/chart/i.test(uri)) f.charts++;
    else if (/diagram/i.test(uri)) f.smartArt++;
  }
  for (const s of all(xml, "wsp")) {
    if (all(s, "txbxContent").length) continue;
    let up = s.parentElement;
    let ac = null;
    while (up) {
      if (up.localName === "AlternateContent") ac = up;
      up = up.parentElement;
    }
    // a shape that has a fallback drawing may still be drawn by docx-preview, so only count the ones that have none
    if (!ac || !all(ac, "Fallback").length) f.shapes++;
  }
  for (const tag of ["ins", "del"]) {
    for (const el of all(xml, tag)) if (el.namespaceURI === W && !/Pr$/.test(el.parentElement.localName)) f.trackedChanges++;
  }
  for (const t of all(xml, "type")) if (t.parentElement.localName === "sectPr" && attrOf(t, "val") === "continuous") f.continuousBreaks++;
  return f;
}

// ---------------------------------------------------------------- text boxes

const EMU_PER_TWIP = 635;
const hex = (v) => (v && /^#?[0-9a-fA-F]{6}$/.test(v) ? v.replace("#", "").toUpperCase() : null);

function vmlWidthTwips(branch) {
  for (const s of branch.querySelectorAll("*")) {
    const style = attrOf(s, "style");
    const m = style && /(?:^|;)\s*width:\s*([\d.]+)(pt|in|px|cm|mm)?/i.exec(style);
    if (m) return Math.round(parseFloat(m[1]) * ({ pt: 20, in: 1440, px: 15, cm: 567, mm: 56.7 }[(m[2] || "pt").toLowerCase()] || 20));
  }
  return null;
}

// What a text box looks like: its width, fill and outline, read from whichever drawing kind it has
function boxLook(branch) {
  const look = { width: null, fill: null, line: null };
  const extent = all(branch, "extent")[0];
  if (extent && attrOf(extent, "cx")) look.width = Math.round(Number(attrOf(extent, "cx")) / EMU_PER_TWIP);
  const spPr = all(branch, "spPr")[0];
  if (spPr) {
    const kid = (name, parent = spPr) => [...parent.children].find((c) => c.localName === name);
    const solid = kid("solidFill");
    if (solid) look.fill = hex(attrOf(solid.firstElementChild || solid, "val"));
    const ln = kid("ln");
    if (ln && !kid("noFill", ln)) {
      const lnFill = kid("solidFill", ln);
      const w = Number(attrOf(ln, "w")) || 12700;
      look.line = { colour: (lnFill && hex(attrOf(lnFill.firstElementChild || lnFill, "val"))) || "404040", sz: Math.min(48, Math.max(2, Math.round(w / 1587.5))) };
    }
    return look;
  }
  const shape = all(branch, "shape").concat(all(branch, "rect"), all(branch, "roundrect"))[0];
  if (shape) {
    if (attrOf(shape, "filled") !== "f") look.fill = hex(attrOf(shape, "fillcolor"));
    if (attrOf(shape, "stroked") !== "f") look.line = { colour: hex(attrOf(shape, "strokecolor")) || "000000", sz: 8 };
    look.width = look.width || vmlWidthTwips(branch);
  }
  return look;
}

function contentWidthTwips(xml) {
  const pg = all(xml, "sectPr").pop();
  if (!pg) return 9026;
  const size = [...pg.children].find((c) => c.localName === "pgSz");
  const mar = [...pg.children].find((c) => c.localName === "pgMar");
  const w = size ? Number(attrOf(size, "w")) || 11906 : 11906;
  const l = mar ? Number(attrOf(mar, "left")) || 1440 : 1440;
  const r = mar ? Number(attrOf(mar, "right")) || 1440 : 1440;
  return Math.max(2000, w - l - r);
}

function makeBox(xml, contents, look, widthTwips) {
  const tbl = wEl(xml, "tbl");
  const tblPr = wEl(xml, "tblPr");
  const tblW = wEl(xml, "tblW");
  setW(tblW, "w", widthTwips);
  setW(tblW, "type", "dxa");
  tblPr.appendChild(tblW);
  const layout = wEl(xml, "tblLayout");
  setW(layout, "type", "fixed");
  tblPr.appendChild(layout);
  tbl.appendChild(tblPr);
  const grid = wEl(xml, "tblGrid");
  const gridCol = wEl(xml, "gridCol");
  setW(gridCol, "w", widthTwips);
  grid.appendChild(gridCol);
  tbl.appendChild(grid);
  const tr = wEl(xml, "tr");
  const tc = wEl(xml, "tc");
  const tcPr = wEl(xml, "tcPr");
  const tcW = wEl(xml, "tcW");
  setW(tcW, "w", widthTwips);
  setW(tcW, "type", "dxa");
  tcPr.appendChild(tcW);
  if (look.line) {
    const borders = wEl(xml, "tcBorders");
    for (const side of ["top", "left", "bottom", "right"]) {
      const b = wEl(xml, side);
      setW(b, "val", "single");
      setW(b, "sz", look.line.sz);
      setW(b, "space", 0);
      setW(b, "color", look.line.colour);
      borders.appendChild(b);
    }
    tcPr.appendChild(borders);
  }
  if (look.fill) {
    const shd = wEl(xml, "shd");
    setW(shd, "val", "clear");
    setW(shd, "color", "auto");
    setW(shd, "fill", look.fill);
    tcPr.appendChild(shd);
  }
  const mar = wEl(xml, "tcMar");
  for (const side of ["top", "left", "bottom", "right"]) {
    const m = wEl(xml, side);
    setW(m, "w", 100);
    setW(m, "type", "dxa");
    mar.appendChild(m);
  }
  tcPr.appendChild(mar);
  tc.appendChild(tcPr);
  for (const box of contents) for (const child of [...box.children]) tc.appendChild(child.cloneNode(true));
  const last = tc.lastElementChild;
  if (!last || last.localName !== "p") tc.appendChild(wEl(xml, "p")); // a cell has to end with a paragraph
  tr.appendChild(tc);
  tbl.appendChild(tr);
  return tbl;
}

// Which drawing a text box belongs to, and the paragraph that holds it. Returns null for a box inside another box.
function findContainer(box) {
  let outerAlt = null;
  let pict = null;
  let drawing = null;
  let up = box.parentElement;
  while (up && up.localName !== "p") {
    if (up.localName === "txbxContent") return null;
    if (up.localName === "AlternateContent") outerAlt = up;
    else if (up.localName === "pict") pict = pict || up;
    else if (up.localName === "drawing") drawing = up;
    up = up.parentElement;
  }
  const container = outerAlt || pict || drawing;
  return container && up ? { container, host: up } : null;
}

function convertTextBoxes(xml) {
  const seen = new Set();
  const jobs = [];
  for (const box of all(xml, "txbxContent")) {
    const found = findContainer(box);
    if (!found || seen.has(found.container)) continue;
    seen.add(found.container);
    jobs.push(found);
  }
  const maxWidth = contentWidthTwips(xml);
  const after = new Map(); // host paragraph -> the last thing inserted after it, so several boxes keep their order
  let count = 0;
  for (const { container, host } of jobs) {
    let branch = container;
    if (container.localName === "AlternateContent") {
      branch = [...container.children].find((c) => c.localName === "Choice") || [...container.children].find((c) => c.localName === "Fallback") || container;
    }
    const contents = all(branch, "txbxContent").filter((b) => {
      let up = b.parentElement;
      while (up && up !== branch) {
        if (up.localName === "txbxContent") return false;
        up = up.parentElement;
      }
      return true;
    });
    if (!contents.length || !contents.some((b) => b.children.length)) continue;
    const look = boxLook(branch);
    const tbl = makeBox(xml, contents, look, Math.min(look.width || maxWidth, maxWidth));
    const anchor = after.get(host) || host;
    anchor.parentNode.insertBefore(tbl, anchor.nextSibling);
    after.set(host, tbl);
    const run = container.parentElement;
    container.remove();
    if (run && run.localName === "r" && ![...run.children].some((c) => c.localName !== "rPr")) run.remove();
    count++;
  }
  return count;
}

// ---------------------------------------------------------------- equations

function makeRun(xml, text, rPrSource, vert) {
  const r = wEl(xml, "r");
  const rPr = wEl(xml, "rPr");
  if (rPrSource) for (const c of rPrSource.children) if (c.localName !== "vertAlign" && c.localName !== "rStyle") rPr.appendChild(c.cloneNode(true));
  if (vert) {
    const va = wEl(xml, "vertAlign");
    setW(va, "val", vert);
    rPr.appendChild(va);
  }
  if (rPr.children.length) r.appendChild(rPr);
  const t = wEl(xml, "t");
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
  t.textContent = text;
  r.appendChild(t);
  return r;
}

function convertEquations(xml) {
  let count = 0;
  const swap = (math, display) => {
    const runs = ommlToRuns(toTree(math));
    const rPr = all(math, "rPr").find((p) => p.namespaceURI === W) || null;
    const host = math.parentElement;
    if (display && host && host.localName === "p") {
      const hasOtherText = all(host, "t").some((t) => t.namespaceURI === W);
      if (!hasOtherText) {
        let pPr = [...host.children].find((c) => c.localName === "pPr");
        if (!pPr) {
          pPr = wEl(xml, "pPr");
          host.insertBefore(pPr, host.firstChild);
        }
        if (![...pPr.children].some((c) => c.localName === "jc")) {
          const jc = wEl(xml, "jc");
          setW(jc, "val", "center");
          pPr.appendChild(jc);
        }
      }
    }
    // neighbours in the same style are joined, so the text stays in as few runs as it can
    const groups = [];
    for (const r of runs) {
      const vert = r.sup ? "superscript" : r.sub ? "subscript" : null;
      const last = groups[groups.length - 1];
      if (last && last.vert === vert) last.text += r.text;
      else groups.push({ text: r.text, vert });
    }
    for (const g of groups) if (g.text) math.parentNode.insertBefore(makeRun(xml, g.text, rPr, g.vert), math);
    math.remove();
    count++;
  };
  for (const para of all(xml, "oMathPara")) swap(para, true);
  for (const m of all(xml, "oMath")) if (m.isConnected) swap(m, false);
  return count;
}

// ---------------------------------------------------------------- page size

function setPageSize(xml, kind) {
  let changed = false;
  for (const size of all(xml, "pgSz")) {
    const next = pageSizeTwips(kind, Number(attrOf(size, "w")) || 0, Number(attrOf(size, "h")) || 0);
    if (!next) continue;
    setW(size, "w", next.w);
    setW(size, "h", next.h);
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------- entry

// Returns { buffer, features }. The buffer is a new file only when something had to change.
export async function prepareDocx(buffer, { pageSize = "keep" } = {}) {
  const none = { buffer, features: {} };
  let zip;
  try {
    zip = await window.JSZip.loadAsync(buffer);
  } catch (err) {
    return none; // docx-preview will report the real problem
  }
  const file = zip.file("word/document.xml");
  if (!file) return none;
  const text = await file.async("string");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) return none;

  const features = scan(xml);
  features.textBoxes = convertTextBoxes(xml);
  features.equations = convertEquations(xml);
  const resized = pageSize !== "keep" && setPageSize(xml, pageSize);
  if (!features.textBoxes && !features.equations && !resized) return { buffer, features };
  zip.file("word/document.xml", new XMLSerializer().serializeToString(xml));
  return { buffer: await zip.generateAsync({ type: "arraybuffer" }), features };
}
