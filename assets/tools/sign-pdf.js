import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const tabDraw = document.getElementById("tabDraw");
const tabType = document.getElementById("tabType");
const drawPane = document.getElementById("drawPane");
const typePane = document.getElementById("typePane");
const sigPad = document.getElementById("sigPad");
const clearSigBtn = document.getElementById("clearSigBtn");
const typedName = document.getElementById("typedName");
const typedPreview = document.getElementById("typedPreview");
const positionSelect = document.getElementById("sigPosition");
const widthInput = document.getElementById("sigWidth");
const widthVal = document.getElementById("sigWidthVal");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let selectedPageIndex = 0;
let mode = "draw";
let hasDrawing = false;

const MARGIN = 24;

// --- Page thumbnails ---
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
    setStatus(statusEl, "Rendering pages…", "");
    statusEl.classList.add("visible");
    const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    pageGrid.innerHTML = "";
    selectedPageIndex = 0;

    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 160);
      const thumb = document.createElement("div");
      thumb.className = "page-thumb" + (i === 1 ? " selected" : "");
      thumb.dataset.pageIndex = String(i - 1);
      thumb.innerHTML = `<span class="page-num">${i}</span>`;
      thumb.appendChild(canvas);
      thumb.addEventListener("click", () => {
        selectedPageIndex = i - 1;
        pageGrid.querySelectorAll(".page-thumb").forEach((el) => el.classList.remove("selected"));
        thumb.classList.add("selected");
      });
      pageGrid.appendChild(thumb);
    }

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
  KeepSorted.init({ currentTool: "sign-pdf", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

// --- Tabs ---
tabDraw.addEventListener("click", () => {
  mode = "draw";
  tabDraw.classList.add("active");
  tabType.classList.remove("active");
  drawPane.style.display = "block";
  typePane.style.display = "none";
});
tabType.addEventListener("click", () => {
  mode = "type";
  tabType.classList.add("active");
  tabDraw.classList.remove("active");
  drawPane.style.display = "none";
  typePane.style.display = "block";
});

// --- Draw pad ---
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
sigPad.addEventListener("pointerup", () => { drawing = false; });
sigPad.addEventListener("pointercancel", () => { drawing = false; });

clearSigBtn.addEventListener("click", () => {
  ctx.clearRect(0, 0, sigPad.width, sigPad.height);
  hasDrawing = false;
});

typedName.addEventListener("input", () => {
  typedPreview.textContent = typedName.value;
});

widthInput.addEventListener("input", () => { widthVal.textContent = widthInput.value; });

// --- Build signature image (transparent PNG) ---
async function getSignatureBlob() {
  if (mode === "draw") {
    if (!hasDrawing) return null;
    return new Promise((resolve) => sigPad.toBlob(resolve, "image/png"));
  }
  const name = typedName.value.trim();
  if (!name) return null;
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  const fontSize = 64;
  mctx.font = `600 ${fontSize}px Caveat, cursive`;
  const textWidth = mctx.measureText(name).width;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textWidth + 40);
  canvas.height = Math.ceil(fontSize * 1.6);
  const c2 = canvas.getContext("2d");
  c2.font = `600 ${fontSize}px Caveat, cursive`;
  c2.fillStyle = "#1a1a1a";
  c2.textBaseline = "middle";
  c2.fillText(name, 20, canvas.height / 2);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Signing…", "");
  statusEl.classList.add("visible");

  try {
    const sigBlob = await getSignatureBlob();
    if (!sigBlob) {
      setStatus(statusEl, mode === "draw" ? "Draw a signature first." : "Type your name first.", "error");
      runBtn.disabled = false;
      return;
    }

    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());
    const sigImage = await doc.embedPng(sigBytes);
    const aspect = sigImage.height / sigImage.width;
    const targetWidth = Number(widthInput.value);
    const targetHeight = targetWidth * aspect;

    const pages = doc.getPages();
    const page = pages[Math.min(selectedPageIndex, pages.length - 1)];
    const { width, height } = page.getSize();
    const position = positionSelect.value;

    let x, y;
    if (position.endsWith("center")) x = width / 2 - targetWidth / 2;
    else if (position.endsWith("right")) x = width - MARGIN - targetWidth;
    else x = MARGIN;
    y = position.startsWith("top") ? height - MARGIN - targetHeight : MARGIN;

    page.drawImage(sigImage, { x, y, width: targetWidth, height: targetHeight });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = `${stripExtension(currentFile.name)}-signed.pdf`;
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
    setStatus(statusEl, `Sorted — signed (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
