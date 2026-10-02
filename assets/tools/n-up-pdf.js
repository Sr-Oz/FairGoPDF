import { PDFLib } from "/assets/tools/pdf-common.js";

const GRID = {
  2: [1, 2],
  4: [2, 2],
  6: [2, 3],
  9: [3, 3],
};
const GAP = 10;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pagesPerSheetSelect = document.getElementById("pagesPerSheet");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

async function handleFiles(files) {
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
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "n-up-pdf", dropzone, onFiles: handleFiles });
}

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
  setStatus(statusEl, "Building sheets…", "");
  statusEl.classList.add("visible");

  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const srcPages = src.getPages();
    const { width: sheetW, height: sheetH } = srcPages[0].getSize();
    const [cols, rows] = GRID[pagesPerSheetSelect.value];
    const perSheet = cols * rows;

    const cellW = (sheetW - GAP * (cols + 1)) / cols;
    const cellH = (sheetH - GAP * (rows + 1)) / rows;

    const out = await PDFLib.PDFDocument.create();

    for (let sheetStart = 0; sheetStart < srcPages.length; sheetStart += perSheet) {
      const sheetPages = srcPages.slice(sheetStart, sheetStart + perSheet);
      const outPage = out.addPage([sheetW, sheetH]);

      for (let idx = 0; idx < sheetPages.length; idx++) {
        setStatus(statusEl, `Placing page ${sheetStart + idx + 1} of ${srcPages.length}…`, "");
        const embedded = await out.embedPage(sheetPages[idx]);
        const col = idx % cols;
        const row = Math.floor(idx / cols);

        const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
        const drawW = embedded.width * scale;
        const drawH = embedded.height * scale;

        const cellLeft = GAP + col * (cellW + GAP);
        const cellTopFromTop = GAP + row * (cellH + GAP);
        const cellBottom = sheetH - cellTopFromTop - cellH;

        const x = cellLeft + (cellW - drawW) / 2;
        const y = cellBottom + (cellH - drawH) / 2;

        outPage.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
      }
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("n-up-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "n-up-pdf",
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
    setStatus(statusEl, `Sorted — combined ${srcPages.length} page(s) onto ${out.getPageCount()} sheet(s) (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
