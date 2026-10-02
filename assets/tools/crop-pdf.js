import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const cropStage = document.getElementById("cropStage");
const canvas = document.getElementById("displayCanvas");
const cropBox = document.getElementById("cropBox");
const dimsReadout = document.getElementById("dimsReadout");
const runBtn = document.getElementById("runBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let box = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
const MIN_FRAC = 0.03;

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function updateBoxDom() {
  cropBox.style.left = box.x * 100 + "%";
  cropBox.style.top = box.y * 100 + "%";
  cropBox.style.width = box.w * 100 + "%";
  cropBox.style.height = box.h * 100 + "%";
  dimsReadout.textContent = `Selection: ${Math.round(box.w * 100)}% × ${Math.round(box.h * 100)}% of the page`;
}

function resetCropBox() {
  box = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  updateBoxDom();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());

  try {
    const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    const thumb = await renderPageThumbCanvas(pdfJsDoc, 1, 640);
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    canvas.getContext("2d").drawImage(thumb, 0, 0);
    resetCropBox();
    editor.style.display = "block";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "crop-pdf", dropzone, onFiles: handleFiles });
}

resetBtn.addEventListener("click", resetCropBox);

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

function pointerFrac(e) {
  const rect = cropStage.getBoundingClientRect();
  const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
  return { x, y };
}

let moveState = null;
cropBox.addEventListener("pointerdown", (e) => {
  if (e.target.dataset.handle) return;
  e.preventDefault();
  cropBox.setPointerCapture(e.pointerId);
  const p = pointerFrac(e);
  moveState = { startX: p.x, startY: p.y, boxX: box.x, boxY: box.y };
});
cropBox.addEventListener("pointermove", (e) => {
  if (!moveState) return;
  const p = pointerFrac(e);
  const dx = p.x - moveState.startX;
  const dy = p.y - moveState.startY;
  box.x = clamp(moveState.boxX + dx, 0, 1 - box.w);
  box.y = clamp(moveState.boxY + dy, 0, 1 - box.h);
  updateBoxDom();
});
cropBox.addEventListener("pointerup", () => { moveState = null; });
cropBox.addEventListener("pointercancel", () => { moveState = null; });

let resizeState = null;
cropBox.querySelectorAll(".crop-handle").forEach((handle) => {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    resizeState = { corner: handle.dataset.handle };
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizeState) return;
    const p = pointerFrac(e);
    const corner = resizeState.corner;
    let { x, y, w, h } = box;
    const x0 = x, y0 = y, x1 = x + w, y1 = y + h;

    if (corner === "se") {
      const nx1 = clamp(p.x, x0 + MIN_FRAC, 1);
      const ny1 = clamp(p.y, y0 + MIN_FRAC, 1);
      box = { x: x0, y: y0, w: nx1 - x0, h: ny1 - y0 };
    } else if (corner === "nw") {
      const nx0 = clamp(p.x, 0, x1 - MIN_FRAC);
      const ny0 = clamp(p.y, 0, y1 - MIN_FRAC);
      box = { x: nx0, y: ny0, w: x1 - nx0, h: y1 - ny0 };
    } else if (corner === "ne") {
      const nx1 = clamp(p.x, x0 + MIN_FRAC, 1);
      const ny0 = clamp(p.y, 0, y1 - MIN_FRAC);
      box = { x: x0, y: ny0, w: nx1 - x0, h: y1 - ny0 };
    } else if (corner === "sw") {
      const nx0 = clamp(p.x, 0, x1 - MIN_FRAC);
      const ny1 = clamp(p.y, y0 + MIN_FRAC, 1);
      box = { x: nx0, y: y0, w: x1 - nx0, h: ny1 - y0 };
    }
    updateBoxDom();
  });
  handle.addEventListener("pointerup", () => { resizeState = null; });
  handle.addEventListener("pointercancel", () => { resizeState = null; });
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Cropping…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    doc.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      const cropXpt = box.x * width;
      const cropWpt = box.w * width;
      const cropHpt = box.h * height;
      const cropYpt = height - (box.y + box.h) * height;
      page.setCropBox(cropXpt, cropYpt, cropWpt, cropHpt);
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = `${stripExtension(currentFile.name)}-cropped.pdf`;
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "crop-pdf",
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
    setStatus(statusEl, `Sorted — cropped ${doc.getPageCount()} page${doc.getPageCount() > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
