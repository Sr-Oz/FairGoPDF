import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const positionSelect = document.getElementById("position");
const formatInput = document.getElementById("format");
const startNumInput = document.getElementById("startNum");
const digitsInput = document.getElementById("digits");
const fontSizeInput = document.getElementById("fontSize");
const batesPresetBtn = document.getElementById("batesPresetBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

const MARGIN = 24;

async function loadFile(pdf) {
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  editor.style.display = "block";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  await loadFile(pdf);
});

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "add-page-numbers", dropzone, onFiles: (files) => loadFile(files[0]) });
}

batesPresetBtn.addEventListener("click", () => {
  positionSelect.value = "bottom-right";
  formatInput.value = "DOC-{n}";
  digitsInput.value = 6;
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Adding page numbers…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    const start = Number(startNumInput.value) || 1;
    const digits = Math.max(1, Number(digitsInput.value) || 1);
    const fontSize = Number(fontSizeInput.value) || 10;
    const position = positionSelect.value;
    const template = formatInput.value || "{n}";

    pages.forEach((page, i) => {
      const n = String(start + i).padStart(digits, "0");
      const text = template.replace(/\{n\}/g, n).replace(/\{total\}/g, String(total));
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const { width, height } = page.getSize();

      let x, y;
      if (position.endsWith("center")) x = width / 2 - textWidth / 2;
      else if (position.endsWith("right")) x = width - MARGIN - textWidth;
      else x = MARGIN;

      y = position.startsWith("top") ? height - MARGIN : MARGIN - fontSize * 0.3;

      page.drawText(text, { x, y, size: fontSize, font, color: PDFLib.rgb(0, 0, 0) });
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("add-page-numbers", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    setStatus(statusEl, `Sorted — numbered ${total} page${total > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "add-page-numbers",
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
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
