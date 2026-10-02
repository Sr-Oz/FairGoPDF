import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const directionSelect = document.getElementById("direction");
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
  KeepSorted.init({ currentTool: "divide-pdf-pages", dropzone, onFiles: handleFiles });
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
  setStatus(statusEl, "Dividing pages…", "");
  statusEl.classList.add("visible");

  try {
    const vertical = directionSelect.value === "vertical";
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const srcPages = src.getPages();

    for (let i = 0; i < srcPages.length; i++) {
      setStatus(statusEl, `Dividing page ${i + 1} of ${srcPages.length}…`, "");
      const { width, height } = srcPages[i].getSize();
      const embedded = await out.embedPage(srcPages[i]);

      if (vertical) {
        const halfW = width / 2;
        const left = out.addPage([halfW, height]);
        left.drawPage(embedded, { x: 0, y: 0 });
        const right = out.addPage([halfW, height]);
        right.drawPage(embedded, { x: -halfW, y: 0 });
      } else {
        const halfH = height / 2;
        const top = out.addPage([width, halfH]);
        top.drawPage(embedded, { x: 0, y: -halfH });
        const bottom = out.addPage([width, halfH]);
        bottom.drawPage(embedded, { x: 0, y: 0 });
      }
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("divide-pdf-pages", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "divide-pdf-pages",
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
    setStatus(statusEl, `Sorted — divided ${srcPages.length} page(s) into ${out.getPageCount()} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
