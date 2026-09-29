// Shared "structured document to PDF" renderer, used by Word to PDF, RTF to PDF,
// EPUB to PDF, CSV to PDF and Excel to PDF. Walks a parsed HTML fragment (from
// mammoth, a hand-rolled RTF-to-HTML pass, or an EPUB chapter) into a small block
// model, then lays it out with pdf-lib the same way markdown-to-pdf.js does for
// Markdown syntax — this is that same word-wrap/draw approach, generalised to
// read from the DOM instead of Markdown source.
import { PDFLib } from "/assets/tools/pdf-common.js";

const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};
const MARGIN = 56;
const HEADING_SIZES = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 12 };

function inlineRuns(el, style = "normal") {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, " ");
      if (text.trim() || (text && runs.length)) runs.push({ text, style });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") { runs.push({ text: "\n", style }); continue; }
    let childStyle = style;
    if (tag === "strong" || tag === "b") childStyle = style === "italic" || style === "bolditalic" ? "bolditalic" : "bold";
    else if (tag === "em" || tag === "i") childStyle = style === "bold" || style === "bolditalic" ? "bolditalic" : "italic";
    else if (tag === "code") childStyle = "code";
    runs.push(...inlineRuns(node, childStyle));
  }
  return runs;
}

function runsToWords(runs, fonts) {
  const words = [];
  for (const run of runs) {
    const font = run.style === "bolditalic" ? fonts.boldItalic
      : run.style === "bold" ? fonts.bold
      : run.style === "italic" ? fonts.italic
      : run.style === "code" ? fonts.code
      : fonts.normal;
    for (const part of run.text.split(/(\n)/)) {
      if (part === "\n") { words.push({ break: true }); continue; }
      for (const w of part.split(/\s+/).filter(Boolean)) words.push({ text: w, font });
    }
  }
  return words;
}

function wrapWords(words, maxWidth, fontSize, spaceWidth) {
  const lines = [];
  let current = [];
  let currentWidth = 0;
  for (const token of words) {
    if (token.break) {
      lines.push(current);
      current = [];
      currentWidth = 0;
      continue;
    }
    const w = token.font.widthOfTextAtSize(token.text, fontSize);
    const addWidth = current.length === 0 ? w : currentWidth + spaceWidth + w;
    if (addWidth > maxWidth && current.length > 0) {
      lines.push(current);
      current = [token];
      currentWidth = w;
    } else {
      current.push(token);
      currentWidth = addWidth;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

// --- DOM -> block model --------------------------------------------------

function cellText(cell) {
  return cell.textContent.replace(/\s+/g, " ").trim();
}

export function htmlToBlocks(root) {
  const blocks = [];
  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      const headingMatch = tag.match(/^h([1-6])$/);
      if (headingMatch) {
        blocks.push({ type: "heading", level: Number(headingMatch[1]), runs: inlineRuns(child) });
      } else if (tag === "p") {
        const runs = inlineRuns(child);
        if (runs.some((r) => r.text.trim())) blocks.push({ type: "paragraph", runs });
      } else if (tag === "ul" || tag === "ol") {
        let n = 0;
        for (const li of child.children) {
          if (li.tagName.toLowerCase() !== "li") continue;
          n++;
          blocks.push({ type: tag === "ul" ? "bullet" : "numbered", n, runs: inlineRuns(li) });
        }
      } else if (tag === "blockquote") {
        blocks.push({ type: "quote", runs: inlineRuns(child) });
      } else if (tag === "hr") {
        blocks.push({ type: "hr" });
      } else if (tag === "pre" || tag === "code") {
        blocks.push({ type: "code", lines: child.textContent.replace(/\r\n/g, "\n").split("\n") });
      } else if (tag === "table") {
        const rows = Array.from(child.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td,th")).map(cellText)
        );
        if (rows.length) blocks.push({ type: "table", rows });
      } else if (tag === "img") {
        // Images aren't rendered (this is a text-first converter); skip silently.
      } else {
        walk(child);
      }
    }
  }
  walk(root);
  return blocks;
}

// --- Layout + drawing ------------------------------------------------------

export async function embedStandardFonts(doc) {
  return {
    normal: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
    bold: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
    italic: await doc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
    code: await doc.embedFont(PDFLib.StandardFonts.Courier),
  };
}

export function makeDrawState(doc, fonts, pageSizeKey, landscape = false) {
  let [pageW, pageH] = PAGE_SIZES[pageSizeKey] || PAGE_SIZES.a4;
  if (landscape) [pageW, pageH] = [pageH, pageW];
  const maxWidth = pageW - MARGIN * 2;
  const gray = PDFLib.rgb(0.4, 0.4, 0.4);
  const black = PDFLib.rgb(0, 0, 0);
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - MARGIN;

  function ensureSpace(needed) {
    if (y - needed < MARGIN) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - MARGIN;
    }
  }

  function newPage() {
    page = doc.addPage([pageW, pageH]);
    y = pageH - MARGIN;
  }

  function drawWordLines(lines, fontSize, lineHeight, indent, color) {
    const spaceWidth = fonts.normal.widthOfTextAtSize(" ", fontSize);
    for (const line of lines) {
      ensureSpace(lineHeight);
      let x = MARGIN + indent;
      for (const token of line) {
        page.drawText(token.text, { x, y: y - fontSize, size: fontSize, font: token.font, color });
        x += token.font.widthOfTextAtSize(token.text, fontSize) + spaceWidth;
      }
      y -= lineHeight;
    }
  }

  return { pageW, pageH, maxWidth, gray, black, ensureSpace, newPage, drawWordLines, get page() { return page; }, get y() { return y; }, set y(v) { y = v; } };
}

export function drawBlocks(state, blocks, fonts) {
  for (const block of blocks) {
    if (block.type === "heading") {
      const size = HEADING_SIZES[block.level] || 12;
      const lineHeight = size * 1.3;
      state.ensureSpace(lineHeight + 10);
      state.y -= 10;
      const words = runsToWords(block.runs, fonts).map((t) => (t.break ? t : { ...t, font: fonts.bold }));
      const lines = wrapWords(words, state.maxWidth, size, fonts.bold.widthOfTextAtSize(" ", size));
      state.drawWordLines(lines, size, lineHeight, 0, state.black);
      state.y -= 4;
    } else if (block.type === "hr") {
      state.ensureSpace(20);
      state.y -= 10;
      state.page.drawLine({ start: { x: MARGIN, y: state.y }, end: { x: state.pageW - MARGIN, y: state.y }, thickness: 1, color: state.gray });
      state.y -= 10;
    } else if (block.type === "code") {
      const size = 10;
      const lineHeight = size * 1.4;
      state.ensureSpace(lineHeight);
      state.y -= 6;
      for (const raw of block.lines) {
        state.ensureSpace(lineHeight);
        state.page.drawText(raw.replace(/\t/g, "    "), { x: MARGIN + 10, y: state.y - size, size, font: fonts.code, color: state.black });
        state.y -= lineHeight;
      }
      state.y -= 6;
    } else if (block.type === "bullet" || block.type === "numbered") {
      const size = 12;
      const lineHeight = size * 1.45;
      const indent = 18;
      const words = runsToWords(block.runs, fonts);
      const lines = wrapWords(words, state.maxWidth - indent, size, fonts.normal.widthOfTextAtSize(" ", size));
      if (lines.length) {
        state.ensureSpace(lineHeight);
        const marker = block.type === "bullet" ? "•" : `${block.n}.`;
        state.page.drawText(marker, { x: MARGIN, y: state.y - size, size, font: fonts.normal, color: state.black });
        let x = MARGIN + indent;
        const spaceWidth = fonts.normal.widthOfTextAtSize(" ", size);
        for (const token of lines[0]) {
          state.page.drawText(token.text, { x, y: state.y - size, size, font: token.font, color: state.black });
          x += token.font.widthOfTextAtSize(token.text, size) + spaceWidth;
        }
        state.y -= lineHeight;
        state.drawWordLines(lines.slice(1), size, lineHeight, indent, state.black);
      }
    } else if (block.type === "quote") {
      const size = 12;
      const lineHeight = size * 1.45;
      const words = runsToWords(block.runs, fonts).map((t) => (t.break ? t : { ...t, font: t.font === fonts.normal ? fonts.italic : t.font }));
      const lines = wrapWords(words, state.maxWidth - 16, size, fonts.italic.widthOfTextAtSize(" ", size));
      const blockHeight = lines.length * lineHeight;
      state.ensureSpace(blockHeight);
      state.page.drawRectangle({ x: MARGIN, y: state.y - blockHeight + (lineHeight - size), width: 3, height: blockHeight, color: state.gray });
      state.drawWordLines(lines, size, lineHeight, 14, state.gray);
    } else if (block.type === "table") {
      drawTableBlock(state, block.rows, fonts);
    } else {
      const size = 12;
      const lineHeight = size * 1.45;
      const words = runsToWords(block.runs, fonts);
      const lines = wrapWords(words, state.maxWidth, size, fonts.normal.widthOfTextAtSize(" ", size));
      state.drawWordLines(lines, size, lineHeight, 0, state.black);
      state.y -= 6;
    }
  }
}

// --- Table drawing (also used directly by CSV/Excel to PDF) ---------------

function drawTableBlock(state, rows, fonts) {
  if (!rows.length) return;
  const cols = rows[0].length;
  const colWidth = state.maxWidth / cols;
  const size = 10;
  const pad = 5;
  const lineHeight = size * 1.3;

  rows.forEach((row, ri) => {
    const font = ri === 0 ? fonts.bold : fonts.normal;
    const spaceWidth = font.widthOfTextAtSize(" ", size);
    const cellLines = Array.from({ length: cols }, (_, ci) => {
      const words = String(row[ci] ?? "").split(/\s+/).filter(Boolean).map((w) => ({ text: w, font }));
      return wrapWords(words, colWidth - pad * 2, size, spaceWidth).map((line) => line.map((t) => t.text).join(" "));
    });
    const rowHeight = Math.max(1, ...cellLines.map((l) => l.length)) * lineHeight + pad * 2;
    state.ensureSpace(rowHeight);

    if (ri === 0) {
      state.page.drawRectangle({ x: MARGIN, y: state.y - rowHeight, width: state.maxWidth, height: rowHeight, color: PDFLib.rgb(0.94, 0.94, 0.92) });
    }
    let x = MARGIN;
    for (let ci = 0; ci < cols; ci++) {
      let ly = state.y - pad - size;
      for (const line of cellLines[ci]) {
        state.page.drawText(line, { x: x + pad, y: ly, size, font, color: state.black });
        ly -= lineHeight;
      }
      state.page.drawRectangle({ x, y: state.y - rowHeight, width: colWidth, height: rowHeight, borderColor: state.gray, borderWidth: 0.5, color: undefined });
      x += colWidth;
    }
    state.y -= rowHeight;
  });
}

export async function renderTablePdf(rows, pageSizeKey, landscape = false) {
  const doc = await PDFLib.PDFDocument.create();
  const fonts = await embedStandardFonts(doc);
  const state = makeDrawState(doc, fonts, pageSizeKey, landscape);
  drawTableBlock(state, rows, fonts);
  return doc;
}

// sections: array of { html: string, pageBreakBefore?: boolean }, each parsed
// with DOMParser and drawn as flowing blocks; a new PDF page starts before any
// section marked pageBreakBefore (used for EPUB chapters).
export async function renderHtmlSectionsPdf(sections, pageSizeKey) {
  const doc = await PDFLib.PDFDocument.create();
  const fonts = await embedStandardFonts(doc);
  const state = makeDrawState(doc, fonts, pageSizeKey);
  const parser = new DOMParser();
  let first = true;
  for (const section of sections) {
    if (section.pageBreakBefore && !first) state.newPage();
    first = false;
    const parsed = parser.parseFromString(section.html, "text/html");
    const blocks = htmlToBlocks(parsed.body);
    drawBlocks(state, blocks, fonts);
  }
  return doc;
}
