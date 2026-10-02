import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageSummary = document.getElementById("pageSummary");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let pageCount = 0;

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
    pageCount = doc.getPageCount();
    const padded = Math.ceil(pageCount / 4) * 4;
    const blanks = padded - pageCount;
    const sheets = padded / 4;
    pageSummary.textContent = blanks > 0
      ? `${pageCount} page${pageCount > 1 ? "s" : ""}, padded to ${padded} with ${blanks} blank half-page${blanks > 1 ? "s" : ""}, producing ${padded / 2} printed sides on ${sheets} sheet${sheets > 1 ? "s" : ""}.`
      : `${pageCount} pages, producing ${padded / 2} printed sides on ${sheets} sheet${sheets > 1 ? "s" : ""}.`;
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
  KeepSorted.init({ currentTool: "pdf-booklet", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pageCount = 0;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Building booklet…", "");
  statusEl.classList.add("visible");

  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const srcPages = src.getPages();
    const { width, height } = srcPages[0].getSize();
    const N0 = srcPages.length;
    const N = Math.ceil(N0 / 4) * 4;
    const out = await PDFLib.PDFDocument.create();

    async function drawHalf(outPage, position, isLeft) {
      if (position < 1 || position > N0) return;
      const embedded = await out.embedPage(srcPages[position - 1]);
      const scale = Math.min(width / embedded.width, height / embedded.height);
      const drawW = embedded.width * scale;
      const drawH = embedded.height * scale;
      const xBase = isLeft ? 0 : width;
      const x = xBase + (width - drawW) / 2;
      const y = (height - drawH) / 2;
      outPage.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
    }

    const sheets = N / 4;
    for (let s = 0; s < sheets; s++) {
      setStatus(statusEl, `Placing sheet ${s + 1} of ${sheets}…`, "");
      const frontLeft = N - 2 * s;
      const frontRight = 1 + 2 * s;
      const backLeft = 2 + 2 * s;
      const backRight = N - 1 - 2 * s;

      const frontPage = out.addPage([width * 2, height]);
      await drawHalf(frontPage, frontLeft, true);
      await drawHalf(frontPage, frontRight, false);

      const backPage = out.addPage([width * 2, height]);
      await drawHalf(backPage, backLeft, true);
      await drawHalf(backPage, backRight, false);
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = `${stripExtension(currentFile.name)}-booklet.pdf`;
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "pdf-booklet",
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
    setStatus(statusEl, `Sorted — created a ${sheets}-sheet booklet (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
