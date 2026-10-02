import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzoneA = document.getElementById("dropzoneA");
const fileInputA = document.getElementById("fileInputA");
const dzTitleA = document.getElementById("dzTitleA");
const dzSubA = document.getElementById("dzSubA");
const dropzoneB = document.getElementById("dropzoneB");
const fileInputB = document.getElementById("fileInputB");
const dzTitleB = document.getElementById("dzTitleB");
const dzSubB = document.getElementById("dzSubB");
const reverseB = document.getElementById("reverseB");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let fileA = null, bytesA = null, pageCountA = 0;
let fileB = null, bytesB = null, pageCountB = 0;

async function loadSlot(file, titleEl, subEl, label) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFLib.PDFDocument.load(bytes.slice());
  const count = doc.getPageCount();
  titleEl.textContent = file.name;
  subEl.textContent = `${count} page${count > 1 ? "s" : ""}`;
  return { bytes, count };
}

async function handleFilesA(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    return;
  }
  try {
    fileA = pdf;
    const result = await loadSlot(pdf, dzTitleA, dzSubA, "A");
    bytesA = result.bytes;
    pageCountA = result.count;
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
  }
}

initDropzone(dropzoneA, fileInputA, handleFilesA);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "alternate-mix-pages", dropzone: dropzoneA, onFiles: handleFilesA });
}

initDropzone(dropzoneB, fileInputB, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    return;
  }
  try {
    fileB = pdf;
    const result = await loadSlot(pdf, dzTitleB, dzSubB, "B");
    bytesB = result.bytes;
    pageCountB = result.count;
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
  }
});

clearBtn.addEventListener("click", () => {
  fileA = bytesA = null; pageCountA = 0;
  fileB = bytesB = null; pageCountB = 0;
  dzTitleA.textContent = "Drop File A here, easy as.";
  dzSubA.textContent = "One PDF file";
  dzTitleB.textContent = "Drop File B here, easy as.";
  dzSubB.textContent = "One PDF file";
  fileInputA.value = "";
  fileInputB.value = "";
  reverseB.checked = false;
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!bytesA || !bytesB) {
    setStatus(statusEl, "Add both File A and File B first.", "error");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, "Interleaving…", "");

  try {
    const docA = await PDFLib.PDFDocument.load(bytesA.slice());
    const docB = await PDFLib.PDFDocument.load(bytesB.slice());
    const out = await PDFLib.PDFDocument.create();

    const indicesA = docA.getPageIndices();
    let indicesB = docB.getPageIndices();
    if (reverseB.checked) indicesB = [...indicesB].reverse();

    const maxLen = Math.max(indicesA.length, indicesB.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < indicesA.length) {
        const [page] = await out.copyPages(docA, [indicesA[i]]);
        out.addPage(page);
      }
      if (i < indicesB.length) {
        const [page] = await out.copyPages(docB, [indicesB[i]]);
        out.addPage(page);
      }
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("alternate-mix-pages", "interleaved", "pdf");
    triggerDownload(blob, outName);

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "alternate-mix-pages",
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
    setStatus(statusEl, `Sorted — interleaved ${indicesA.length + indicesB.length} pages into one file (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
