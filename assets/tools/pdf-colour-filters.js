import { loadPdfJsDoc, renderPageToCanvasAtScale, PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const canvas = document.getElementById("displayCanvas");
const ctx = canvas.getContext("2d");
const invertInput = document.getElementById("invert");
const grayscaleInput = document.getElementById("grayscale");
const brightnessInput = document.getElementById("brightness");
const contrastInput = document.getElementById("contrast");
const saturateInput = document.getElementById("saturate");
const grayscaleVal = document.getElementById("grayscaleVal");
const brightnessVal = document.getElementById("brightnessVal");
const contrastVal = document.getElementById("contrastVal");
const saturateVal = document.getElementById("saturateVal");
const resetBtn = document.getElementById("resetFilters");
const dpiSelect = document.getElementById("dpi");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let previewImg = null;

const sliders = [
  [grayscaleInput, grayscaleVal],
  [brightnessInput, brightnessVal],
  [contrastInput, contrastVal],
  [saturateInput, saturateVal],
];

function currentFilterString() {
  return [
    invertInput.checked ? "invert(100%)" : "",
    `grayscale(${grayscaleInput.value}%)`,
    `brightness(${brightnessInput.value}%)`,
    `contrast(${contrastInput.value}%)`,
    `saturate(${saturateInput.value}%)`,
  ].filter(Boolean).join(" ");
}

function renderPreview() {
  if (!previewImg) return;
  ctx.save();
  ctx.filter = currentFilterString();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(previewImg, 0, 0);
  ctx.restore();
}

invertInput.addEventListener("change", renderPreview);
sliders.forEach(([input, out]) => {
  input.addEventListener("input", () => {
    out.textContent = input.value;
    renderPreview();
  });
});

resetBtn.addEventListener("click", () => {
  invertInput.checked = false;
  grayscaleInput.value = 0;
  brightnessInput.value = 100;
  contrastInput.value = 100;
  saturateInput.value = 100;
  sliders.forEach(([input, out]) => { out.textContent = input.value; });
  renderPreview();
});

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  try {
    currentBytes = new Uint8Array(await pdf.arrayBuffer());
    const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    const previewCanvas = await renderPageToCanvasAtScale(pdfJsDoc, 1, 1.2);
    previewImg = previewCanvas;
    canvas.width = previewCanvas.width;
    canvas.height = previewCanvas.height;
    resetBtn.click();
    editor.style.display = "block";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  previewImg = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Applying filters…", "");
  statusEl.classList.add("visible");

  try {
    const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const scale = Number(dpiSelect.value) / 72;
    const filterString = currentFilterString();

    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      setStatus(statusEl, `Rendering page ${i} of ${pdfJsDoc.numPages}…`, "");
      const page = await pdfJsDoc.getPage(i);
      const viewport1 = page.getViewport({ scale: 1 });
      const rendered = await renderPageToCanvasAtScale(pdfJsDoc, i, scale);

      const filtered = document.createElement("canvas");
      filtered.width = rendered.width;
      filtered.height = rendered.height;
      const fctx = filtered.getContext("2d");
      fctx.filter = filterString;
      fctx.drawImage(rendered, 0, 0);

      const blob = await canvasToBlob(filtered, "image/jpeg", 0.88);
      const jpgBytes = new Uint8Array(await blob.arrayBuffer());
      const jpgImage = await out.embedJpg(jpgBytes);
      const pdfPage = out.addPage([viewport1.width, viewport1.height]);
      pdfPage.drawImage(jpgImage, { x: 0, y: 0, width: viewport1.width, height: viewport1.height });
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-filtered.pdf`);
    setStatus(statusEl, `Sorted — filtered ${pdfJsDoc.numPages} page${pdfJsDoc.numPages > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
