import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";
import { findContentBox } from "/assets/tools/content-box.js";

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
const pageNav = document.getElementById("pageNav");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageLabel = document.getElementById("pageLabel");
const optSame = document.getElementById("optSame");
const fitBtn = document.getElementById("fitBtn");
const fitAllBtn = document.getElementById("fitAllBtn");

const DEFAULT_BOX = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
const MIN_FRAC = 0.03;

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let pageCount = 0;
let pageNo = 1; // 1-based page being shown
let shared = { ...DEFAULT_BOX }; // used for every page without its own crop
const custom = new Map(); // page number -> its own box
let box = { ...DEFAULT_BOX }; // box shown on the current page
let busy = false;
let pageToken = 0;
let loadToken = 0;

function releasePdf() {
  if (pdfJsDoc && pdfJsDoc.loadingTask) pdfJsDoc.loadingTask.destroy();
  pdfJsDoc = null;
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function effectiveBox(page) {
  return optSame.checked ? shared : custom.get(page) || shared;
}

function updateReadout() {
  const note = !optSame.checked && pageCount > 1 ? (custom.has(pageNo) ? " (this page has its own crop)" : " (shared crop, change it to give this page its own)") : "";
  dimsReadout.textContent = `Selection: ${Math.round(box.w * 100)}% × ${Math.round(box.h * 100)}% of the page${note}`;
}

function updateBoxDom(commit = true) {
  cropBox.style.left = box.x * 100 + "%";
  cropBox.style.top = box.y * 100 + "%";
  cropBox.style.width = box.w * 100 + "%";
  cropBox.style.height = box.h * 100 + "%";
  if (commit) {
    if (optSame.checked) shared = { ...box };
    else custom.set(pageNo, { ...box });
  }
  updateReadout();
}

function resetCropBox() {
  box = { ...DEFAULT_BOX };
  updateBoxDom();
}

function updateNav() {
  pageNav.style.display = pageCount > 1 ? "flex" : "none";
  pageLabel.textContent = `Page ${pageNo} of ${pageCount}`;
  prevBtn.disabled = busy || pageNo <= 1;
  nextBtn.disabled = busy || pageNo >= pageCount;
  fitAllBtn.style.display = pageCount > 1 ? "" : "none";
  optSame.closest("label").style.display = pageCount > 1 ? "" : "none";
}

async function showPage(n) {
  const token = ++pageToken;
  pageNo = n;
  updateNav();
  const thumb = await renderPageThumbCanvas(pdfJsDoc, n, 640);
  if (token !== pageToken) return;
  canvas.width = thumb.width;
  canvas.height = thumb.height;
  canvas.getContext("2d").drawImage(thumb, 0, 0);
  box = { ...effectiveBox(n) };
  updateBoxDom(false);
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
  const mine = ++loadToken;

  try {
    releasePdf();
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    pageCount = pdfJsDoc.numPages;
    shared = { ...DEFAULT_BOX };
    custom.clear();
    optSame.checked = true;
    await showPage(1);
    editor.style.display = "block";
    clearStatus(statusEl);
  } catch (err) {
    if (mine !== loadToken) return; // a newer file replaced this one mid-load
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

prevBtn.addEventListener("click", () => { if (pageNo > 1) showPage(pageNo - 1); });
nextBtn.addEventListener("click", () => { if (pageNo < pageCount) showPage(pageNo + 1); });

optSame.addEventListener("change", () => {
  box = { ...effectiveBox(pageNo) };
  updateBoxDom(false);
});

function boxFromContent(thumbCanvas) {
  const found = findContentBox(thumbCanvas);
  if (!found) return null;
  return {
    x: found.left / thumbCanvas.width,
    y: found.top / thumbCanvas.height,
    w: found.width / thumbCanvas.width,
    h: found.height / thumbCanvas.height,
  };
}

fitBtn.addEventListener("click", () => {
  const fitted = boxFromContent(canvas);
  if (!fitted) {
    setStatus(statusEl, "Nothing to trim on this page, the content already fills it.", "");
    statusEl.classList.add("visible");
    return;
  }
  clearStatus(statusEl);
  box = fitted;
  updateBoxDom();
});

fitAllBtn.addEventListener("click", async () => {
  busy = true;
  fitBtn.disabled = fitAllBtn.disabled = runBtn.disabled = true;
  optSame.checked = false;
  let fittedCount = 0;
  try {
    for (let n = 1; n <= pageCount; n++) {
      setStatus(statusEl, `Fitting page ${n} of ${pageCount}…`, "");
      statusEl.classList.add("visible");
      const thumb = await renderPageThumbCanvas(pdfJsDoc, n, 640);
      const fitted = boxFromContent(thumb);
      if (fitted) {
        custom.set(n, fitted);
        fittedCount++;
      } else {
        custom.set(n, { x: 0, y: 0, w: 1, h: 1 });
      }
    }
    busy = false;
    await showPage(pageNo);
    setStatus(statusEl, `Fitted ${fittedCount} of ${pageCount} pages to their content. Flip through to check each one, and drag the corners to adjust.`, "");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    busy = false;
    updateNav();
    fitBtn.disabled = fitAllBtn.disabled = runBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", () => {
  pageToken++;
  loadToken++;
  releasePdf();
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
    doc.getPages().forEach((page, i) => {
      // Work from the visible area (the existing crop box) and undo any /Rotate,
      // because the preview shows the page the way a viewer would turn it.
      const base = page.getCropBox();
      const b = effectiveBox(i + 1);
      const u0 = b.x, u1 = b.x + b.w, v0 = b.y, v1 = b.y + b.h;
      let fx0, fx1, fy0, fy1; // fractions of the unrotated box, y measured from the bottom
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      if (rot === 90) { fx0 = v0; fx1 = v1; fy0 = u0; fy1 = u1; }
      else if (rot === 180) { fx0 = 1 - u1; fx1 = 1 - u0; fy0 = v0; fy1 = v1; }
      else if (rot === 270) { fx0 = 1 - v1; fx1 = 1 - v0; fy0 = 1 - u1; fy1 = 1 - u0; }
      else { fx0 = u0; fx1 = u1; fy0 = 1 - v1; fy1 = 1 - v0; }
      page.setCropBox(base.x + fx0 * base.width, base.y + fy0 * base.height, (fx1 - fx0) * base.width, (fy1 - fy0) * base.height);
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("crop-pdf", stripExtension(currentFile.name), "pdf");
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
