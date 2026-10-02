import { PDFLib, loadPdfJsDoc, renderPageToCanvasAtScale } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const strongControls = document.getElementById("strongControls");
const strongNote = document.getElementById("strongNote");
const qualityInput = document.getElementById("quality");
const qualityVal = document.getElementById("qualityVal");
const dpiSelect = document.getElementById("dpi");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const resultItem = document.getElementById("resultItem");

let currentFile = null;
let currentBytes = null;

async function loadFile(pdf) {
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  editor.style.display = "block";
  resultsEl.classList.remove("visible");
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  await loadFile(pdf);
});

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "compress-pdf", dropzone, onFiles: (files) => loadFile(files[0]) });
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const strong = document.querySelector('input[name="mode"]:checked').value === "strong";
    strongControls.style.display = strong ? "flex" : "none";
    strongNote.style.display = strong ? "block" : "none";
  });
});

qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; });

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  resultsEl.classList.remove("visible");
  clearStatus(statusEl);
});

async function compressFast(bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes);
  return doc.save({ useObjectStreams: true });
}

async function compressStrong(bytes, quality, dpi) {
  const pdfJsDoc = await loadPdfJsDoc(bytes.slice());
  const out = await PDFLib.PDFDocument.create();
  const scale = dpi / 72;

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    setStatus(statusEl, `Compressing page ${i} of ${pdfJsDoc.numPages}…`, "");
    const page = await pdfJsDoc.getPage(i);
    const viewport1 = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvasAtScale(pdfJsDoc, i, scale);
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    const jpgBytes = new Uint8Array(await blob.arrayBuffer());
    const jpgImage = await out.embedJpg(jpgBytes);
    const pdfPage = out.addPage([viewport1.width, viewport1.height]);
    pdfPage.drawImage(jpgImage, { x: 0, y: 0, width: viewport1.width, height: viewport1.height });
  }

  return out.save();
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  runBtn.disabled = true;
  resultsEl.classList.remove("visible");
  setStatus(statusEl, "Compressing…", "");
  statusEl.classList.add("visible");

  try {
    let outBytes;
    if (mode === "fast") {
      outBytes = await compressFast(currentBytes.slice());
    } else {
      const quality = Number(qualityInput.value) / 100;
      const dpi = Number(dpiSelect.value);
      outBytes = await compressStrong(currentBytes.slice(), quality, dpi);
    }
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const originalSize = currentFile.size;
    const newSize = blob.size;
    const savings = originalSize > 0 ? Math.round((1 - newSize / originalSize) * 100) : 0;
    const outName = `${stripExtension(currentFile.name)}-compressed.pdf`;

    resultItem.innerHTML = `
      <div class="info">
        <div>${outName}</div>
        <div class="meta" style="color:var(--text-muted);font-size:0.85rem;">
          ${formatBytes(originalSize)} → ${formatBytes(newSize)}
          ${savings > 0 ? `<span class="savings">(&minus;${savings}%)</span>` : savings < 0 ? " (larger than original)" : ""}
        </div>
      </div>
    `;
    const dlBtn = document.createElement("button");
    dlBtn.className = "btn small";
    dlBtn.textContent = "Download";
    dlBtn.addEventListener("click", () => triggerDownload(blob, outName));
    resultItem.appendChild(dlBtn);
    resultsEl.classList.add("visible");

    setStatus(statusEl, savings > 0 ? `Sorted — reduced file size by ${savings}%.` : "Sorted — this PDF was already well optimized.", "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "compress-pdf",
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
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
