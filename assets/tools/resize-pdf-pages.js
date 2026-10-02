import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const paperSizeSelect = document.getElementById("paperSize");
const orientationSelect = document.getElementById("orientation");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PAPER_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

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
  KeepSorted.init({ currentTool: "resize-pdf-pages", dropzone, onFiles: handleFiles });
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
  setStatus(statusEl, "Resizing pages…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const [baseW, baseH] = PAPER_SIZES[paperSizeSelect.value];
    const orientation = orientationSelect.value;

    doc.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      let tw = baseW, th = baseH;

      const wantLandscape =
        orientation === "landscape" || (orientation === "auto" && width > height);
      if (wantLandscape && tw < th) [tw, th] = [th, tw];
      if (!wantLandscape && tw > th) [tw, th] = [th, tw];

      const scale = Math.min(tw / width, th / height);
      page.scale(scale, scale);

      const box = page.getMediaBox();
      const padX = (tw - box.width) / 2;
      const padY = (th - box.height) / 2;
      page.setMediaBox(box.x - padX, box.y - padY, tw, th);
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = `${stripExtension(currentFile.name)}-resized.pdf`;
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "resize-pdf-pages",
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
    setStatus(statusEl, `Sorted — resized ${doc.getPageCount()} page${doc.getPageCount() > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
