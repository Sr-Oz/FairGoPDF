import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, parsePageRanges } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const rangeInput = document.getElementById("rangeInput");
const selectAllBtn = document.getElementById("selectAllBtn");
const selectNoneBtn = document.getElementById("selectNoneBtn");
const extractBtn = document.getElementById("extractBtn");
const splitEachBtn = document.getElementById("splitEachBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let pageCount = 0;
let selected = new Set();

function updateThumbStyles() {
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    const n = Number(el.dataset.page);
    el.classList.toggle("selected", selected.has(n));
  });
}

function syncRangeInputFromSelection() {
  if (selected.size === 0) { rangeInput.value = ""; return; }
  const sorted = Array.from(selected).sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  rangeInput.value = parts.join(",");
}

rangeInput.addEventListener("input", () => {
  const pages = parsePageRanges(rangeInput.value, pageCount);
  selected = new Set(pages);
  updateThumbStyles();
});

selectAllBtn.addEventListener("click", () => {
  selected = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));
  updateThumbStyles();
  syncRangeInputFromSelection();
});

selectNoneBtn.addEventListener("click", () => {
  selected = new Set();
  updateThumbStyles();
  syncRangeInputFromSelection();
});

async function loadFile(file) {
  currentFile = file;
  currentBytes = new Uint8Array(await file.arrayBuffer());
  setStatus(statusEl, "Rendering pages…", "");
  statusEl.classList.add("visible");
  editor.style.display = "block";
  pageGrid.innerHTML = "";

  const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
  pageCount = pdfJsDoc.numPages;
  selected = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));

  for (let i = 1; i <= pageCount; i++) {
    const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 200);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Page ${i} preview`);
    const thumb = document.createElement("div");
    thumb.className = "page-thumb selected";
    thumb.dataset.page = String(i);
    thumb.innerHTML = `<span class="page-num">${i}</span>`;
    thumb.appendChild(canvas);
    thumb.addEventListener("click", () => {
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      updateThumbStyles();
      syncRangeInputFromSelection();
    });
    pageGrid.appendChild(thumb);
  }

  syncRangeInputFromSelection();
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

extractBtn.addEventListener("click", async () => {
  const pages = Array.from(selected).sort((a, b) => a - b);
  if (!currentFile || pages.length === 0) {
    setStatus(statusEl, "Select at least one page first.", "error");
    statusEl.classList.add("visible");
    return;
  }
  extractBtn.disabled = true;
  setStatus(statusEl, "Extracting…", "");
  statusEl.classList.add("visible");
  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, pages.map((p) => p - 1));
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, brandFilename("split-pdf", stripExtension(currentFile.name), "pdf"));
    setStatus(statusEl, `Sorted — extracted ${pages.length} page${pages.length > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    extractBtn.disabled = false;
  }
});

splitEachBtn.addEventListener("click", async () => {
  const pages = Array.from(selected).sort((a, b) => a - b);
  if (!currentFile || pages.length === 0) {
    setStatus(statusEl, "Select at least one page first.", "error");
    statusEl.classList.add("visible");
    return;
  }
  splitEachBtn.disabled = true;
  setStatus(statusEl, `Preparing ${pages.length} file(s)… your browser may ask to allow multiple downloads.`, "");
  statusEl.classList.add("visible");
  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    for (let i = 0; i < pages.length; i++) {
      const out = await PDFLib.PDFDocument.create();
      const [copied] = await out.copyPages(src, [pages[i] - 1]);
      out.addPage(copied);
      const bytes = await out.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      triggerDownload(blob, brandFilename("split-pdf", `${stripExtension(currentFile.name)}-page-${pages[i]}`, "pdf"));
      await new Promise((r) => setTimeout(r, 250));
    }
    setStatus(statusEl, `Sorted — downloaded ${pages.length} separate PDF file(s).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    splitEachBtn.disabled = false;
  }
});
