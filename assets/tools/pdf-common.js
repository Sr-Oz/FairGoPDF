// Shared PDF helpers, loaded as an ES module. Wraps pdf-lib (editing) and
// pdf.js (rendering) from a CDN — both run entirely client-side, no server calls
// beyond fetching the library code itself.

// Self-hosted rather than loaded from a CDN: browsers refuse to construct a Worker
// from a cross-origin script URL (SecurityError), which pdf.js needs for rendering.
// Same-origin files also mean these tools keep working even if a third-party CDN is down.
export * as PDFLib from "/assets/vendor/pdf-lib.esm.min.js";
import * as PDFLib from "/assets/vendor/pdf-lib.esm.min.js"; // a local name for the helpers below (the line above only re-exports)
import * as pdfjsLib from "/assets/vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdf.worker.min.mjs";

export { pdfjsLib };

export async function loadPdfJsDoc(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
}

export async function renderPageThumbCanvas(pdfJsDoc, pageNumber, maxWidth = 220) {
  const page = await pdfJsDoc.getPage(pageNumber);
  const viewport1 = page.getViewport({ scale: 1 });
  const scale = maxWidth / viewport1.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function renderPageToCanvasAtScale(pdfJsDoc, pageNumber, scale) {
  const page = await pdfJsDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function extractPdfPageTexts(pdfJsDoc, onProgress) {
  const pages = [];
  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    if (onProgress) onProgress(i, pdfJsDoc.numPages);
    const page = await pdfJsDoc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    pages.push(text.trim());
  }
  return pages;
}

export function parsePageRanges(input, pageCount) {
  const result = new Set();
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let start = parseInt(m[1], 10);
      let end = parseInt(m[2], 10);
      if (start > end) [start, end] = [end, start];
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= pageCount) result.add(i);
      }
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= pageCount) result.add(n);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

// Standard PDF fonts only cover Western text; drawing anything else (Māori macrons, Polish, arrows, CJK) makes pdf-lib throw.
// Swap a letter for its plain form, or "?" when there is none.
// shortcut: non-Western scripts become "?", embed a real font (Liberation is in /assets/vendor/docx/fonts) if that matters.
const LOOKALIKES = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "→": "->", "←": "<-", "✓": "v", "✔": "v" };
export function safeFont(font) {
  const ok = new Set(font.getCharacterSet());
  const clean = (text) => {
    let out = "";
    for (const ch of String(text).normalize("NFC")) {
      const base = ok.has(ch.codePointAt(0)) ? ch : LOOKALIKES[ch] || ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      out += [...base].every((c) => ok.has(c.codePointAt(0))) ? base : "?";
    }
    return out;
  };
  return new Proxy(font, {
    get(target, prop) {
      if (prop === "encodeText") return (text) => target.encodeText(clean(text));
      if (prop === "widthOfTextAtSize") return (text, size) => target.widthOfTextAtSize(clean(text), size);
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function embedSafeFont(doc, standardFont) {
  return safeFont(await doc.embedFont(standardFont));
}

// Draw on a page the way a viewer shows it: crop box applied and /Rotate undone, so the origin is the bottom-left of what
// you see and text stays upright. Everything drawn after this call uses those coordinates until done() is called.
// Returns the shown page size.
export function enterShownSpace(page) {
  const { x: bx, y: by, width: bw, height: bh } = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const m = { 90: [0, 1, -1, 0, bx + bw, by], 180: [-1, 0, 0, -1, bx + bw, by + bh], 270: [0, -1, 1, 0, bx, by + bh] }[rot] || [1, 0, 0, 1, bx, by];
  page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(...m));
  const turned = rot % 180 !== 0;
  return { width: turned ? bh : bw, height: turned ? bw : bh, done: () => page.pushOperators(PDFLib.popGraphicsState()) };
}
