import { renderHtmlSectionsPdf } from "/assets/tools/doc-pdf-render.js";
import { rtfToHtml } from "/assets/tools/rtf-to-html.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const controls = document.getElementById("controls");
const actionsRow = document.getElementById("actionsRow");
const pageSizeSelect = document.getElementById("pageSize");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentHtml = null;

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".rtf"));
  if (!file) {
    setStatus(statusEl, "Please choose a .rtf file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = file;
  try {
    const text = await file.text();
    if (!/^\{\\rtf/.test(text.trim())) throw new Error("that doesn't look like an RTF file");
    currentHtml = rtfToHtml(text);
    controls.style.display = "flex";
    actionsRow.style.display = "flex";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that file: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentHtml = null;
  controls.style.display = "none";
  actionsRow.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentHtml) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Building PDF…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await renderHtmlSectionsPdf([{ html: currentHtml }], pageSizeSelect.value);
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = `${stripExtension(currentFile.name)}.pdf`;
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "rtf-to-pdf",
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
    setStatus(statusEl, `Sorted — created a ${doc.getPageCount()}-page PDF (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
