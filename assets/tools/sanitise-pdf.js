import { PDFLib } from "/assets/tools/pdf-common.js";
import { inspect, sanitise } from "/assets/tools/sanitise-core.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const scanSummary = document.getElementById("scanSummary");
const optScripts = document.getElementById("optScripts");
const optFiles = document.getElementById("optFiles");
const optMetadata = document.getElementById("optMetadata");
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
  try {
    currentBytes = new Uint8Array(await pdf.arrayBuffer());
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice(), { updateMetadata: false });
    const found = inspect(doc, PDFLib);
    const parts = [];
    parts.push(found.scripts > 0 ? `${found.scripts} script/auto-action item(s)` : "no scripts or auto-actions");
    parts.push(found.files > 0 ? "embedded file attachments" : "no embedded file attachments");
    parts.push(found.metadata ? "author/title metadata" : "no author/title metadata");
    scanSummary.textContent = `Found: ${parts.join(", ")}.`;
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
  KeepSorted.init({ currentTool: "sanitise-pdf", dropzone, onFiles: handleFiles });
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
  if (!optScripts.checked && !optFiles.checked && !optMetadata.checked) {
    setStatus(statusEl, "Tick at least one option to sanitise.", "error");
    statusEl.classList.add("visible");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, "Sanitising…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice(), { updateMetadata: false });
    const removed = sanitise(doc, PDFLib, { scripts: optScripts.checked, files: optFiles.checked, metadata: optMetadata.checked });
    const removedParts = [];
    if (removed.scripts > 0) removedParts.push(`${removed.scripts} script/action item(s)`);
    if (removed.files > 0) removedParts.push("embedded file attachments");
    if (removed.metadata) removedParts.push("metadata");

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("sanitise-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "sanitise-pdf",
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
    setStatus(statusEl, removedParts.length > 0
      ? `Sorted — removed ${removedParts.join(", ")} (${formatBytes(blob.size)}).`
      : `Sorted — nothing to remove, saved a clean copy (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
