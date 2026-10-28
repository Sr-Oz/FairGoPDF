// Reads what PDF to Word needs out of a PDF: the positioned text with its fonts, the links, and the pictures with where each
// one sits. The structure is worked out afterwards in pdf-layout.js; this file only talks to pdf.js.
import { pdfjsLib, breathe } from "/assets/tools/pdf-common.js";
import { fontStyleOf } from "/assets/tools/pdf-layout.js";
import { imageToCanvas, canvasToBytes, getImageObject } from "/assets/tools/pdf-image-objects.js";

const { Util, OPS } = pdfjsLib;
const MAX_IMAGE_SIDE = 2000; // larger pictures are scaled down so the Word file stays a sensible size
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

// what pdf.js knows of a font by the id it gives text items: the real name when it has loaded, else nothing
function fontLookup(page) {
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    let info = { family: null, bold: false, italic: false };
    try {
      const f = page.commonObjs.get(id);
      info = fontStyleOf(f && (f.name || f.fallbackName));
      if (f && f.bold) info.bold = true;
      if (f && f.italic) info.italic = true;
    } catch (err) {
      // not loaded, so the text keeps the default look
    }
    cache.set(id, info);
    return info;
  };
}

// a picture as file bytes: PNG when it has see-through parts or few colours (a logo, a chart), JPEG for photographs
async function encodeImage(img) {
  let canvas = imageToCanvas(img);
  if (!canvas) return null;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(canvas.width, canvas.height));
  if (scale < 1) {
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
    canvas = small;
  }
  const { width, height } = canvas;
  const sample = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const colours = new Set();
  let see = false;
  const step = Math.max(1, Math.floor(sample.length / 4 / 4000)) * 4;
  for (let i = 0; i < sample.length; i += step) {
    if (sample[i + 3] < 250) see = true;
    if (colours.size < 300) colours.add((sample[i] >> 3) << 10 | (sample[i + 1] >> 3) << 5 | (sample[i + 2] >> 3));
  }
  const png = see || colours.size < 200;
  const bytes = await canvasToBytes(canvas, png ? "image/png" : "image/jpeg", 0.9);
  canvas.width = canvas.height = 0;
  return { bytes, ext: png ? "png" : "jpg", pxW: width, pxH: height };
}

function boxOf(m) {
  const xs = [0, 1, 0, 1].map((u, i) => m[0] * u + m[2] * (i >> 1) + m[4]);
  const ys = [0, 1, 0, 1].map((u, i) => m[1] * u + m[3] * (i >> 1) + m[5]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// the pictures painted on a page, each with its box on the page. The matrix at the moment of painting says where it went.
async function pagePictures(page, ops, viewport, files, pageNo) {
  const found = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let inline = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = Util.transform(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && found.length < 60) {
      const named = typeof args[0] === "string";
      const img = named ? await getImageObject(page, args[0]) : args[0];
      if (!img || !img.width || !img.height || img.width < 4 || img.height < 4) continue;
      const sig = named ? `${img.ref || args[0]}:${img.width}x${img.height}` : `inline:${pageNo}:${inline++}:${img.width}x${img.height}`;
      if (!files.has(sig)) files.set(sig, await encodeImage(img));
      if (!files.get(sig)) continue;
      found.push({ id: sig, sig, ...boxOf(Util.transform(viewport.transform, ctm)) });
    }
  }
  return found;
}

// pageNumbers: 1-based, in order. -> { pages, images (Map: id -> { bytes, ext, pxW, pxH }), title, author }
export async function extractPages(doc, pageNumbers, { images = true, links = true, onProgress, isCancelled = () => false } = {}) {
  const files = new Map();
  const pages = [];
  for (const [n, pageNo] of pageNumbers.entries()) {
    if (isCancelled()) break;
    if (onProgress) onProgress(n + 1, pageNumbers.length);
    await breathe();
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const ops = await page.getOperatorList(); // loads the page's fonts, so their real names can be read
    const font = fontLookup(page);

    const items = [];
    const rotated = [];
    for (const it of content.items) {
      if (typeof it.str !== "string" || it.str === "") continue;
      const m = Util.transform(viewport.transform, it.transform);
      const size = Math.hypot(m[0], m[1]);
      if (!(size > 0)) continue;
      if (Math.abs(m[1]) > 0.2 * Math.abs(m[0]) || m[0] < 0) { rotated.push(it.str); continue; } // sideways or upside-down text
      const f = font(it.fontName);
      items.push({ str: it.str.replace(/ /g, " "), x: m[4], y: m[5], w: it.width * (size / Math.hypot(it.transform[0], it.transform[1]) || 1), size, bold: f.bold, italic: f.italic, family: f.family, link: null });
    }

    if (links) {
      try {
        for (const a of await page.getAnnotations({ intent: "display" })) {
          const url = a.url || a.unsafeUrl;
          if (a.subtype !== "Link" || !url || !SAFE_LINK.test(url)) continue;
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
          const [left, right, top, bottom] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
          for (const it of items) {
            const cx = it.x + it.w / 2;
            const cy = it.y - it.size * 0.3;
            if (cx >= left - 1 && cx <= right + 1 && cy >= top - 1 && cy <= bottom + 1) it.link = url;
          }
        }
      } catch (err) {
        // links are a nicety, the text is still read
      }
    }

    const pictures = images ? await pagePictures(page, ops, viewport, files, pageNo) : [];
    pages.push({ number: pageNo, width: viewport.width, height: viewport.height, items, images: pictures, rotated: rotated.join(" ").replace(/\s+/g, " ").trim() });
    page.cleanup();
  }
  let title = "";
  let author = "";
  try {
    const meta = await doc.getMetadata();
    title = (meta.info && meta.info.Title) || "";
    author = (meta.info && meta.info.Author) || "";
  } catch (err) {
    // no metadata
  }
  // only the pictures that made it onto a page are kept
  for (const sig of [...files.keys()]) if (!pages.some((p) => p.images.some((im) => im.sig === sig))) files.delete(sig);
  return { pages, images: files, title, author };
}
