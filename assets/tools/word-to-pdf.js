import { docxToPdf, DocxError } from "/assets/tools/docx-to-pdf-engine.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileSummary = document.getElementById("fileSummary");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progressFill");

let currentFile = null;
let currentBuffer = null;

function show(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

function setProgress(fraction) {
  progressEl.style.display = fraction === null ? "none" : "block";
  if (fraction !== null) progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

async function handleFiles(files) {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".docx"));
  if (!file) {
    const old = files.find((f) => f.name.toLowerCase().endsWith(".doc"));
    show(
      old
        ? "That's an older .doc file. Open it in Word, choose Save As, pick .docx, then add that file here."
        : "Please choose a .docx file.",
      "error"
    );
    return;
  }
  currentFile = file;
  currentBuffer = await file.arrayBuffer();
  fileSummary.textContent = `${file.name} (${formatBytes(file.size)})`;
  actionsRow.style.display = "flex";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "word-to-pdf", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBuffer = null;
  actionsRow.style.display = "none";
  fileSummary.textContent = "";
  fileInput.value = "";
  setProgress(null);
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentBuffer) return;
  runBtn.disabled = true;
  setProgress(0);
  show("Reading the document…");

  try {
    const { bytes, pageCount, notes } = await docxToPdf(currentBuffer.slice(0), {
      fileName: currentFile.name,
      onProgress: ({ message, done, total }) => {
        show(message);
        setProgress(total ? done / total : null);
      },
    });
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("word-to-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "word-to-pdf",
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
    let message = `Sorted — created a ${pageCount}-page PDF (${formatBytes(blob.size)}).`;
    if (notes.length) message += ` Note: ${notes.join("; ")}.`;
    show(message, "success");
  } catch (err) {
    console.error(err);
    show(err instanceof DocxError ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    setProgress(null);
    runBtn.disabled = false;
  }
});
