import { PDFLib } from "/assets/tools/pdf-common.js";
import { renderFileCards } from "/assets/tools/file-cards.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const controls = document.getElementById("controls");
const actionsRow = document.getElementById("actionsRow");
const pageSizeSelect = document.getElementById("pageSize");
const marginField = document.getElementById("marginField");
const marginInput = document.getElementById("margin");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

// Each entry is { file, canvas, failed }: the picture on its card arrives once the browser has read the image.
let files = [];

// A small copy for the card, so a folder of 12-megapixel photos doesn't sit in memory at full size.
// "none": the card shows the picture the way it is stored, which is how it goes into the PDF (pdf-lib ignores the camera's rotation flag).
async function loadPreview(entry) {
  try {
    const bitmap = await createImageBitmap(entry.file, { resizeWidth: 240, resizeQuality: "medium", imageOrientation: "none" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    entry.canvas = canvas;
  } catch (err) {
    entry.failed = true; // the browser couldn't read it; the PDF step will say so
  }
  if (files.includes(entry)) renderFileList();
}

function renderFileList() {
  renderFileCards(fileListEl, files, {
    detail: (entry) => formatBytes(entry.file.size),
    icon: "image",
    onChange: renderFileList,
  });
  const hasFiles = files.length > 0;
  controls.style.display = hasFiles ? "flex" : "none";
  actionsRow.style.display = hasFiles ? "flex" : "none";
  clearStatus(statusEl);
}

function addFiles(newFiles) {
  const images = newFiles.filter((f) => f.type === "image/jpeg" || f.type === "image/png");
  if (images.length !== newFiles.length) {
    setStatus(statusEl, "Only JPEG and PNG images are supported for this tool.", "error");
    statusEl.classList.add("visible");
  }
  const entries = images.map((file) => ({ file, canvas: null, failed: false }));
  files = files.concat(entries);
  renderFileList();
  // one at a time, so a big batch doesn't decode every photo at once
  (async () => {
    for (const entry of entries) if (files.includes(entry)) await loadPreview(entry);
  })();
}

initDropzone(dropzone, fileInput, addFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "images-to-pdf", dropzone, onFiles: addFiles });
}

pageSizeSelect.addEventListener("change", () => {
  marginField.style.display = pageSizeSelect.value === "fit" ? "none" : "flex";
});
marginField.style.display = "none";

clearBtn.addEventListener("click", () => { files = []; renderFileList(); });

runBtn.addEventListener("click", async () => {
  if (!files.length) return;
  runBtn.disabled = true;
  setStatus(statusEl, `Building PDF from ${files.length} image${files.length > 1 ? "s" : ""}…`, "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.create();
    const mode = pageSizeSelect.value;
    const margin = Number(marginInput.value) || 0;

    for (const { file } of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const image = file.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const { width: imgW, height: imgH } = image;

      if (mode === "fit") {
        // 96 CSS px per inch, 72pt per inch
        const pw = imgW * 0.75;
        const ph = imgH * 0.75;
        const page = doc.addPage([pw, ph]);
        page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      } else {
        const [pw, ph] = PAGE_SIZES[mode];
        const page = doc.addPage([pw, ph]);
        const availW = pw - margin * 2;
        const availH = ph - margin * 2;
        const scale = Math.min(availW / imgW, availH / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const x = (pw - drawW) / 2;
        const y = (ph - drawH) / 2;
        page.drawImage(image, { x, y, width: drawW, height: drawH });
      }
    }

    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const outName = brandFilename("images-to-pdf", "images", "pdf");
    triggerDownload(blob, outName);

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "images-to-pdf",
        blob,
        filename: outName,
        els: {
          section: document.getElementById("keepSorted"),
          list: document.getElementById("keepSortedList"),
          resetLink: document.getElementById("keepSortedReset"),
        },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Sorted — created a ${formatBytes(blob.size)} PDF with ${files.length} page${files.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
