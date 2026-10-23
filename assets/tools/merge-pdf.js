import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";
import { PDFDocument as DecryptingPDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";
import { renderFileCards } from "/assets/tools/file-cards.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

// Each entry is { file, canvas, pages }: canvas (the first page) and pages arrive once pdf.js has read the file.
let files = [];

// Many PDFs (certificates, bank statements) are "encrypted" only to stop editing and open with no password. pdf-lib refuses
// those, so they are opened with the decrypting library (the one Unlock PDF uses) and merged as an unlocked copy.
// A PDF that really needs a password is named, so the visitor knows which one to unlock first.
class MergeProblem extends Error {}

async function loadForMerge(file) {
  const bytes = await file.arrayBuffer();
  try {
    return await PDFLib.PDFDocument.load(bytes);
  } catch (err) {
    if (!/encrypted/i.test(err.message || "")) throw new MergeProblem(`${file.name} couldn't be read as a PDF (${err.message || "unknown problem"}).`);
  }
  try {
    const open = await DecryptingPDFDocument.load(bytes.slice(0), { password: "" });
    return await PDFLib.PDFDocument.load(await open.save());
  } catch (err) {
    throw new MergeProblem(`${file.name} is password protected. Remove its password with Unlock PDF first, then add it again.`);
  }
}

async function loadPreview(entry) {
  let doc;
  try {
    doc = await loadPdfJsDoc(await entry.file.arrayBuffer());
    entry.pages = doc.numPages;
    entry.canvas = await renderPageThumbCanvas(doc, 1, 240);
  } catch (err) {
    entry.failed = true; // password protected or damaged: the card shows a plain icon and the merge reports the problem
  } finally {
    if (doc) doc.loadingTask.destroy();
  }
  if (files.includes(entry)) renderFileList();
}

function renderFileList() {
  renderFileCards(fileListEl, files, {
    detail: (entry) => [entry.pages ? `${entry.pages} page${entry.pages === 1 ? "" : "s"}` : "", formatBytes(entry.file.size)].filter(Boolean).join(" · "),
    onChange: renderFileList,
  });
  actionsRow.style.display = files.length >= 1 ? "flex" : "none";
  clearStatus(statusEl);
}

function addFiles(newFiles) {
  const pdfs = newFiles.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length !== newFiles.length) {
    setStatus(statusEl, "Some files were skipped because they weren't PDFs.", "error");
    statusEl.classList.add("visible");
  }
  const entries = pdfs.map((file) => ({ file, canvas: null, pages: 0, failed: false }));
  files = files.concat(entries);
  renderFileList();
  // one at a time, so a big batch doesn't read every file into memory at once
  (async () => {
    for (const entry of entries) if (files.includes(entry)) await loadPreview(entry);
  })();
}

initDropzone(dropzone, fileInput, addFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "merge-pdf", dropzone, onFiles: addFiles });
}

clearBtn.addEventListener("click", () => {
  files = [];
  renderFileList();
});

runBtn.addEventListener("click", async () => {
  if (files.length < 1) return;
  if (files.length < 2) {
    setStatus(statusEl, "Add at least two PDFs to merge.", "error");
    statusEl.classList.add("visible");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, "Merging…", "");
  statusEl.classList.add("visible");

  try {
    const merged = await PDFLib.PDFDocument.create();
    for (const { file } of files) {
      const src = await loadForMerge(file);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const outBytes = await merged.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const outName = brandFilename("merge-pdf", "merged", "pdf");
    triggerDownload(blob, outName);
    setStatus(statusEl, `Sorted — merged ${files.length} PDFs into one file (${formatBytes(blob.size)}).`, "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "merge-pdf",
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
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err instanceof MergeProblem ? err.message : `Something went wrong: ${err.message || "could not merge these PDFs."}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
