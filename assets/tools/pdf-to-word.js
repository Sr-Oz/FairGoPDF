import { loadPdfJsDoc, extractPdfPageTexts } from "/assets/tools/pdf-common.js";
import { buildDocxBytes } from "/assets/tools/docx-writer.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

// Best-effort, same approach as convert-to-markdown.js: a PDF has no real
// paragraph structure, only positioned text runs, so this groups lines into
// paragraphs wherever pdf.js's own text extraction happens to report a blank
// line. Most PDFs won't have one, and come out as a single paragraph per page.
function pagesToParagraphs(pages) {
  const paragraphs = [];
  for (const pageText of pages) {
    let buffer = [];
    const flush = () => {
      if (buffer.length) paragraphs.push({ runs: [{ text: buffer.join(" ") }] });
      buffer = [];
    };
    for (const rawLine of pageText.split("\n")) {
      const line = rawLine.trim();
      if (line === "") flush();
      else buffer.push(line);
    }
    flush();
  }
  return paragraphs;
}

async function handleFiles(files) {
  const file = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!file) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = file;
  currentBytes = new Uint8Array(await file.arrayBuffer());
  actionsRow.style.display = "flex";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "pdf-to-word", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  actionsRow.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentBytes) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Reading PDF…", "");
  statusEl.classList.add("visible");

  try {
    const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    const pages = await extractPdfPageTexts(pdfJsDoc, (i, total) => {
      setStatus(statusEl, `Reading page ${i} of ${total}…`, "");
    });
    const paragraphs = pagesToParagraphs(pages);
    if (!paragraphs.length) throw new Error("no text found, this PDF may be a scan with no selectable text");

    setStatus(statusEl, "Building Word document…", "");
    const bytes = buildDocxBytes(paragraphs);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}.docx`);
    setStatus(statusEl, `Sorted — created a ${formatBytes(blob.size)} Word document from ${pages.length} page${pages.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
