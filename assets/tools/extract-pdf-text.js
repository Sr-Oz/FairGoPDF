import { loadPdfJsDoc, extractPdfPageTexts } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const textarea = document.getElementById("extractedText");
const pageMarkers = document.getElementById("pageMarkers");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let pagesText = [];

async function extractText(bytes) {
  const pdfJsDoc = await loadPdfJsDoc(bytes.slice());
  return extractPdfPageTexts(pdfJsDoc, (i, total) => {
    setStatus(statusEl, `Extracting page ${i} of ${total}…`, "");
  });
}

function renderOutput() {
  const marked = pageMarkers.checked;
  textarea.value = pagesText
    .map((t, i) => (marked ? `--- Page ${i + 1} ---\n${t}` : t))
    .join("\n\n");
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  try {
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    pagesText = await extractText(bytes);
    renderOutput();
    editor.style.display = "block";
    setStatus(statusEl, `Sorted — extracted text from ${pagesText.length} page${pagesText.length > 1 ? "s" : ""}.`, "success");
    statusEl.classList.add("visible");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "extract-pdf-text", dropzone, onFiles: handleFiles });
}

pageMarkers.addEventListener("change", renderOutput);

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(textarea.value);
    setStatus(statusEl, "Copied to clipboard.", "success");
    statusEl.classList.add("visible");
  } catch (err) {
    textarea.select();
    setStatus(statusEl, "Couldn't access the clipboard automatically — the text is selected, press Ctrl/Cmd+C to copy.", "error");
    statusEl.classList.add("visible");
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([textarea.value], { type: "text/plain" });
  triggerDownload(blob, `${stripExtension(currentFile.name)}.txt`);
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  pagesText = [];
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});
