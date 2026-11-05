// Watermark PDF page. Where marks go and how big they are is watermark-core.js; this file is the page around it: the page shown with
// the marks drawn on it from the same layout that is then written into the PDF, the settings, and saving.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, enterShownSpace } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { pdfSafe } from "/assets/tools/sign-core.js";
import { layoutMarks, autoTextSize, bottomLeft, boxExtent, pagesFor, parseHex, describePages, CAP_HEIGHT } from "/assets/tools/watermark-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const pageCanvas = $("pageCanvas");
const markCanvas = $("markCanvas");
const runBtn = $("runBtn");

// the standard fonts a mark can use, and the browser font that looks the same, for the preview and for text stamped as a picture
const FONTS = {
  HelveticaBold: { css: 'bold {n}px Arial, Helvetica, sans-serif' },
  Helvetica: { css: '{n}px Arial, Helvetica, sans-serif' },
  TimesRomanBold: { css: 'bold {n}px "Times New Roman", Times, serif' },
  CourierBold: { css: 'bold {n}px "Courier New", Courier, monospace' },
};
const cssFont = (key, px) => FONTS[key].css.replace("{n}", String(px));

const state = { file: null, pj: null, count: 0, page: 0, size: { w: 595, h: 842 }, kind: "text", picture: null, token: 0, result: null, generation: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

// ---------------------------------------------------------------- the settings, read off the page

const num = (id, fallback) => { const v = Number($(id).value); return Number.isFinite(v) ? v : fallback; };
const angleOf = () => ($("angle").value === "custom" ? Math.max(-180, Math.min(180, num("angleCustom", 0))) : Number($("angle").value));

function settings() {
  return {
    kind: state.kind,
    text: $("wmText").value.trim(),
    font: $("wmFont").value,
    fit: $("sizeMode").value === "fit",
    own: Math.max(1, num("wmSize", state.kind === "text" ? 60 : 40)),
    colour: parseHex($("wmColour").value),
    opacity: Math.min(1, Math.max(0.05, num("wmOpacity", 30) / 100)),
    angle: angleOf(),
    mode: $("mode").value,
    position: document.querySelector("#posGrid [aria-pressed=true]").dataset.pos,
    margin: Math.max(0, num("margin", 36)),
    spacing: $("spacing").value,
    stagger: $("stagger").checked,
    layer: $("layer").value,
    pagesMode: $("pagesMode").value,
    spec: $("pagesSpec").value,
  };
}

// ---------------------------------------------------------------- how big a mark is

const measure = document.createElement("canvas").getContext("2d");
function textWidthAt(font, text, size, pdfFont) {
  if (pdfFont) return pdfFont.widthOfTextAtSize(text, size);
  measure.font = cssFont(font, 100);
  return (measure.measureText(text).width / 100) * size;
}

// the mark for a page of this size: its box, and what it is drawn from
//   -> { w, h, size, kind: "text" | "picture", text, raster }   raster: the text is stamped as a picture
function markFor(s, pageW, pageH, pdfFont) {
  if (s.kind === "picture") {
    const pic = state.picture;
    const aspect = pic.canvas.width / pic.canvas.height;
    let h;
    if (s.fit) {
      const { hw, hh } = boxExtent(aspect, 1, s.angle);
      h = Math.min((0.5 * pageW) / (2 * hw), (0.5 * pageH) / (2 * hh));
    } else h = ((s.own / 100) * pageW) / aspect;
    return { w: h * aspect, h, kind: "picture" };
  }
  const raster = !pdfSafe(s.text);
  const at1 = textWidthAt(s.font, s.text, 1, raster ? null : pdfFont);
  const size = s.fit ? autoTextSize({ textWidthAt1: at1, pageW, pageH, angle: s.angle }) : s.own;
  return { w: at1 * size, h: raster ? size * 1.25 : size * CAP_HEIGHT, size, kind: "text", text: s.text, raster };
}
// text drawn on a transparent canvas, for text the PDF's own fonts can't set; the box is mark.w x mark.h
function textPicture(mark, s) {
  const k = 3;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(mark.w * k));
  c.height = Math.max(1, Math.ceil(mark.h * k));
  const g = c.getContext("2d");
  g.font = cssFont(s.font, mark.size * k);
  g.fillStyle = `rgb(${Math.round(s.colour.r * 255)}, ${Math.round(s.colour.g * 255)}, ${Math.round(s.colour.b * 255)})`;
  g.textBaseline = "middle";
  g.fillText(mark.text, 0, c.height / 2);
  return c;
}

// ---------------------------------------------------------------- the preview

function drawMarks() {
  const ctx = markCanvas.getContext("2d");
  ctx.clearRect(0, 0, markCanvas.width, markCanvas.height);
  if (!state.pj) return;
  const s = settings();
  const ok = s.kind === "picture" ? !!state.picture : s.text.length > 0;
  const { pages } = pagesFor({ mode: s.pagesMode, spec: s.spec, count: state.count });
  const marked = pages.includes(state.page);
  $("pageHint").textContent = !ok ? (s.kind === "picture" ? "Choose a picture to see it on the page." : "Type some text to see it on the page.") : !marked ? "This page is left without a watermark." : s.layer === "behind" ? "Shown on top here. In the PDF it sits behind the page's own text and pictures." : "The watermark is shown as it will be saved. Use Previous and Next to check other pages.";
  if (!ok || !marked) return;
  const { w: pw, h: ph } = state.size;
  const k = markCanvas.width / pw;
  const mark = markFor(s, pw, ph, null);
  const { marks } = layoutMarks({ page: { w: pw, h: ph }, mark: { w: mark.w, h: mark.h }, angle: s.angle, mode: s.mode, position: s.position, margin: s.margin, spacing: s.spacing, stagger: s.stagger });
  const colour = `rgb(${Math.round(s.colour.r * 255)}, ${Math.round(s.colour.g * 255)}, ${Math.round(s.colour.b * 255)})`;
  ctx.globalAlpha = s.opacity;
  for (const m of marks) {
    ctx.save();
    ctx.translate(m.cx * k, (ph - m.cy) * k);
    ctx.rotate((-s.angle * Math.PI) / 180);
    if (mark.kind === "picture") ctx.drawImage(state.picture.canvas, (-mark.w / 2) * k, (-mark.h / 2) * k, mark.w * k, mark.h * k);
    else {
      ctx.font = cssFont(s.font, mark.size * k);
      ctx.fillStyle = colour;
      ctx.textBaseline = mark.raster ? "middle" : "alphabetic";
      ctx.fillText(mark.text, (-mark.w / 2) * k, mark.raster ? 0 : (mark.h / 2) * k);
    }
    ctx.restore();
  }
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
  $("wmWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "watermarked");
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
if (window.KeepSorted) KeepSorted.init({ currentTool: "watermark-pdf", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  state.token++;
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  Object.assign(state, { file: null, pj: null, count: 0, result: null });
  markCanvas.getContext("2d").clearRect(0, 0, markCanvas.width, markCanvas.height);
  $("wmWrap").hidden = true;
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

// ---------------------------------------------------------------- the picture

async function loadPicture(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    state.picture = { canvas: c, alpha: file.type !== "image/jpeg" };
    const prev = $("picPreview");
    prev.width = c.width;
    prev.height = c.height;
    prev.getContext("2d").drawImage(c, 0, 0);
    $("picPreviewBox").hidden = false;
  } catch (err) {
    state.picture = null;
    $("picPreviewBox").hidden = true;
    setMsg("That picture could not be read. Try a PNG, JPG or WebP.", "error");
  } finally {
    URL.revokeObjectURL(url);
  }
  refresh();
}
$("wmFile").addEventListener("change", () => { const f = $("wmFile").files[0]; if (f) loadPicture(f); });

// ---------------------------------------------------------------- the settings panel

function setKind(kind) {
  state.kind = kind;
  $("tabText").setAttribute("aria-pressed", String(kind === "text"));
  $("tabPicture").setAttribute("aria-pressed", String(kind === "picture"));
  $("textPane").hidden = kind !== "text";
  $("picturePane").hidden = kind !== "picture";
  $("colourField").hidden = kind !== "text";
  $("wmSizeLabel").textContent = kind === "text" ? "Type size (pt)" : "Width (% of the page)";
  $("wmSize").value = kind === "text" ? "60" : "40";
  $("wmSize").max = kind === "text" ? "600" : "100";
  refresh();
}
$("tabText").addEventListener("click", () => setKind("text"));
$("tabPicture").addEventListener("click", () => setKind("picture"));

document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { $("wmText").value = b.dataset.pick; refresh(); }));
document.querySelectorAll("#posGrid button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#posGrid button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  refresh();
}));

const POSITION_NAMES = { tl: "Top left", tc: "Top centre", tr: "Top right", ml: "Middle left", mc: "Middle", mr: "Middle right", bl: "Bottom left", bc: "Bottom centre", br: "Bottom right" };

function refresh() {
  const s = settings();
  $("sizeOwn").hidden = s.fit;
  $("angleOwn").hidden = $("angle").value !== "custom";
  $("wmOpacityVal").textContent = String(Math.round(s.opacity * 100));
  $("singleOpts").hidden = s.mode === "tiled";
  $("tiledOpts").hidden = s.mode !== "tiled";
  $("specField").hidden = s.pagesMode !== "pages";
  const has = !!state.pj;
  const ok = s.kind === "picture" ? !!state.picture : s.text.length > 0;
  const chosen = pagesFor({ mode: s.pagesMode, spec: s.spec, count: state.count });
  const sum = $("summary");
  sum.classList.remove("is-error");
  let problem = "";
  if (has && !ok) problem = s.kind === "picture" ? "Choose a picture to stamp." : "Type the text to stamp.";
  else if (has && chosen.error) problem = chosen.error;
  else if (has && !chosen.pages.length) problem = "No pages are selected.";
  runBtn.disabled = !has || !!problem || runBtn.dataset.busy === "1";
  $("clearBtn").disabled = !has;
  if (!has) sum.textContent = "Add a PDF to begin.";
  else if (problem) { sum.textContent = problem; sum.classList.add("is-error"); }
  else sum.textContent = `${s.kind === "picture" ? "Picture" : `"${s.text.length > 24 ? `${s.text.slice(0, 24)}…` : s.text}"`}, ${s.mode === "tiled" ? "repeated" : "one mark"}. ${describePages(chosen.pages.length, state.count)}`;
  drawMarks();
}
for (const el of document.querySelectorAll(".side-settings input, .side-settings select")) {
  el.addEventListener("input", refresh);
  el.addEventListener("change", refresh);
}

if (window.FGPAcc) {
  const PAGES = { all: "Every page", notfirst: "All but the first", odd: "Odd pages", even: "Even pages", pages: "Chosen pages" };
  FGPAcc.set("mark", () => (state.kind === "picture" ? (state.picture ? "Picture" : "Choose one") : $("wmText").value.trim() || "Type some text"));
  FGPAcc.set("look", () => `${$("wmOpacity").value}%, ${angleOf()}°`);
  FGPAcc.set("layout", () => ($("mode").value === "tiled" ? "Repeated" : POSITION_NAMES[settings().position]));
  FGPAcc.set("pages", () => PAGES[$("pagesMode").value] + ($("layer").value === "behind" ? ", behind" : ""));
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

// ---------------------------------------------------------------- writing it into the PDF

const blobOf = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

// a page's own content is drawn in the order of its content streams, so the mark goes first to sit behind it
function sendBehind(page) {
  const ref = page.contentStreamRef;
  if (!ref) return;
  page.node.normalize();
  const contents = page.node.Contents();
  const i = contents && contents.indexOf ? contents.indexOf(ref) : -1;
  if (i > 0) { contents.remove(i); contents.insert(0, ref); }
}

runBtn.addEventListener("click", async () => {
  if (!state.file) return;
  const s = settings();
  const { pages: chosen, error } = pagesFor({ mode: s.pagesMode, spec: s.spec, count: state.count });
  if (error || !chosen.length) return;
  runBtn.dataset.busy = "1";
  runBtn.disabled = true;
  setMsg("Adding the watermark…");
  try {
    const doc = await loadEditable(state.file);
    const pages = doc.getPages();
    const raster = new Map(); // text stamped as a picture: size -> embedded picture
    let pdfFont = null;
    let picture = null;
    if (s.kind === "picture") {
      const blob = await blobOf(state.picture.canvas, state.picture.alpha ? "image/png" : "image/jpeg", 0.92);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      picture = state.picture.alpha ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } else if (pdfSafe(s.text)) pdfFont = await doc.embedFont(PDFLib.StandardFonts[s.font]);
    const colour = PDFLib.rgb(s.colour.r, s.colour.g, s.colour.b);
    let capped = false;
    for (const i of chosen) {
      const page = pages[i];
      const shown = enterShownSpace(page);
      const mark = markFor(s, shown.width, shown.height, pdfFont);
      const laid = layoutMarks({ page: { w: shown.width, h: shown.height }, mark: { w: mark.w, h: mark.h }, angle: s.angle, mode: s.mode, position: s.position, margin: s.margin, spacing: s.spacing, stagger: s.stagger });
      capped = capped || laid.capped;
      let img = picture;
      if (mark.kind === "text" && mark.raster) {
        const key = Math.round(mark.size * 10);
        if (!raster.has(key)) raster.set(key, await doc.embedPng(new Uint8Array(await (await blobOf(textPicture(mark, s), "image/png")).arrayBuffer())));
        img = raster.get(key);
      }
      for (const m of laid.marks) {
        const at = bottomLeft(m.cx, m.cy, mark.w, mark.h, s.angle);
        const rotate = PDFLib.degrees(s.angle);
        if (img) page.drawImage(img, { x: at.x, y: at.y, width: mark.w, height: mark.h, rotate, opacity: s.opacity });
        else page.drawText(mark.text, { x: at.x, y: at.y, size: mark.size, font: pdfFont, color: colour, opacity: s.opacity, rotate });
      }
      shown.done();
      if (s.layer === "behind") sendBehind(page);
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("watermark-pdf", safeBaseName($("prefix").value, "watermarked"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${state.count} page${state.count === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    $("resultNote").textContent = `${describePages(chosen.length, state.count)} ${capped ? "A very small mark was repeated fewer times than would fill the page. " : ""}Open the copy and check a few pages before you send it.`;
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({ currentTool: "watermark-pdf", blob, filename: outName, els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") }, relatedSection: document.querySelector(".related-tools-section") });
    }
    setMsg(`Sorted, watermark added (${formatBytes(blob.size)}).`, "success");
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
