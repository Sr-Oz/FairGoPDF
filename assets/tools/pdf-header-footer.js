import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const hLeft = document.getElementById("hLeft");
const hCenter = document.getElementById("hCenter");
const hRight = document.getElementById("hRight");
const fLeft = document.getElementById("fLeft");
const fCenter = document.getElementById("fCenter");
const fRight = document.getElementById("fRight");
const fontSizeInput = document.getElementById("fontSize");
const marginInput = document.getElementById("margin");
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
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  editor.style.display = "block";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "pdf-header-footer", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function applyTokens(template, n, total, dateLabel) {
  return template.replaceAll("{n}", String(n)).replaceAll("{total}", String(total)).replaceAll("{date}", dateLabel);
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  const zones = {
    "header-left": hLeft.value.trim(),
    "header-center": hCenter.value.trim(),
    "header-right": hRight.value.trim(),
    "footer-left": fLeft.value.trim(),
    "footer-center": fCenter.value.trim(),
    "footer-right": fRight.value.trim(),
  };
  const hasAnyZone = Object.values(zones).some((v) => v.length > 0);
  if (!hasAnyZone) {
    setStatus(statusEl, "Fill in at least one header or footer zone first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Adding header & footer…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const size = Number(fontSizeInput.value) || 9;
    const margin = Number(marginInput.value) || 28;
    const dateLabel = todayLabel();
    const pages = doc.getPages();
    const total = pages.length;

    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      const n = i + 1;

      const drawZone = (template, align, y) => {
        if (!template) return;
        const text = applyTokens(template, n, total, dateLabel);
        const textWidth = font.widthOfTextAtSize(text, size);
        let x;
        if (align === "center") x = width / 2 - textWidth / 2;
        else if (align === "right") x = width - margin - textWidth;
        else x = margin;
        page.drawText(text, { x, y, size, font, color: PDFLib.rgb(0.15, 0.15, 0.15) });
      };

      const headerY = height - margin;
      const footerY = margin - size * 0.8;

      drawZone(zones["header-left"], "left", headerY);
      drawZone(zones["header-center"], "center", headerY);
      drawZone(zones["header-right"], "right", headerY);
      drawZone(zones["footer-left"], "left", footerY);
      drawZone(zones["footer-center"], "center", footerY);
      drawZone(zones["footer-right"], "right", footerY);
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("pdf-header-footer", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "pdf-header-footer",
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
    setStatus(statusEl, `Sorted — added to ${total} page${total > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
