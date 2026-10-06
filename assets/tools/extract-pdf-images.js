import { PDFLib, pdfjsLib } from "/assets/tools/pdf-common.js";
import * as fflate from "/assets/vendor/fflate.min.js";
import { findContentBox } from "/assets/tools/content-box.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const fileSummary = document.getElementById("fileSummary");
const optTrim = document.getElementById("optTrim");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let session = 0;

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  fileSummary.textContent = `${pdf.name} (${formatBytes(pdf.size)})`;
  editor.style.display = "block";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "extract-pdf-images", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  session++;
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

// ---------------------------------------------------------------------------
// Untouched JPEGs. A plain JPEG inside the PDF is copied out byte for byte, so
// there is no quality loss and no size blow-up. Everything else is decoded by
// pdf.js (ICC colour, palettes, CMYK, JPEG 2000, fax, soft masks, predictors).
// ---------------------------------------------------------------------------

function pdfName(dict, key) {
  const v = dict.get(PDFLib.PDFName.of(key));
  return v ? v.toString() : null;
}

function jpegComponents(bytes) {
  // Walk the markers up to the first SOF to read the component count.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return bytes[i + 9];
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return 0;
}

function rawJpegFor(doc, refText) {
  if (!doc || !refText) return null;
  const m = /^(\d+)R(\d*)$/.exec(refText);
  if (!m) return null;
  try {
    const obj = doc.context.lookup(PDFLib.PDFRef.of(Number(m[1]), m[2] ? Number(m[2]) : 0));
    if (!obj || !obj.dict || !obj.contents) return null;
    const d = obj.dict;
    if (pdfName(d, "Filter") !== "/DCTDecode") return null;
    if (d.has(PDFLib.PDFName.of("SMask")) || d.has(PDFLib.PDFName.of("Mask")) || d.has(PDFLib.PDFName.of("Decode"))) return null;
    const cs = d.get(PDFLib.PDFName.of("ColorSpace"));
    const csText = cs ? cs.toString() : "";
    if (!(csText === "/DeviceRGB" || csText === "/DeviceGray" || csText.startsWith("[/ICCBased"))) return null;
    const bytes = obj.contents;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const comps = jpegComponents(bytes);
    if (comps !== 1 && comps !== 3) return null;
    return bytes;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Turning pdf.js image data into a canvas
// ---------------------------------------------------------------------------

function imageToCanvas(img) {
  const { width, height } = img;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }
  const src = img.data;
  if (!src) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (img.kind === 3 && src.length >= width * height * 4) {
    rgba.set(src.subarray(0, width * height * 4));
  } else if (img.kind === 2 && src.length >= width * height * 3) {
    for (let i = 0, p = 0; i < width * height; i++, p += 3) {
      rgba[i * 4] = src[p];
      rgba[i * 4 + 1] = src[p + 1];
      rgba[i * 4 + 2] = src[p + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else if (img.kind === 1) {
    const rowBytes = (width + 7) >> 3;
    if (src.length < rowBytes * height) return null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = bit ? 255 : 0;
        rgba[i + 3] = 255;
      }
    }
  } else {
    return null;
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("Could not encode an image"));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      type,
      quality
    );
  });
}

function cropCanvas(canvas, box) {
  const out = document.createElement("canvas");
  out.width = box.width;
  out.height = box.height;
  out.getContext("2d").drawImage(canvas, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  return out;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

async function getImageObject(page, name) {
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    store.get(name, (obj) => {
      clearTimeout(timer);
      resolve(obj);
    });
  });
}

async function extractImages(bytes, { trim, onProgress, isCancelled }) {
  const found = []; // { page, bytes, ext, trimmed }
  let skippedMasks = 0;
  let skippedOther = 0;
  let trimmed = 0;
  const seen = new Set();

  let rawDoc = null;
  try {
    rawDoc = await PDFLib.PDFDocument.load(bytes.slice(), { ignoreEncryption: false });
  } catch (err) {
    rawDoc = null; // pdf.js will still decode everything, just without the byte-for-byte JPEG shortcut
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const pdf = await loadingTask.promise;
  const { OPS } = pdfjsLib;

  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      if (isCancelled()) break;
      if (onProgress) onProgress(pageNo, pdf.numPages);
      const page = await pdf.getPage(pageNo);
      const ops = await page.getOperatorList();
      let inlineCount = 0;

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageMask) {
          skippedMasks++;
          continue;
        }
        if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;

        const arg0 = ops.argsArray[i][0];
        let img;
        let key;
        if (typeof arg0 === "string") {
          img = await getImageObject(page, arg0);
          key = img && img.ref ? `ref:${img.ref}` : `obj:${pageNo}:${arg0}`;
        } else {
          img = arg0;
          key = `inline:${pageNo}:${inlineCount++}`;
        }
        if (!img) { skippedOther++; continue; }
        if (seen.has(key)) continue;
        seen.add(key);
        if (!img.width || !img.height || img.width < 2 || img.height < 2) continue;

        let outBytes = null;
        let ext = "png";
        let didTrim = false;

        const rawJpeg = img.ref ? rawJpegFor(rawDoc, img.ref) : null;
        if (rawJpeg && !trim) {
          outBytes = rawJpeg;
          ext = "jpg";
        } else {
          let canvas = imageToCanvas(img);
          if (!canvas) { skippedOther++; continue; }
          if (trim) {
            const box = findContentBox(canvas);
            if (box) {
              canvas = cropCanvas(canvas, box);
              didTrim = true;
            }
          }
          if (rawJpeg && !didTrim) {
            outBytes = rawJpeg;
            ext = "jpg";
          } else if (rawJpeg) {
            outBytes = await canvasToBytes(canvas, "image/jpeg", 0.95);
            ext = "jpg";
          } else {
            outBytes = await canvasToBytes(canvas, "image/png");
          }
          canvas.width = 0;
          canvas.height = 0;
        }
        if (didTrim) trimmed++;
        found.push({ page: pageNo, bytes: outBytes, ext });
      }
      page.cleanup();
    }
  } finally {
    loadingTask.destroy();
  }

  return { found, skippedMasks, skippedOther, trimmed, pages: pdf.numPages };
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const mine = ++session;
  runBtn.disabled = true;
  setStatus(statusEl, "Scanning for images…", "");
  statusEl.classList.add("visible");

  try {
    const { found, skippedMasks, skippedOther, trimmed } = await extractImages(currentBytes, {
      trim: optTrim.checked,
      onProgress: (i, total) => setStatus(statusEl, `Scanning page ${i} of ${total}…`, ""),
      isCancelled: () => mine !== session,
    });
    if (mine !== session) return;

    if (found.length === 0) {
      const skipped = skippedMasks + skippedOther;
      setStatus(
        statusEl,
        skipped > 0
          ? `Found ${skipped} image${skipped > 1 ? "s" : ""}, but none could be turned into a picture file, nothing to download.`
          : "No embedded images found in this PDF. If the pages are drawn as text and shapes, try PDF to Images instead.",
        "error"
      );
      return;
    }

    const perPage = new Map();
    const zipInput = {};
    for (const img of found) {
      const n = (perPage.get(img.page) || 0) + 1;
      perPage.set(img.page, n);
      const name = `page-${String(img.page).padStart(2, "0")}-image-${String(n).padStart(2, "0")}.${img.ext}`;
      zipInput[name] = img.bytes;
    }
    const zipBytes = fflate.zipSync(zipInput, { level: 6 });
    const blob = new Blob([zipBytes], { type: "application/zip" });
    triggerDownload(blob, brandFilename("extract-pdf-images", stripExtension(currentFile.name), "zip"));

    const notes = [];
    if (trimmed > 0) notes.push(`trimmed ${trimmed}`);
    if (skippedMasks > 0) notes.push(`${skippedMasks} one-colour mask${skippedMasks > 1 ? "s" : ""} left out`);
    if (skippedOther > 0) notes.push(`${skippedOther} couldn't be read`);
    setStatus(
      statusEl,
      `Sorted — extracted ${found.length} image${found.length > 1 ? "s" : ""}${notes.length ? ` (${notes.join(", ")})` : ""}, ${formatBytes(blob.size)} ZIP.`,
      "success"
    );
  } catch (err) {
    console.error(err);
    if (err && err.name === "PasswordException") {
      setStatus(statusEl, "This PDF is password protected. Unlock it with Unlock PDF first, then try again.", "error");
    } else {
      setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
    }
  } finally {
    runBtn.disabled = false;
  }
});
