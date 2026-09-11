import { PDFLib } from "/assets/tools/pdf-common.js";

const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};
const MARGIN = 56;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const inputText = document.getElementById("inputText");
const pageSizeSelect = document.getElementById("pageSize");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".md") || f.name.toLowerCase().endsWith(".markdown") || f.type === "text/markdown");
  if (!file) {
    setStatus(statusEl, "Please choose a .md file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  inputText.value = await file.text();
  clearStatus(statusEl);
});

clearBtn.addEventListener("click", () => {
  inputText.value = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

// --- Block-level parsing -----------------------------------------------

function parseMarkdownBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isHeading = (l) => /^#{1,3}\s+/.test(l);
  const isHr = (l) => /^\s*([-*_])\1{2,}\s*$/.test(l);
  const isFence = (l) => /^```/.test(l.trim());
  const isBullet = (l) => /^\s*[-*+]\s+/.test(l);
  const isNumbered = (l) => /^\s*\d+\.\s+/.test(l);
  const isQuote = (l) => /^>\s?/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      i++; continue;
    }

    if (isHr(line)) {
      blocks.push({ type: "hr" });
      i++; continue;
    }

    if (isFence(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) { codeLines.push(lines[i]); i++; }
      i++;
      blocks.push({ type: "code", lines: codeLines });
      continue;
    }

    if (isBullet(line)) {
      blocks.push({ type: "bullet", text: line.replace(/^\s*[-*+]\s+/, "").trim() });
      i++; continue;
    }

    if (isNumbered(line)) {
      blocks.push({ type: "numbered", text: line.replace(/^\s*\d+\.\s+/, "").trim() });
      i++; continue;
    }

    if (isQuote(line)) {
      blocks.push({ type: "quote", text: line.replace(/^>\s?/, "").trim() });
      i++; continue;
    }

    const paraLines = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !isHeading(lines[i]) && !isHr(lines[i]) &&
           !isFence(lines[i]) && !isBullet(lines[i]) && !isNumbered(lines[i]) && !isQuote(lines[i])) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }
  return blocks;
}

// --- Inline parsing (bold/italic/code) into word tokens -----------------

function parseInlineWords(text, fonts) {
  const inlineRe = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_|`([^`]+)`/g;
  const runs = [];
  let lastIndex = 0;
  let m;
  while ((m = inlineRe.exec(text))) {
    if (m.index > lastIndex) runs.push({ text: text.slice(lastIndex, m.index), style: "normal" });
    if (m[1] !== undefined) runs.push({ text: m[1], style: "bolditalic" });
    else if (m[2] !== undefined) runs.push({ text: m[2], style: "bold" });
    else if (m[3] !== undefined) runs.push({ text: m[3], style: "italic" });
    else if (m[4] !== undefined) runs.push({ text: m[4], style: "bold" });
    else if (m[5] !== undefined) runs.push({ text: m[5], style: "italic" });
    else if (m[6] !== undefined) runs.push({ text: m[6], style: "code" });
    lastIndex = inlineRe.lastIndex;
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex), style: "normal" });

  const words = [];
  for (const run of runs) {
    const font = run.style === "bolditalic" ? fonts.boldItalic
      : run.style === "bold" ? fonts.bold
      : run.style === "italic" ? fonts.italic
      : run.style === "code" ? fonts.code
      : fonts.normal;
    for (const w of run.text.split(/\s+/).filter(Boolean)) words.push({ text: w, font });
  }
  return words;
}

function wrapWords(words, maxWidth, fontSize, spaceWidth) {
  const lines = [];
  let current = [];
  let currentWidth = 0;
  for (const token of words) {
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

runBtn.addEventListener("click", async () => {
  const markdown = inputText.value;
  if (!markdown.trim()) {
    setStatus(statusEl, "Paste or add some Markdown first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building PDF…", "");
  statusEl.classList.add("visible");

  try {
    const [pageW, pageH] = PAGE_SIZES[pageSizeSelect.value];
    const maxWidth = pageW - MARGIN * 2;

    const doc = await PDFLib.PDFDocument.create();
    const fonts = {
      normal: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
      bold: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
      italic: await doc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
      boldItalic: await doc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
      code: await doc.embedFont(PDFLib.StandardFonts.Courier),
    };
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

    const blocks = parseMarkdownBlocks(markdown);
    let numberedCounter = 0;

    for (const block of blocks) {
      if (block.type !== "numbered") numberedCounter = 0;

      if (block.type === "heading") {
        const size = block.level === 1 ? 22 : block.level === 2 ? 17 : 14;
        const lineHeight = size * 1.3;
        ensureSpace(lineHeight + 10);
        y -= 10;
        const words = parseInlineWords(block.text, fonts).map((t) => ({ ...t, font: fonts.bold }));
        const lines = wrapWords(words, maxWidth, size, fonts.bold.widthOfTextAtSize(" ", size));
        drawWordLines(lines, size, lineHeight, 0, black);
        y -= 4;
      } else if (block.type === "hr") {
        ensureSpace(20);
        y -= 10;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: pageW - MARGIN, y }, thickness: 1, color: gray });
        y -= 10;
      } else if (block.type === "code") {
        const size = 10;
        const lineHeight = size * 1.4;
        ensureSpace(lineHeight);
        y -= 6;
        for (const raw of block.lines) {
          ensureSpace(lineHeight);
          page.drawText(raw, { x: MARGIN + 10, y: y - size, size, font: fonts.code, color: black });
          y -= lineHeight;
        }
        y -= 6;
      } else if (block.type === "bullet" || block.type === "numbered") {
        const size = 12;
        const lineHeight = size * 1.45;
        const indent = 18;
        const words = parseInlineWords(block.text, fonts);
        const lines = wrapWords(words, maxWidth - indent, size, fonts.normal.widthOfTextAtSize(" ", size));
        if (lines.length) {
          ensureSpace(lineHeight);
          const marker = block.type === "bullet" ? "•" : `${++numberedCounter}.`;
          page.drawText(marker, { x: MARGIN, y: y - size, size, font: fonts.normal, color: black });
          let x = MARGIN + indent;
          const spaceWidth = fonts.normal.widthOfTextAtSize(" ", size);
          for (const token of lines[0]) {
            page.drawText(token.text, { x, y: y - size, size, font: token.font, color: black });
            x += token.font.widthOfTextAtSize(token.text, size) + spaceWidth;
          }
          y -= lineHeight;
          drawWordLines(lines.slice(1), size, lineHeight, indent, black);
        }
      } else if (block.type === "quote") {
        const size = 12;
        const lineHeight = size * 1.45;
        const words = parseInlineWords(block.text, fonts).map((t) => ({ ...t, font: t.font === fonts.normal ? fonts.italic : t.font }));
        const lines = wrapWords(words, maxWidth - 16, size, fonts.italic.widthOfTextAtSize(" ", size));
        const blockHeight = lines.length * lineHeight;
        ensureSpace(blockHeight);
        page.drawRectangle({ x: MARGIN, y: y - blockHeight + (lineHeight - size), width: 3, height: blockHeight, color: gray });
        drawWordLines(lines, size, lineHeight, 14, gray);
      } else {
        const size = 12;
        const lineHeight = size * 1.45;
        const words = parseInlineWords(block.text, fonts);
        const lines = wrapWords(words, maxWidth, size, fonts.normal.widthOfTextAtSize(" ", size));
        drawWordLines(lines, size, lineHeight, 0, black);
        y -= 6;
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, "document.pdf");
    setStatus(statusEl, `Sorted — created a ${doc.getPageCount()}-page PDF (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
