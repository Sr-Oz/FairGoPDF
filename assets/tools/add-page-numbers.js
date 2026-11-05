// Add Page Numbers page. How a number is written and where it sits is numbers-core.js, which pages are chosen is pagesFor in
// watermark-core.js; this file is the page around them: the page shown with its number on it, the settings, and saving.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, enterShownSpace } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { pdfSafe } from "/assets/tools/sign-core.js";
import { pagesFor, parseHex, describePages, CAP_HEIGHT } from "/assets/tools/watermark-core.js";
import { STYLES, PRESETS, labelFor, placeLabel, BACKING_PAD } from "/assets/tools/numbers-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const pageCanvas = $("pageCanvas");
const markCanvas = $("markCanvas");
const runBtn = $("runBtn");

// the standard fonts, and the browser font that looks the same, for the preview and for labels stamped as a picture
const CSS_FONTS = {
  Helvetica: "{n}px Arial, Helvetica, sans-serif",
  HelveticaBold: "bold {n}px Arial, Helvetica, sans-serif",
  TimesRoman: '{n}px "Times New Roman", Times, serif',
  Courier: '{n}px "Courier New", Courier, monospace',
};
const cssFont = (key, px) => CSS_FONTS[key].replace("{n}", String(px));
const rgbCss = (c) => `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

const state = { file: null, pj: null, count: 0, page: 0, size: { w: 595, h: 842 }, token: 0, result: null, generation: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

// ---------------------------------------------------------------- the settings, read off the page

const num = (id, fallback) => { const v = Number($(id).value); return Number.isFinite(v) ? v : fallback; };

function settings() {
  return {
    template: $("format").value,
    style: $("style").value,
    start: Math.trunc(num("startNum", 1)),
    digits: Math.min(10, Math.max(1, Math.trunc(num("digits", 1)))),
    position: document.querySelector("#posGrid [aria-pressed=true]").dataset.pos,
    margin: Math.max(0, num("margin", 28)),
    mirror: $("mirror").checked,
    font: $("font").value,
    size: Math.min(48, Math.max(4, num("fontSize", 10))),
    colour: parseHex($("colour").value),
    backing: $("backing").checked,
    pagesMode: $("pagesMode").value,
    spec: $("pagesSpec").value,
  };
}

const labelOf = (s, pageIndex) => labelFor({ template: s.template, pageIndex, total: state.count, start: s.start, style: s.style, digits: s.style === "arabic" ? s.digits : 1 });

const measure = document.createElement("canvas").getContext("2d");
function widthOf(s, text, pdfFont) {
  if (pdfFont) return pdfFont.widthOfTextAtSize(text, s.size);
  measure.font = cssFont(s.font, 100);
  return (measure.measureText(text).width / 100) * s.size;
}

// ---------------------------------------------------------------- the preview

function drawMarks() {
  const ctx = markCanvas.getContext("2d");
  ctx.clearRect(0, 0, markCanvas.width, markCanvas.height);
  if (!state.pj) return;
  const s = settings();
  const { pages } = pagesFor({ mode: s.pagesMode, spec: s.spec, count: state.count });
  const marked = pages.includes(state.page);
  $("pageHint").textContent = marked ? "The number is shown as it will be saved. Use Previous and Next to check other pages." : "This page is left without a number.";
  if (!marked) return;
  const { w: pw, h: ph } = state.size;
  const k = markCanvas.width / pw;
  const text = labelOf(s, state.page);
  const box = { w: widthOf(s, text, null), h: s.size * CAP_HEIGHT };
  const at = placeLabel({ page: { w: pw, h: ph }, box, position: s.position, margin: s.margin, mirror: s.mirror, pageIndex: state.page });
  if (s.backing) {
    const pad = s.size * BACKING_PAD;
    ctx.fillStyle = "#fff";
    ctx.fillRect((at.x - pad) * k, (ph - at.y - box.h - pad) * k, (box.w + 2 * pad) * k, (box.h + 2 * pad) * k);
  }
  ctx.font = cssFont(s.font, s.size * k);
  ctx.fillStyle = rgbCss(s.colour);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, at.x * k, (ph - at.y) * k);
}

async function showPage(index) {
  const token = ++state.token;
  state.page = Math.min(Math.max(0, index), state.count - 1);
  $("pageNum").value = String(state.page + 1);
  $("prevPageBtn").disabled = state.page <= 0;
  $("nextPageBtn").disabled = state.page >= state.count - 1;
  const page = await state.pj.getPage(state.page + 1);
  const vp = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = await renderPageThumbCanvas(state.pj, state.page + 1, Math.round(760 * dpr));
  if (token !== state.token) return;
  state.size = { w: vp.width, h: vp.height };
  pageCanvas.width = markCanvas.width = canvas.width;
  pageCanvas.height = markCanvas.height = canvas.height;
  pageCanvas.getContext("2d").drawImage(canvas, 0, 0);
  drawMarks();
}

// ---------------------------------------------------------------- opening a file

async function loadFile(file) {
  const generation = ++state.generation;
  setMsg("Reading your PDF…");
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  const pj = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { pj.loadingTask.destroy(); return; }
  Object.assign(state, { file, pj, count: pj.numPages, result: null });
  $("pageNum").max = String(state.count);
  $("pageTotal").textContent = String(state.count);
  $("pagerPages").hidden = state.count < 2;
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("numWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "numbered");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  await showPage(0);
  clearStatus(statusEl);
  refresh();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setMsg("Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setMsg(err && err.name === "PasswordException" ? "This PDF is password protected. Remove the password with Unlock PDF first, then bring it back here." : `Could not read that PDF: ${String(err.message || "unknown error").replace(/[.\s]+$/, "")}.`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "add-page-numbers", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  state.token++;
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  Object.assign(state, { file: null, pj: null, count: 0, result: null });
  markCanvas.getContext("2d").clearRect(0, 0, markCanvas.width, markCanvas.height);
  $("numWrap").hidden = true;
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  refresh();
});

$("prevPageBtn").addEventListener("click", () => showPage(state.page - 1));
$("nextPageBtn").addEventListener("click", () => showPage(state.page + 1));
$("pageNum").addEventListener("change", () => {
  const n = parseInt($("pageNum").value, 10);
  showPage(Number.isFinite(n) ? n - 1 : state.page);
});

// ---------------------------------------------------------------- the settings panel

for (const [value, label] of Object.entries(STYLES)) $("style").appendChild(new Option(label, value));
for (const p of PRESETS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn secondary small";
  b.textContent = p.label;
  b.addEventListener("click", () => {
    $("format").value = p.template;
    $("digits").value = String(p.digits || 1);
    if (p.position) document.querySelectorAll("#posGrid button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.pos === p.position)));
    refresh();
  });
  $("presets").appendChild(b);
}
document.querySelectorAll("#posGrid button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#posGrid button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  refresh();
}));

const POSITION_NAMES = { tl: "Top left", tc: "Top centre", tr: "Top right", ml: "Middle left", mc: "Middle", mr: "Middle right", bl: "Bottom left", bc: "Bottom centre", br: "Bottom right" };

function refresh() {
  const s = settings();
  $("digitsField").hidden = s.style !== "arabic";
  $("specField").hidden = s.pagesMode !== "pages";
  const has = !!state.pj;
  const chosen = pagesFor({ mode: s.pagesMode, spec: s.spec, count: state.count });
  const sum = $("summary");
  sum.classList.remove("is-error");
  let problem = "";
  if (has && chosen.error) problem = chosen.error;
  else if (has && !chosen.pages.length) problem = "No pages are selected.";
  runBtn.disabled = !has || !!problem || runBtn.dataset.busy === "1";
  $("clearBtn").disabled = !has;
  if (!has) sum.textContent = "Add a PDF to begin.";
  else if (problem) { sum.textContent = problem; sum.classList.add("is-error"); }
  else {
    const first = chosen.pages[0];
    const sample = labelOf(s, first).slice(0, 30);
    const same = !/\{(n|total)\}/i.test(s.template || "{n}");
    sum.textContent = same ? `Every page will say "${sample}": add {n} to the format for a number. ${describePages(chosen.pages.length, state.count)}` : `Like "${sample}". ${describePages(chosen.pages.length, state.count)}`;
  }
  drawMarks();
}
for (const el of document.querySelectorAll(".side-settings input, .side-settings select")) {
  el.addEventListener("input", refresh);
  el.addEventListener("change", refresh);
}

if (window.FGPAcc) {
  const PAGES = { all: "Every page", notfirst: "All but the first", odd: "Odd pages", even: "Even pages", pages: "Chosen pages" };
  FGPAcc.set("format", () => labelOf(settings(), Math.min(1, Math.max(0, state.count - 1))).slice(0, 22));
  FGPAcc.set("place", () => POSITION_NAMES[settings().position] + (settings().mirror ? ", swapping" : ""));
  FGPAcc.set("look", () => `${$("font").selectedOptions[0].textContent}, ${$("fontSize").value} pt`);
  FGPAcc.set("pages", () => PAGES[$("pagesMode").value]);
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

// ---------------------------------------------------------------- writing it into the PDF

const blobOf = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type));

// a label as a picture on a transparent canvas, for text the PDF's own fonts can't set
function labelPicture(text, s, w) {
  const k = 3;
  const h = s.size * 1.25;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * k));
  c.height = Math.max(1, Math.ceil(h * k));
  const g = c.getContext("2d");
  g.font = cssFont(s.font, s.size * k);
  g.fillStyle = rgbCss(s.colour);
  g.textBaseline = "middle";
  g.fillText(text, 0, c.height / 2);
  return { canvas: c, h };
}

runBtn.addEventListener("click", async () => {
  if (!state.file) return;
  const s = settings();
  const { pages: chosen, error } = pagesFor({ mode: s.pagesMode, spec: s.spec, count: state.count });
  if (error || !chosen.length) return;
  runBtn.dataset.busy = "1";
  runBtn.disabled = true;
  setMsg("Adding page numbers…");
  try {
    const doc = await loadEditable(state.file);
    const pages = doc.getPages();
    const font = await doc.embedFont(PDFLib.StandardFonts[s.font]);
    const colour = PDFLib.rgb(s.colour.r, s.colour.g, s.colour.b);
    const pictures = new Map(); // label text -> embedded picture, for labels the font can't set
    let asPicture = 0;
    for (const i of chosen) {
      const page = pages[i];
      const text = labelOf(s, i);
      const shown = enterShownSpace(page);
      const safe = pdfSafe(text);
      const w = safe ? font.widthOfTextAtSize(text, s.size) : widthOf(s, text, null);
      const capH = s.size * CAP_HEIGHT;
      const at = placeLabel({ page: { w: shown.width, h: shown.height }, box: { w, h: capH }, position: s.position, margin: s.margin, mirror: s.mirror, pageIndex: i });
      if (s.backing) {
        const pad = s.size * BACKING_PAD;
        page.drawRectangle({ x: at.x - pad, y: at.y - pad, width: w + 2 * pad, height: capH + 2 * pad, color: PDFLib.rgb(1, 1, 1) });
      }
      if (safe) page.drawText(text, { x: at.x, y: at.y, size: s.size, font, color: colour });
      else {
        asPicture++;
        if (!pictures.has(text)) {
          const pic = labelPicture(text, s, w);
          pictures.set(text, { img: await doc.embedPng(new Uint8Array(await (await blobOf(pic.canvas, "image/png")).arrayBuffer())), h: pic.h });
        }
        const p = pictures.get(text);
        page.drawImage(p.img, { x: at.x, y: at.y + capH / 2 - p.h / 2, width: w, height: p.h });
      }
      shown.done();
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("add-page-numbers", safeBaseName($("prefix").value, "numbered"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${state.count} page${state.count === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    $("resultNote").textContent = `${describePages(chosen.length, state.count)} ${asPicture ? `${asPicture} label${asPicture === 1 ? " has" : "s have"} letters outside the standard fonts, so ${asPicture === 1 ? "it was" : "they were"} stamped as pictures. ` : ""}Open the copy and check a few pages before you send it.`;
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({ currentTool: "add-page-numbers", blob, filename: outName, els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") }, relatedSection: document.querySelector(".related-tools-section") });
    }
    setMsg(`Sorted, numbered ${chosen.length} page${chosen.length === 1 ? "" : "s"} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setMsg(err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.dataset.busy = "0";
    refresh();
  }
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

refresh();
