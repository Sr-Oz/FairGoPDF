import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const gridSelect = document.getElementById("gridSize");
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
  setStatus(statusEl, "Building poster sheets…", "");
  statusEl.classList.add("visible");

  try {
    const n = Number(gridSelect.value);
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const srcPages = src.getPages();

    for (let i = 0; i < srcPages.length; i++) {
      const { width: w, height: h } = srcPages[i].getSize();
      const embedded = await out.embedPage(srcPages[i]);

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          setStatus(statusEl, `Building sheet ${r * n + c + 1} of ${n * n} for page ${i + 1}…`, "");
          const tile = out.addPage([w, h]);
          tile.drawRectangle({ x: 0, y: 0, width: w, height: h, color: PDFLib.rgb(1, 1, 1) });
          tile.drawPage(embedded, {
            x: -c * w,
            y: -(n - 1 - r) * h,
            xScale: n,
            yScale: n,
          });
        }
      }
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-poster.pdf`);
    setStatus(statusEl, `Sorted — built ${out.getPageCount()} sheet(s) at ${n}×${n}, print each and tape together (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
