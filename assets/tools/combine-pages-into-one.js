import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const gapInput = document.getElementById("gapInput");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  editor.style.display = "block";
  clearStatus(statusEl);
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Stitching pages…", "");
  statusEl.classList.add("visible");

  try {
    const gap = Math.max(0, Number(gapInput.value) || 0);
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const srcPages = src.getPages();
    const targetWidth = srcPages[0].getSize().width;

    const dims = srcPages.map((p) => {
      const { width, height } = p.getSize();
      const scale = targetWidth / width;
      return { scale, scaledHeight: height * scale };
    });
    const totalHeight = dims.reduce((sum, d) => sum + d.scaledHeight, 0) + gap * (srcPages.length - 1);

    const outPage = out.addPage([targetWidth, totalHeight]);
    let cursorFromTop = 0;
    for (let i = 0; i < srcPages.length; i++) {
      setStatus(statusEl, `Placing page ${i + 1} of ${srcPages.length}…`, "");
      const embedded = await out.embedPage(srcPages[i]);
      const { scale, scaledHeight } = dims[i];
      const yTop = totalHeight - cursorFromTop;
      const y = yTop - scaledHeight;
      outPage.drawPage(embedded, { x: 0, y, xScale: scale, yScale: scale });
      cursorFromTop += scaledHeight + gap;
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-single-page.pdf`);
    setStatus(statusEl, `Sorted — stitched ${srcPages.length} page(s) into one long page (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
