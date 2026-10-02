import { PDFLib } from "/assets/tools/pdf-common.js";
import * as fflate from "/assets/vendor/fflate.min.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const fileSummary = document.getElementById("fileSummary");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

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
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

function nameOf(dict, key) {
  const v = dict.get(PDFLib.PDFName.of(key));
  return v ? v.toString() : null;
}

function numberOf(dict, key, fallback) {
  const v = dict.get(PDFLib.PDFName.of(key));
  if (!v) return fallback;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : fallback;
}

// Decodes a simple 8-bit DeviceRGB/DeviceGray FlateDecode raster image into RGBA pixels.
// Returns null for anything more exotic (Indexed, ICCBased, CMYK, JPX, CCITT, non-8bpc).
function decodeRasterImage(dict, rawBytes) {
  const filter = nameOf(dict, "Filter");
  if (filter !== "/FlateDecode" && filter !== null) return null;

  const width = numberOf(dict, "Width", 0);
  const height = numberOf(dict, "Height", 0);
  const bpc = numberOf(dict, "BitsPerComponent", 8);
  const colorSpace = nameOf(dict, "ColorSpace");
  if (!width || !height || bpc !== 8) return null;
  if (colorSpace !== "/DeviceRGB" && colorSpace !== "/DeviceGray") return null;

  let pixels;
  try {
    pixels = filter === "/FlateDecode" ? fflate.unzlibSync(rawBytes) : rawBytes;
  } catch (err) {
    return null;
  }

  const channels = colorSpace === "/DeviceRGB" ? 3 : 1;
  if (pixels.length < width * height * channels) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    if (channels === 3) {
      rgba[i * 4] = pixels[p];
      rgba[i * 4 + 1] = pixels[p + 1];
      rgba[i * 4 + 2] = pixels[p + 2];
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = pixels[p];
    }
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

async function rasterToPngBytes(raster) {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(raster.rgba, raster.width, raster.height), 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function extractImages(doc, onProgress) {
  const found = []; // { bytes, ext }
  let skipped = 0;
  const seen = new Set();
  const pages = doc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (onProgress) onProgress(pageIndex + 1, pages.length);
    let resources;
    try {
      resources = pages[pageIndex].node.Resources();
    } catch (err) {
      continue;
    }
    if (!resources) continue;
    const xobjDict = resources.lookup(PDFLib.PDFName.of("XObject"));
    if (!xobjDict) continue;

    for (const key of xobjDict.keys()) {
      const ref = xobjDict.get(key);
      const dedupKey = ref instanceof PDFLib.PDFRef ? ref.toString() : null;
      if (dedupKey) {
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
      }

      const obj = doc.context.lookup(ref);
      if (!obj || !obj.dict || !obj.contents) continue;
      if (nameOf(obj.dict, "Subtype") !== "/Image") continue;

      const filter = nameOf(obj.dict, "Filter");
      if (filter === "/DCTDecode") {
        found.push({ bytes: obj.contents, ext: "jpg" });
        continue;
      }

      const raster = decodeRasterImage(obj.dict, obj.contents);
      if (!raster) {
        skipped++;
        continue;
      }

      const smaskRef = obj.dict.get(PDFLib.PDFName.of("SMask"));
      if (smaskRef) {
        const smaskObj = doc.context.lookup(smaskRef);
        if (smaskObj && smaskObj.dict && smaskObj.contents) {
          const alpha = decodeRasterImage(smaskObj.dict, smaskObj.contents);
          if (alpha && alpha.width === raster.width && alpha.height === raster.height) {
            for (let i = 0; i < raster.width * raster.height; i++) {
              raster.rgba[i * 4 + 3] = alpha.rgba[i * 4];
            }
          }
        }
      }

      const pngBytes = await rasterToPngBytes(raster);
      found.push({ bytes: pngBytes, ext: "png" });
    }
  }

  return { found, skipped };
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Scanning for images…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const { found, skipped } = await extractImages(doc, (i, total) => {
      setStatus(statusEl, `Scanning page ${i} of ${total}…`, "");
    });

    if (found.length === 0) {
      setStatus(
        statusEl,
        skipped > 0
          ? `Found ${skipped} image${skipped > 1 ? "s" : ""}, but none used a supported encoding, nothing to download.`
          : "No embedded images found in this PDF.",
        "error"
      );
      runBtn.disabled = false;
      return;
    }

    const zipInput = {};
    found.forEach((img, i) => {
      const num = String(i + 1).padStart(2, "0");
      zipInput[`image-${num}.${img.ext}`] = img.bytes;
    });
    const zipBytes = fflate.zipSync(zipInput, { level: 6 });
    const blob = new Blob([zipBytes], { type: "application/zip" });
    triggerDownload(blob, brandFilename("extract-pdf-images", stripExtension(currentFile.name), "zip"));

    const skippedNote = skipped > 0 ? `, ${skipped} skipped (unsupported encoding)` : "";
    setStatus(
      statusEl,
      `Sorted — extracted ${found.length} image${found.length > 1 ? "s" : ""}${skippedNote} (${formatBytes(blob.size)}).`,
      "success"
    );
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
