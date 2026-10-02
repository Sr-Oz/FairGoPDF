import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const textInput = document.getElementById("wmText");
const sizeInput = document.getElementById("wmSize");
const opacityInput = document.getElementById("wmOpacity");
const opacityVal = document.getElementById("wmOpacityVal");
const rotationInput = document.getElementById("wmRotation");
const colorInput = document.getElementById("wmColor");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

function hexToRgb01(hex) {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  return { r, g, b };
}

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
  KeepSorted.init({ currentTool: "watermark-pdf", dropzone, onFiles: (files) => loadFile(files[0]) });
}

opacityInput.addEventListener("input", () => { opacityVal.textContent = opacityInput.value; });

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const text = textInput.value.trim();
  if (!text) {
    setStatus(statusEl, "Enter some watermark text first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Adding watermark…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const size = Number(sizeInput.value) || 48;
    const opacity = Number(opacityInput.value) / 100;
    const angleDeg = Number(rotationInput.value) || 0;
    const angleRad = (angleDeg * Math.PI) / 180;
    const { r, g, b } = hexToRgb01(colorInput.value);
    const textWidth = font.widthOfTextAtSize(text, size);

    doc.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      const centerX = width / 2;
      const centerY = height / 2;
      const x = centerX - (textWidth / 2) * Math.cos(angleRad);
      const y = centerY - (textWidth / 2) * Math.sin(angleRad);

      page.drawText(text, {
        x, y, size, font,
        color: PDFLib.rgb(r, g, b),
        opacity,
        rotate: PDFLib.degrees(angleDeg),
      });
    });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("watermark-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    setStatus(statusEl, `Sorted — watermark added (${formatBytes(blob.size)}).`, "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "watermark-pdf",
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
