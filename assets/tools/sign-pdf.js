import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";
import { loadSignatureSource, processSignature } from "/assets/tools/signature-image.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const tabDraw = document.getElementById("tabDraw");
const tabType = document.getElementById("tabType");
const tabUpload = document.getElementById("tabUpload");
const drawPane = document.getElementById("drawPane");
const typePane = document.getElementById("typePane");
const uploadPane = document.getElementById("uploadPane");
const sigFile = document.getElementById("sigFile");
const sigUploadPreview = document.getElementById("sigUploadPreview");
const sigUploadWrap = document.getElementById("sigUploadWrap");
const optTransparent = document.getElementById("optTransparent");
const optTrim = document.getElementById("optTrim");
const sigPad = document.getElementById("sigPad");
const clearSigBtn = document.getElementById("clearSigBtn");
const typedName = document.getElementById("typedName");
const typedPreview = document.getElementById("typedPreview");
const widthInput = document.getElementById("sigWidth");
const widthVal = document.getElementById("sigWidthVal");
const resetPlaceBtn = document.getElementById("resetPlaceBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageNumInput = document.getElementById("pageNum");
const pageTotal = document.getElementById("pageTotal");
const placeHint = document.getElementById("placeHint");
const stage = document.getElementById("sigStage");
const pageCanvas = document.getElementById("pageCanvas");
const overlay = document.getElementById("sigOverlay");
const overlayCanvas = document.getElementById("overlayCanvas");
const handle = document.getElementById("sigHandle");

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let pageCount = 0;
let pageIndex = 0;
let pageSize = { w: 595, h: 842 }; // the page as shown (points), so a rotated page is measured the way you see it
let mode = "draw";
let hasDrawing = false;
let uploadSource = null; // the uploaded signature photo, scaled down
let uploadResult = null; // { canvas, transparent } once the options are applied
let sigCanvas = null; // the signature as currently built, trimmed to its ink
let place = { x: 0.62, y: 0.82, w: 0.28 }; // fractions of the shown page: left, top, width
let renderToken = 0;

const MARGIN_FRAC = 0.04;
const MIN_W = 0.05;

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

async function showPage(index) {
  const token = ++renderToken;
  pageIndex = Math.min(Math.max(0, index), pageCount - 1);
  pageNumInput.value = String(pageIndex + 1);
  prevPageBtn.disabled = pageIndex <= 0;
  nextPageBtn.disabled = pageIndex >= pageCount - 1;
  const page = await pdfJsDoc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const canvas = await renderPageThumbCanvas(pdfJsDoc, pageIndex + 1, 760);
  if (token !== renderToken) return;
  pageSize = { w: vp.width, h: vp.height };
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext("2d").drawImage(canvas, 0, 0);
  syncWidthSlider();
  layoutOverlay();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setMsg("Please choose a PDF file.", "error");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());

  try {
    setMsg("Reading your PDF…");
    if (pdfJsDoc && pdfJsDoc.loadingTask) pdfJsDoc.loadingTask.destroy();
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    pageCount = pdfJsDoc.numPages;
    pageNumInput.max = String(pageCount);
    pageTotal.textContent = String(pageCount);
    document.getElementById("pager").style.display = pageCount > 1 ? "flex" : "none";
    resetPlacement();
    editor.style.display = "block";
    await showPage(pageCount > 1 ? pageCount - 1 : 0); // signatures usually go on the last page
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setMsg(`Could not read that PDF: ${err.message || "unknown error"}`, "error");
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "sign-pdf", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  renderToken++;
  if (pdfJsDoc && pdfJsDoc.loadingTask) pdfJsDoc.loadingTask.destroy();
  pdfJsDoc = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

prevPageBtn.addEventListener("click", () => showPage(pageIndex - 1));
nextPageBtn.addEventListener("click", () => showPage(pageIndex + 1));
pageNumInput.addEventListener("change", () => {
  const n = parseInt(pageNumInput.value, 10);
  showPage(Number.isFinite(n) ? n - 1 : pageIndex);
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = {
  draw: { tab: tabDraw, pane: drawPane },
  type: { tab: tabType, pane: typePane },
  upload: { tab: tabUpload, pane: uploadPane },
};
function showTab(name) {
  mode = name;
  for (const [key, { tab, pane }] of Object.entries(TABS)) {
    tab.classList.toggle("active", key === name);
    tab.setAttribute("aria-pressed", String(key === name));
    pane.style.display = key === name ? "block" : "none";
  }
  refreshSignature();
}
tabDraw.addEventListener("click", () => showTab("draw"));
tabType.addEventListener("click", () => showTab("type"));
tabUpload.addEventListener("click", () => showTab("upload"));

// ---------------------------------------------------------------------------
// Draw pad
// ---------------------------------------------------------------------------

const ctx = sigPad.getContext("2d");
ctx.lineWidth = 3;
ctx.lineCap = "round";
ctx.strokeStyle = "#1a1a1a";
let drawing = false;

function padPoint(e) {
  const rect = sigPad.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (sigPad.width / rect.width), y: (e.clientY - rect.top) * (sigPad.height / rect.height) };
}

sigPad.addEventListener("pointerdown", (e) => {
  drawing = true;
  hasDrawing = true;
  sigPad.setPointerCapture(e.pointerId);
  const p = padPoint(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
});
sigPad.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = padPoint(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
});
function endStroke() {
  if (!drawing) return;
  drawing = false;
  refreshSignature();
}
sigPad.addEventListener("pointerup", endStroke);
sigPad.addEventListener("pointercancel", endStroke);

clearSigBtn.addEventListener("click", () => {
  ctx.clearRect(0, 0, sigPad.width, sigPad.height);
  hasDrawing = false;
  refreshSignature();
});

typedName.addEventListener("input", () => {
  typedPreview.textContent = typedName.value;
  refreshSignature();
});

// ---------------------------------------------------------------------------
// Upload a signature picture
// ---------------------------------------------------------------------------

function refreshUploadPreview() {
  if (!uploadSource) return;
  uploadResult = processSignature(uploadSource, { removeBackground: optTransparent.checked, trim: optTrim.checked });
  const { canvas } = uploadResult;
  sigUploadPreview.width = canvas.width;
  sigUploadPreview.height = canvas.height;
  const pctx = sigUploadPreview.getContext("2d");
  pctx.clearRect(0, 0, canvas.width, canvas.height);
  pctx.drawImage(canvas, 0, 0);
  sigUploadWrap.style.display = "block";
  refreshSignature();
}

sigFile.addEventListener("change", async () => {
  const file = sigFile.files && sigFile.files[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    setMsg("Please choose a JPG, PNG or WebP picture of your signature.", "error");
    return;
  }
  try {
    clearStatus(statusEl);
    uploadSource = await loadSignatureSource(file);
    refreshUploadPreview();
  } catch (err) {
    uploadSource = null;
    uploadResult = null;
    sigUploadWrap.style.display = "none";
    setMsg(err.message || "Could not read that picture.", "error");
    refreshSignature();
  }
});
optTransparent.addEventListener("change", refreshUploadPreview);
optTrim.addEventListener("change", refreshUploadPreview);

// ---------------------------------------------------------------------------
// The signature as one image, whichever tab it came from
// ---------------------------------------------------------------------------

function trimToInk(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function buildTypedCanvas() {
  const name = typedName.value.trim();
  if (!name) return null;
  const fontSize = 64;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `600 ${fontSize}px Caveat, cursive`;
  const textWidth = measure.measureText(name).width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textWidth + 40);
  canvas.height = Math.ceil(fontSize * 1.6);
  const c2 = canvas.getContext("2d");
  c2.font = `600 ${fontSize}px Caveat, cursive`;
  c2.fillStyle = "#1a1a1a";
  c2.textBaseline = "middle";
  c2.fillText(name, 20, canvas.height / 2);
  return trimToInk(canvas);
}

function currentSignatureCanvas() {
  if (mode === "draw") return hasDrawing ? trimToInk(sigPad) : null;
  if (mode === "type") return buildTypedCanvas();
  return uploadResult ? uploadResult.canvas : null;
}

function signatureBlob(canvas) {
  // a signature with its paper removed needs the alpha channel (PNG); an untouched photo is smaller as a JPEG
  const useJpeg = mode === "upload" && uploadResult && !uploadResult.transparent;
  return new Promise((resolve) => canvas.toBlob(resolve, useJpeg ? "image/jpeg" : "image/png", 0.92));
}

// ---------------------------------------------------------------------------
// Placing it on the page: drag to move, drag the corner (or use the slider) to resize
// ---------------------------------------------------------------------------

function heightFrac() {
  if (!sigCanvas) return 0;
  return (place.w * pageSize.w * (sigCanvas.height / sigCanvas.width)) / pageSize.h;
}

function clampPlace() {
  place.w = Math.min(0.9, Math.max(MIN_W, place.w));
  // a very tall signature on a short page still has to fit
  const maxByHeight = (1 * pageSize.h) / (pageSize.w * (sigCanvas ? sigCanvas.height / sigCanvas.width : 0.3));
  place.w = Math.min(place.w, maxByHeight);
  place.x = Math.min(Math.max(0, place.x), 1 - place.w);
  place.y = Math.min(Math.max(0, place.y), 1 - heightFrac());
}

function layoutOverlay() {
  if (!sigCanvas) {
    overlay.style.display = "none";
    return;
  }
  clampPlace();
  overlay.style.display = "block";
  overlay.style.left = `${place.x * 100}%`;
  overlay.style.top = `${place.y * 100}%`;
  overlay.style.width = `${place.w * 100}%`;
  syncWidthSlider();
}

function resetPlacement() {
  place = { x: 0, y: 0, w: 0.28 };
  if (sigCanvas) {
    place.x = 1 - MARGIN_FRAC - place.w;
    place.y = 1 - MARGIN_FRAC - heightFrac();
  } else {
    place.x = 1 - MARGIN_FRAC - place.w;
    place.y = 0.82;
  }
  layoutOverlay();
}

function syncWidthSlider() {
  const pts = Math.round(place.w * pageSize.w);
  widthInput.value = String(Math.min(Number(widthInput.max), Math.max(Number(widthInput.min), pts)));
  widthVal.textContent = String(pts);
}

function refreshSignature() {
  const first = !sigCanvas;
  sigCanvas = currentSignatureCanvas();
  if (!sigCanvas) {
    overlay.style.display = "none";
    placeHint.textContent = "Make your signature above first, then drag it to where you need it on the page.";
    return;
  }
  overlayCanvas.width = sigCanvas.width;
  overlayCanvas.height = sigCanvas.height;
  const octx = overlayCanvas.getContext("2d");
  octx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  octx.drawImage(sigCanvas, 0, 0);
  placeHint.textContent = "Drag the signature to where you need it, and drag its corner to resize. Arrow keys nudge it, + and − resize.";
  if (first) resetPlacement();
  else layoutOverlay();
}

function stagePoint(e) {
  const r = stage.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

let drag = null;
overlay.addEventListener("pointerdown", (e) => {
  if (e.target === handle) return;
  e.preventDefault();
  overlay.setPointerCapture(e.pointerId);
  overlay.focus();
  const p = stagePoint(e);
  drag = { type: "move", dx: p.x - place.x, dy: p.y - place.y };
});
overlay.addEventListener("pointermove", (e) => {
  if (!drag || drag.type !== "move") return;
  const p = stagePoint(e);
  place.x = p.x - drag.dx;
  place.y = p.y - drag.dy;
  layoutOverlay();
});
handle.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  handle.setPointerCapture(e.pointerId);
  drag = { type: "resize" };
});
handle.addEventListener("pointermove", (e) => {
  if (!drag || drag.type !== "resize") return;
  const p = stagePoint(e);
  place.w = p.x - place.x;
  layoutOverlay();
});
for (const el of [overlay, handle]) {
  el.addEventListener("pointerup", () => { drag = null; });
  el.addEventListener("pointercancel", () => { drag = null; });
}

overlay.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 0.02 : 0.005;
  let used = true;
  if (e.key === "ArrowLeft") place.x -= step;
  else if (e.key === "ArrowRight") place.x += step;
  else if (e.key === "ArrowUp") place.y -= step;
  else if (e.key === "ArrowDown") place.y += step;
  else if (e.key === "+" || e.key === "=") place.w += step * 2;
  else if (e.key === "-" || e.key === "_") place.w -= step * 2;
  else used = false;
  if (used) {
    e.preventDefault();
    layoutOverlay();
  }
});

widthInput.addEventListener("input", () => {
  place.w = Number(widthInput.value) / pageSize.w;
  layoutOverlay();
});
resetPlaceBtn.addEventListener("click", resetPlacement);

// ---------------------------------------------------------------------------
// Stamp it
// ---------------------------------------------------------------------------

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setMsg("Signing…");

  try {
    refreshSignature();
    if (!sigCanvas) {
      setMsg(mode === "draw" ? "Draw a signature first." : mode === "upload" ? "Add a picture of your signature first." : "Type your name first.", "error");
      return;
    }
    const sigBlob = await signatureBlob(sigCanvas);
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());
    const sigImage = sigBlob.type === "image/jpeg" ? await doc.embedJpg(sigBytes) : await doc.embedPng(sigBytes);

    const pages = doc.getPages();
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    // The preview shows the page the way a viewer does (crop box and rotation applied). Turn the spot you chose back into
    // the page's own coordinates, and turn the signature so it still reads upright.
    const base = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const shownW = rot % 180 === 0 ? base.width : base.height;
    const shownH = rot % 180 === 0 ? base.height : base.width;
    const wPts = place.w * shownW;
    const hPts = wPts * (sigImage.height / sigImage.width);
    const u0 = place.x;
    const v1 = place.y + hPts / shownH; // bottom-left corner of the signature, as fractions from the shown page's top-left
    let x, y;
    if (rot === 90) { x = base.x + v1 * base.width; y = base.y + u0 * base.height; }
    else if (rot === 180) { x = base.x + (1 - u0) * base.width; y = base.y + v1 * base.height; }
    else if (rot === 270) { x = base.x + (1 - v1) * base.width; y = base.y + (1 - u0) * base.height; }
    else { x = base.x + u0 * base.width; y = base.y + (1 - v1) * base.height; }
    page.drawImage(sigImage, { x, y, width: wPts, height: hPts, rotate: PDFLib.degrees(rot) });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("sign-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "sign-pdf",
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
    setMsg(`Sorted — signed page ${pageIndex + 1} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setMsg(`Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
