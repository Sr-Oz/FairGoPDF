import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const blankSummary = document.getElementById("blankSummary");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let pages = []; // { origIndex, deleted, canvas, autoBlank }

// A page counts as "blank" when almost none of its sampled pixels differ from white —
// a stray page number or scanner speckle shouldn't stop it being flagged.
function detectBlank(canvas) {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let nonWhite = 0;
  const totalPixels = canvas.width * canvas.height;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonWhite++;
  }
  return nonWhite / totalPixels < 0.004;
}

function renderGrid() {
  pageGrid.innerHTML = "";
  pages.forEach((p, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "page-thumb" + (p.deleted ? " marked-delete" : "");

    if (p.autoBlank) {
      const badge = document.createElement("span");
      badge.className = "page-num";
      badge.style.left = "auto";
      badge.style.right = "4px";
      badge.style.background = "var(--brand)";
      badge.textContent = "Blank?";
      thumb.appendChild(badge);
    }

    const num = document.createElement("span");
    num.className = "page-num";
    num.textContent = String(idx + 1);
    thumb.appendChild(num);

    const wrap = document.createElement("div");
    wrap.className = "thumb-img-wrap";
    p.canvas.setAttribute("role", "img");
    p.canvas.setAttribute("aria-label", `Page ${idx + 1} preview${p.deleted ? " (marked for removal)" : ""}`);
    wrap.appendChild(p.canvas);
    thumb.appendChild(wrap);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";
    const delBtn = document.createElement("button");
    delBtn.textContent = p.deleted ? "↺ Keep" : "✕ Remove";
    delBtn.setAttribute("aria-label", p.deleted ? `Keep page ${idx + 1}` : `Remove page ${idx + 1}`);
    delBtn.addEventListener("click", () => {
      p.deleted = !p.deleted;
      renderGrid();
    });
    actions.appendChild(delBtn);
    thumb.appendChild(actions);

    pageGrid.appendChild(thumb);
  });

  const blankCount = pages.filter((p) => p.autoBlank).length;
  const removeCount = pages.filter((p) => p.deleted).length;
  blankSummary.textContent = blankCount > 0
    ? `Found ${blankCount} likely-blank page${blankCount > 1 ? "s" : ""}, pre-marked for removal. ${removeCount} of ${pages.length} page(s) will be removed — check the previews before saving.`
    : `No blank pages detected. ${removeCount} of ${pages.length} page(s) marked for removal.`;
}

async function loadFile(file) {
  currentFile = file;
  currentBytes = new Uint8Array(await file.arrayBuffer());
  setStatus(statusEl, "Scanning pages for blanks…", "");
  statusEl.classList.add("visible");
  editor.style.display = "block";

  const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
  pages = [];
  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 200);
    const autoBlank = detectBlank(canvas);
    pages.push({ origIndex: i - 1, deleted: autoBlank, canvas, autoBlank });
  }
  renderGrid();
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

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pages = [];
  editor.style.display = "none";
  pageGrid.innerHTML = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

saveBtn.addEventListener("click", async () => {
  const remaining = pages.filter((p) => !p.deleted);
  if (!currentFile || remaining.length === 0) {
    setStatus(statusEl, "Nothing to save — keep at least one page.", "error");
    statusEl.classList.add("visible");
    return;
  }
  saveBtn.disabled = true;
  setStatus(statusEl, "Saving…", "");
  statusEl.classList.add("visible");

  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, remaining.map((p) => p.origIndex));
    copied.forEach((page) => out.addPage(page));

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const removedCount = pages.length - remaining.length;
    triggerDownload(blob, `${stripExtension(currentFile.name)}-no-blanks.pdf`);
    setStatus(statusEl, `Sorted — removed ${removedCount} page(s), kept ${remaining.length} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    saveBtn.disabled = false;
  }
});
