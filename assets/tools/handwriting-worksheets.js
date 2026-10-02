import { PDFLib } from "/assets/tools/pdf-common.js";

const practiceTextInput = document.getElementById("practiceText");
const tabCursive = document.getElementById("tabCursive");
const tabPrint = document.getElementById("tabPrint");
const sizeSelect = document.getElementById("sizeSelect");
const pageCountInput = document.getElementById("pageCount");
const previewBtn = document.getElementById("previewBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const previewWrap = document.getElementById("wsPreviewWrap");
const previewCanvas = document.getElementById("wsPreview");
const statusEl = document.getElementById("status");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const RENDER_SCALE = 2;

const FONT_FAMILIES = {
  cursive: '"Dancing Script"',
  print: '"Schoolbell"',
};
const FONT_SIZES = { small: 24, medium: 34, large: 48 };

let style = "cursive";

tabCursive.addEventListener("click", () => {
  style = "cursive";
  tabCursive.classList.add("active");
  tabPrint.classList.remove("active");
});
tabPrint.addEventListener("click", () => {
  style = "print";
  tabPrint.classList.add("active");
  tabCursive.classList.remove("active");
});

async function ensureFontLoaded(cssFontFamily, size) {
  try {
    await document.fonts.load(`${size}px ${cssFontFamily}`);
    await document.fonts.ready;
  } catch (err) {
    console.warn("Font load check failed, drawing anyway", err);
  }
}

function drawGuideLines(ctx, y0, baselineY, midlineY) {
  ctx.save();
  ctx.strokeStyle = "#c9c9c9";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(MARGIN, y0);
  ctx.lineTo(PAGE_W - MARGIN, y0);
  ctx.stroke();

  ctx.strokeStyle = "#c9c9c9";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(MARGIN, midlineY);
  ctx.lineTo(PAGE_W - MARGIN, midlineY);
  ctx.stroke();

  ctx.strokeStyle = "#8a8a8a";
  ctx.setLineDash([]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, baselineY);
  ctx.lineTo(PAGE_W - MARGIN, baselineY);
  ctx.stroke();
  ctx.restore();
}

function drawRepeatedText(ctx, text, baselineY, mode) {
  const maxWidth = PAGE_W - MARGIN * 2;
  const gap = ctx.__fontSize * 0.6;
  const wordWidth = ctx.measureText(text).width;
  let x = MARGIN;
  let drawnOnce = false;

  while (!drawnOnce || x + wordWidth <= MARGIN + maxWidth) {
    if (mode === "solid") {
      ctx.fillStyle = "#1a1a1a";
      ctx.fillText(text, x, baselineY);
    } else {
      ctx.save();
      ctx.strokeStyle = "#9a9a9a";
      ctx.lineWidth = Math.max(1, ctx.__fontSize * 0.03);
      ctx.setLineDash([ctx.__fontSize * 0.05, ctx.__fontSize * 0.08]);
      ctx.strokeText(text, x, baselineY);
      ctx.restore();
    }
    drawnOnce = true;
    x += wordWidth + gap;
    if (wordWidth <= 0) break;
  }
}

async function buildWorksheetCanvas(text, styleKey, fontSize) {
  const family = FONT_FAMILIES[styleKey];
  await ensureFontLoaded(family, fontSize);

  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * RENDER_SCALE;
  canvas.height = PAGE_H * RENDER_SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  ctx.font = `${fontSize}px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.__fontSize = fontSize;

  const rowHeight = fontSize * 2.1;
  const availH = PAGE_H - MARGIN * 2;
  const totalRows = Math.max(1, Math.floor(availH / rowHeight));
  const blankRows = totalRows >= 5 ? 2 : totalRows >= 3 ? 1 : 0;

  for (let i = 0; i < totalRows; i++) {
    const rowTop = MARGIN + i * rowHeight;
    const baselineY = rowTop + fontSize * 1.3;
    const toplineY = baselineY - fontSize * 0.9;
    const midlineY = baselineY - fontSize * 0.45;

    drawGuideLines(ctx, toplineY, baselineY, midlineY);

    const mode = i === 0 ? "solid" : i >= totalRows - blankRows ? "blank" : "dashed";
    if (mode !== "blank") drawRepeatedText(ctx, text, baselineY, mode);
  }

  return canvas;
}

async function getSettings() {
  const text = practiceTextInput.value.trim();
  if (!text) {
    setStatus(statusEl, "Type some practice text first.", "error");
    statusEl.classList.add("visible");
    return null;
  }
  const fontSize = FONT_SIZES[sizeSelect.value] || FONT_SIZES.medium;
  return { text, fontSize };
}

previewBtn.addEventListener("click", async () => {
  const settings = await getSettings();
  if (!settings) return;
  previewBtn.disabled = true;
  clearStatus(statusEl);
  try {
    const canvas = await buildWorksheetCanvas(settings.text, style, settings.fontSize);
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    previewCanvas.getContext("2d").drawImage(canvas, 0, 0);
    previewWrap.style.display = "block";
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not build a preview: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  } finally {
    previewBtn.disabled = false;
  }
});

runBtn.addEventListener("click", async () => {
  const settings = await getSettings();
  if (!settings) return;

  runBtn.disabled = true;
  setStatus(statusEl, "Building worksheet…", "");
  statusEl.classList.add("visible");

  try {
    const canvas = await buildWorksheetCanvas(settings.text, style, settings.fontSize);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const imgBytes = new Uint8Array(await blob.arrayBuffer());

    const doc = await PDFLib.PDFDocument.create();
    const image = await doc.embedPng(imgBytes);
    const pageCount = Math.min(20, Math.max(1, Number(pageCountInput.value) || 1));

    for (let i = 0; i < pageCount; i++) {
      const page = doc.addPage([PAGE_W, PAGE_H]);
      page.drawImage(image, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    }

    const bytes = await doc.save();
    const outBlob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(outBlob, brandFilename("handwriting-worksheets", "worksheet", "pdf"));
    setStatus(statusEl, `Sorted — created a ${pageCount}-page worksheet (${formatBytes(outBlob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", () => {
  practiceTextInput.value = "abcdefghijklmnopqrstuvwxyz";
  sizeSelect.value = "medium";
  pageCountInput.value = "1";
  style = "cursive";
  tabCursive.classList.add("active");
  tabPrint.classList.remove("active");
  previewWrap.style.display = "none";
  clearStatus(statusEl);
});
