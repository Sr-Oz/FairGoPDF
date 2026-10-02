import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const titleInput = document.getElementById("metaTitle");
const authorInput = document.getElementById("metaAuthor");
const subjectInput = document.getElementById("metaSubject");
const keywordsInput = document.getElementById("metaKeywords");
const creatorInput = document.getElementById("metaCreator");
const saveBtn = document.getElementById("saveBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
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
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    titleInput.value = doc.getTitle() || "";
    authorInput.value = doc.getAuthor() || "";
    subjectInput.value = doc.getSubject() || "";
    keywordsInput.value = doc.getKeywords() || "";
    creatorInput.value = doc.getCreator() || "";
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
  KeepSorted.init({ currentTool: "pdf-metadata", dropzone, onFiles: handleFiles });
}

clearAllBtn.addEventListener("click", () => {
  titleInput.value = "";
  authorInput.value = "";
  subjectInput.value = "";
  keywordsInput.value = "";
  creatorInput.value = "";
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

saveBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  saveBtn.disabled = true;
  setStatus(statusEl, "Saving…", "");
  statusEl.classList.add("visible");
  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    doc.setTitle(titleInput.value);
    doc.setAuthor(authorInput.value);
    doc.setSubject(subjectInput.value);
    const keywords = keywordsInput.value.split(",").map((k) => k.trim()).filter(Boolean);
    doc.setKeywords(keywords);
    doc.setCreator(creatorInput.value);
    doc.setModificationDate(new Date());
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = `${stripExtension(currentFile.name)}-metadata.pdf`;
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "pdf-metadata",
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
    setStatus(statusEl, `Sorted — saved (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    saveBtn.disabled = false;
  }
});
