import { loadPdfJsDoc, renderPageToCanvasAtScale } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const formatSelect = document.getElementById("format");
const qualityField = document.getElementById("qualityField");
const qualityInput = document.getElementById("quality");
const qualityVal = document.getElementById("qualityVal");
const dpiSelect = document.getElementById("dpi");
const renderBtn = document.getElementById("renderBtn");
const clearBtn = document.getElementById("clearBtn");
const pageGrid = document.getElementById("pageGrid");
const downloadAllRow = document.getElementById("downloadAllRow");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let renderedBlobs = [];

function updateFormatUI() {
  qualityField.style.display = formatSelect.value === "image/png" ? "none" : "flex";
}
formatSelect.addEventListener("change", updateFormatUI);
qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; });
updateFormatUI();

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
  pageGrid.innerHTML = "";
  downloadAllRow.style.display = "none";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "pdf-to-images", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  renderedBlobs = [];
  editor.style.display = "none";
  pageGrid.innerHTML = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

renderBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  renderBtn.disabled = true;
  pageGrid.innerHTML = "";
  renderedBlobs = [];
  downloadAllRow.style.display = "none";
  setStatus(statusEl, "Rendering pages…", "");
  statusEl.classList.add("visible");

  try {
    const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    const scale = Number(dpiSelect.value) / 72;
    const targetType = formatSelect.value;
    const quality = Number(qualityInput.value) / 100;
    const ext = targetType === "image/png" ? "png" : targetType === "image/webp" ? "webp" : "jpg";

    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      setStatus(statusEl, `Rendering page ${i} of ${pdfJsDoc.numPages}…`, "");
      const canvas = await renderPageToCanvasAtScale(pdfJsDoc, i, scale);
      const blob = await canvasToBlob(canvas, targetType, quality);
      const name = brandFilename("pdf-to-images", `${stripExtension(currentFile.name)}-page-${i}`, ext);
      renderedBlobs.push({ blob, name });

      const thumb = document.createElement("div");
      thumb.className = "page-thumb";
      const previewUrl = URL.createObjectURL(blob);
      thumb.innerHTML = `<span class="page-num">${i}</span><img src="${previewUrl}" alt="Page ${i}">`;
      const actions = document.createElement("div");
      actions.className = "thumb-actions";
      const dlBtn = document.createElement("button");
      dlBtn.textContent = "⬇ Download";
      dlBtn.addEventListener("click", () => triggerDownload(blob, name));
      actions.appendChild(dlBtn);
      thumb.appendChild(actions);
      pageGrid.appendChild(thumb);
    }

    downloadAllRow.style.display = renderedBlobs.length ? "flex" : "none";
    setStatus(statusEl, `Sorted — rendered ${pdfJsDoc.numPages} page${pdfJsDoc.numPages > 1 ? "s" : ""}.`, "success");

    // Only offer to continue when the PDF had exactly one page — with
    // several rendered images, there's no single "it" to carry forward.
    if (window.KeepSorted && pdfJsDoc.numPages === 1 && renderedBlobs.length === 1) {
      KeepSorted.offer({
        currentTool: "pdf-to-images",
        blob: renderedBlobs[0].blob,
        filename: renderedBlobs[0].name,
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
    renderBtn.disabled = false;
  }
});

downloadAllBtn.addEventListener("click", async () => {
  for (const { blob, name } of renderedBlobs) {
    triggerDownload(blob, name);
    await new Promise((r) => setTimeout(r, 250));
  }
});
