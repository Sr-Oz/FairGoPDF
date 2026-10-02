import { qrcode } from "/assets/vendor/qrcode.mjs";
import { stringToBytes } from "/assets/vendor/qrcode-utf8.mjs";

qrcode.stringToBytes = stringToBytes;

const MARGIN = 2;

const qrText = document.getElementById("qrText");
const errorLevel = document.getElementById("errorLevel");
const cellSize = document.getElementById("cellSize");
const cellSizeVal = document.getElementById("cellSizeVal");
const canvas = document.getElementById("qrCanvas");
const downloadPngBtn = document.getElementById("downloadPngBtn");
const downloadSvgBtn = document.getElementById("downloadSvgBtn");
const statusEl = document.getElementById("status");

let currentQr = null;

function drawToCanvas(qr, size) {
  const count = qr.getModuleCount();
  const px = (count + MARGIN * 2) * size;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + MARGIN) * size, (r + MARGIN) * size, size, size);
      }
    }
  }
}

function render() {
  const text = qrText.value.trim();
  const size = Number(cellSize.value);
  if (!text) {
    currentQr = null;
    canvas.width = 0;
    canvas.height = 0;
    clearStatus(statusEl);
    return;
  }
  try {
    const qr = qrcode(0, errorLevel.value);
    qr.addData(text);
    qr.make();
    currentQr = qr;
    drawToCanvas(qr, size);
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    currentQr = null;
    setStatus(statusEl, `Could not generate a QR code: ${err.message || "text may be too long"}`, "error");
    statusEl.classList.add("visible");
  }
}

qrText.addEventListener("input", render);
errorLevel.addEventListener("change", render);
cellSize.addEventListener("input", () => {
  cellSizeVal.textContent = cellSize.value;
  render();
});

downloadPngBtn.addEventListener("click", async () => {
  if (!currentQr) {
    setStatus(statusEl, "Enter some text first.", "error");
    statusEl.classList.add("visible");
    return;
  }
  const blob = await canvasToBlob(canvas, "image/png");
  triggerDownload(blob, brandFilename("qr-code-generator", "qrcode", "png"));
});

downloadSvgBtn.addEventListener("click", () => {
  if (!currentQr) {
    setStatus(statusEl, "Enter some text first.", "error");
    statusEl.classList.add("visible");
    return;
  }
  const svg = currentQr.createSvgTag(Number(cellSize.value), MARGIN * Number(cellSize.value));
  const blob = new Blob([svg], { type: "image/svg+xml" });
  triggerDownload(blob, brandFilename("qr-code-generator", "qrcode", "svg"));
});
