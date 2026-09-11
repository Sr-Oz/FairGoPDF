import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const previewWrap = document.getElementById("previewWrap");
const angleSlider = document.getElementById("angleSlider");
const angleNumber = document.getElementById("angleNumber");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let previewCanvas = null;

function setAngle(value) {
  const clamped = Math.max(-45, Math.min(45, Number(value) || 0));
  angleSlider.value = String(clamped);
  angleNumber.value = String(clamped);
  if (previewCanvas) previewCanvas.style.transform = `rotate(${clamped}deg)`;
}

angleSlider.addEventListener("input", () => setAngle(angleSlider.value));
angleNumber.addEventListener("input", () => setAngle(angleNumber.value));

async function loadFile(file) {
  currentFile = file;
  currentBytes = new Uint8Array(await file.arrayBuffer());
  setStatus(statusEl, "Rendering preview…", "");
  statusEl.classList.add("visible");

  const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
  previewCanvas = await renderPageThumbCanvas(pdfJsDoc, 1, 320);
  previewWrap.innerHTML = "";
  previewWrap.appendChild(previewCanvas);
  editor.style.display = "block";
  setAngle(0);
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  previewCanvas = null;
  editor.style.display = "none";
  previewWrap.innerHTML = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const angleDeg = Number(angleNumber.value) || 0;
  if (angleDeg === 0) {
    setStatus(statusEl, "Set an angle first — 0° would just be a copy of the original.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Rotating pages…", "");
  statusEl.classList.add("visible");

  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const srcPages = src.getPages();

    // CSS's rotate() is clockwise for a positive angle; PDFLib.degrees() follows the
    // standard counterclockwise-positive math convention, so the sign flips here to
    // keep the live preview and the saved file rotating the same way.
    const theta = (-angleDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(theta));
    const sin = Math.abs(Math.sin(theta));

    for (let i = 0; i < srcPages.length; i++) {
      setStatus(statusEl, `Rotating page ${i + 1} of ${srcPages.length}…`, "");
      const { width: w, height: h } = srcPages[i].getSize();
      const newW = w * cos + h * sin;
      const newH = w * sin + h * cos;

      const embedded = await out.embedPage(srcPages[i]);
      const outPage = out.addPage([newW, newH]);
      outPage.drawRectangle({ x: 0, y: 0, width: newW, height: newH, color: PDFLib.rgb(1, 1, 1) });

      // Rotating about the page's own local origin lands the local center at this
      // point; solving for (x,y) so that point ends up at the new page's center.
      const rotCenterX = (w / 2) * Math.cos(theta) - (h / 2) * Math.sin(theta);
      const rotCenterY = (w / 2) * Math.sin(theta) + (h / 2) * Math.cos(theta);
      const x = newW / 2 - rotCenterX;
      const y = newH / 2 - rotCenterY;

      outPage.drawPage(embedded, { x, y, rotate: PDFLib.radians(theta) });
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-rotated.pdf`);
    setStatus(statusEl, `Sorted — rotated ${srcPages.length} page(s) by ${angleDeg}° (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
