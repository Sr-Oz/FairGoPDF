import { PDFLib, parsePageRanges } from "/assets/tools/pdf-common.js";

const dropzonePdf = document.getElementById("dropzonePdf");
const pdfInput = document.getElementById("pdfInput");
const dzTitlePdf = document.getElementById("dzTitlePdf");
const dropzoneImg = document.getElementById("dropzoneImg");
const imgInput = document.getElementById("imgInput");
const dzTitleImg = document.getElementById("dzTitleImg");
const editor = document.getElementById("editor");
const pagesInput = document.getElementById("stampPages");
const positionSelect = document.getElementById("stampPosition");
const widthInput = document.getElementById("stampWidth");
const widthVal = document.getElementById("stampWidthVal");
const opacityInput = document.getElementById("stampOpacity");
const opacityVal = document.getElementById("stampOpacityVal");
const rotationInput = document.getElementById("stampRotation");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const MARGIN = 24;

let pdfFile = null;
let pdfBytes = null;
let stampFile = null;
let stampBytes = null;

function maybeShowEditor() {
  if (pdfFile && stampFile) {
    editor.style.display = "block";
    clearStatus(statusEl);
  }
}

async function handlePdfFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  pdfFile = pdf;
  pdfBytes = new Uint8Array(await pdf.arrayBuffer());
  dzTitlePdf.textContent = pdf.name;
  maybeShowEditor();
}

initDropzone(dropzonePdf, pdfInput, handlePdfFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "add-stamps", dropzone: dropzonePdf, onFiles: handlePdfFiles });
}

initDropzone(dropzoneImg, imgInput, async (files) => {
  const img = files.find((f) => f.type === "image/png" || f.type === "image/jpeg");
  if (!img) {
    setStatus(statusEl, "Please choose a PNG or JPG image.", "error");
    statusEl.classList.add("visible");
    return;
  }
  stampFile = img;
  stampBytes = new Uint8Array(await img.arrayBuffer());
  dzTitleImg.textContent = img.name;
  maybeShowEditor();
});

widthInput.addEventListener("input", () => { widthVal.textContent = widthInput.value; });
opacityInput.addEventListener("input", () => { opacityVal.textContent = opacityInput.value; });

clearBtn.addEventListener("click", () => {
  pdfFile = null;
  pdfBytes = null;
  stampFile = null;
  stampBytes = null;
  dzTitlePdf.textContent = "Drop your PDF here, easy as.";
  dzTitleImg.textContent = "Drop a PNG or JPG here.";
  editor.style.display = "none";
  pdfInput.value = "";
  imgInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!pdfFile || !stampFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Stamping…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(pdfBytes.slice());
    const image = stampFile.type === "image/png" ? await doc.embedPng(stampBytes) : await doc.embedJpg(stampBytes);
    const aspect = image.height / image.width;
    const targetWidth = Number(widthInput.value);
    const targetHeight = targetWidth * aspect;
    const opacity = Number(opacityInput.value) / 100;
    const rotateDeg = Number(rotationInput.value) || 0;
    const position = positionSelect.value;

    const allPages = doc.getPages();
    const pageCount = allPages.length;
    const targetPages = pagesInput.value.trim()
      ? parsePageRanges(pagesInput.value, pageCount)
      : Array.from({ length: pageCount }, (_, i) => i + 1);

    if (!targetPages.length) {
      setStatus(statusEl, "That page selection didn't match any pages in this PDF.", "error");
      runBtn.disabled = false;
      return;
    }

    for (const pageNum of targetPages) {
      const page = allPages[pageNum - 1];
      const { width, height } = page.getSize();

      let x, y;
      if (position === "center") {
        x = width / 2 - targetWidth / 2;
        y = height / 2 - targetHeight / 2;
      } else {
        if (position.endsWith("center")) x = width / 2 - targetWidth / 2;
        else if (position.endsWith("right")) x = width - MARGIN - targetWidth;
        else x = MARGIN;
        y = position.startsWith("top") ? height - MARGIN - targetHeight : MARGIN;
      }

      page.drawImage(image, {
        x, y, width: targetWidth, height: targetHeight,
        opacity,
        rotate: PDFLib.degrees(rotateDeg),
      });
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("add-stamps", stripExtension(pdfFile.name), "pdf");
    triggerDownload(blob, outName);
    setStatus(statusEl, `Sorted — stamped ${targetPages.length} page${targetPages.length > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "add-stamps",
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
