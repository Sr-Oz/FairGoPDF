import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, renderPageToCanvasAtScale } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const stage = document.getElementById("redactStage");
const clearPageBtn = document.getElementById("clearPageBtn");
const redactSummary = document.getElementById("redactSummary");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PREVIEW_WIDTH = 700;
const OUTPUT_SCALE = 2.5; // render scale for the final rasterized (redacted) pages

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let pageCount = 0;
let selectedPageIndex = 0;

// pageIndex (0-based) -> array of { x, y, w, h } in PDF point space (origin bottom-left)
const redactions = new Map();

let stageScale = 1;
let stageWidthPt = 0;
let stageHeightPt = 0;
let baseCanvas = null;
let dragStartPx = null;

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  redactions.clear();

  try {
    setStatus(statusEl, "Rendering pages…", "");
    statusEl.classList.add("visible");
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    pageCount = pdfJsDoc.numPages;
    pageGrid.innerHTML = "";
    selectedPageIndex = 0;

    for (let i = 1; i <= pageCount; i++) {
      const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 160);
      const thumb = document.createElement("div");
      thumb.className = "page-thumb" + (i === 1 ? " selected" : "");
      thumb.dataset.pageIndex = String(i - 1);
      thumb.innerHTML = `<span class="page-num">${i}</span><span class="redact-badge"></span>`;
      thumb.appendChild(canvas);
      thumb.addEventListener("click", () => selectPage(i - 1));
      pageGrid.appendChild(thumb);
    }

    editor.style.display = "block";
    clearStatus(statusEl);
    await selectPage(0);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "redact-pdf", dropzone, onFiles: handleFiles });
}

async function selectPage(index) {
  selectedPageIndex = index;
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.pageIndex) === index);
  });

  const page = await pdfJsDoc.getPage(index + 1);
  const viewport1 = page.getViewport({ scale: 1 });
  stageWidthPt = viewport1.width;
  stageHeightPt = viewport1.height;
  stageScale = PREVIEW_WIDTH / viewport1.width;

  baseCanvas = await renderPageToCanvasAtScale(pdfJsDoc, index + 1, stageScale);
  stage.width = baseCanvas.width;
  stage.height = baseCanvas.height;
  redrawStage();
}

function redrawStage(liveRectPx) {
  const ctx = stage.getContext("2d");
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.strokeStyle = "#d33";
  ctx.lineWidth = 1;

  const rects = redactions.get(selectedPageIndex) || [];
  for (const r of rects) {
    const px = r.x * stageScale;
    const pw = r.w * stageScale;
    const ph = r.h * stageScale;
    const py = stage.height - (r.y * stageScale) - ph;
    ctx.fillRect(px, py, pw, ph);
  }

  if (liveRectPx) {
    ctx.strokeRect(liveRectPx.x, liveRectPx.y, liveRectPx.w, liveRectPx.h);
  }
}

function stagePoint(e) {
  const rect = stage.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (stage.width / rect.width),
    y: (e.clientY - rect.top) * (stage.height / rect.height),
  };
}

stage.addEventListener("pointerdown", (e) => {
  if (!baseCanvas) return;
  dragStartPx = stagePoint(e);
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener("pointermove", (e) => {
  if (!dragStartPx) return;
  const p = stagePoint(e);
  const x = Math.min(dragStartPx.x, p.x);
  const y = Math.min(dragStartPx.y, p.y);
  const w = Math.abs(p.x - dragStartPx.x);
  const h = Math.abs(p.y - dragStartPx.y);
  redrawStage({ x, y, w, h });
});

stage.addEventListener("pointerup", (e) => {
  if (!dragStartPx) return;
  const p = stagePoint(e);
  const xPx = Math.min(dragStartPx.x, p.x);
  const yPx = Math.min(dragStartPx.y, p.y);
  const wPx = Math.abs(p.x - dragStartPx.x);
  const hPx = Math.abs(p.y - dragStartPx.y);
  dragStartPx = null;

  if (wPx < 4 || hPx < 4) {
    redrawStage();
    return;
  }

  const xPt = xPx / stageScale;
  const wPt = wPx / stageScale;
  const hPt = hPx / stageScale;
  const yPt = stageHeightPt - (yPx / stageScale) - hPt;

  if (!redactions.has(selectedPageIndex)) redactions.set(selectedPageIndex, []);
  redactions.get(selectedPageIndex).push({ x: xPt, y: yPt, w: wPt, h: hPt });
  redrawStage();
  updateBadgesAndSummary();
});

clearPageBtn.addEventListener("click", () => {
  redactions.delete(selectedPageIndex);
  redrawStage();
  updateBadgesAndSummary();
});

function updateBadgesAndSummary() {
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    const idx = Number(el.dataset.pageIndex);
    el.classList.toggle("has-redactions", redactions.has(idx) && redactions.get(idx).length > 0);
  });
  const markedPages = Array.from(redactions.values()).filter((r) => r.length > 0).length;
  const totalBoxes = Array.from(redactions.values()).reduce((sum, r) => sum + r.length, 0);
  redactSummary.textContent = markedPages
    ? `${totalBoxes} redaction box${totalBoxes > 1 ? "es" : ""} marked across ${markedPages} page${markedPages > 1 ? "s" : ""}.`
    : "No redaction boxes marked yet.";
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pdfJsDoc = null;
  pageCount = 0;
  redactions.clear();
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const markedPages = Array.from(redactions.entries()).filter(([, r]) => r.length > 0);
  if (markedPages.length === 0) {
    setStatus(statusEl, "Draw at least one redaction box first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Redacting…", "");
  statusEl.classList.add("visible");

  try {
    const srcDoc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const outDoc = await PDFLib.PDFDocument.create();
    const srcPages = srcDoc.getPages();

    for (let i = 0; i < srcPages.length; i++) {
      const rects = redactions.get(i);

      if (rects && rects.length) {
        setStatus(statusEl, `Flattening page ${i + 1} of ${srcPages.length}…`, "");
        const canvas = await renderPageToCanvasAtScale(pdfJsDoc, i + 1, OUTPUT_SCALE);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000000";
        for (const r of rects) {
          const px = r.x * OUTPUT_SCALE;
          const pw = r.w * OUTPUT_SCALE;
          const ph = r.h * OUTPUT_SCALE;
          const py = canvas.height - (r.y * OUTPUT_SCALE) - ph;
          ctx.fillRect(px, py, pw, ph);
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const pngBytes = new Uint8Array(await blob.arrayBuffer());
        const image = await outDoc.embedPng(pngBytes);
        // Size the new page from the rendered view (it honours a crop box and rotation),
        // not the raw media box, otherwise a cropped page would be stretched to fit.
        const width = canvas.width / OUTPUT_SCALE;
        const height = canvas.height / OUTPUT_SCALE;
        const outPage = outDoc.addPage([width, height]);
        outPage.drawImage(image, { x: 0, y: 0, width, height });
      } else {
        const [copied] = await outDoc.copyPages(srcDoc, [i]);
        outDoc.addPage(copied);
      }
    }

    const bytes = await outDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("redact-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "redact-pdf",
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
    setStatus(
      statusEl,
      `Sorted — redacted ${markedPages.length} page${markedPages.length > 1 ? "s" : ""} (${formatBytes(blob.size)}).`,
      "success"
    );
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
