// PDF to Images page. The rules (sizes, names, stacking, colour) are in images-core.js; this file is the page around them.
import { loadPdfJsDoc, renderPageThumbCanvas, breathe } from "/assets/tools/pdf-common.js";
import * as fflate from "/assets/vendor/fflate.min.js";
import { parsePageSpec, compactPages, safeBaseName } from "/assets/tools/page-tools.js";
import { FORMATS, planScale, usesTransparency, imageName, stitchName, planStitch, toGreyscale, toBlackWhite } from "/assets/tools/images-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const pageGrid = $("pageGrid");
const statusEl = $("status");
const exportBtn = $("exportBtn");
const stopBtn = $("stopBtn");
const summaryEl = $("splitSummary");

// sizes: page number -> {w, h} in points, filled as pages are asked about; run: the export in progress, if any
const state = { file: null, doc: null, count: 0, selected: new Set(), sizes: new Map(), results: [], generation: 0, run: null };

// ---------------------------------------------------------------- reading the PDF

let renderChain = Promise.resolve();
let observer = null;

function renderThumb(thumb, generation) {
  if (thumb.dataset.rendered) return;
  thumb.dataset.rendered = "1";
  renderChain = renderChain.then(async () => {
    if (generation !== state.generation) return;
    try {
      const n = Number(thumb.dataset.page);
      const canvas = await renderPageThumbCanvas(state.doc, n, 200);
      if (generation !== state.generation) return;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${n} preview`);
      thumb.querySelector(".thumb-ph").replaceWith(canvas);
    } catch (err) {
      // the placeholder stays; the page still exports
    }
  });
}

// Thumbnails are drawn as they scroll into view, so a 400-page PDF does not make the browser draw 400 pictures up front
function buildGrid(ratio) {
  if (observer) observer.disconnect();
  const generation = state.generation;
  pageGrid.innerHTML = "";
  observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); renderThumb(e.target, generation); } }), { rootMargin: "600px" })
    : null;
  for (let i = 1; i <= state.count; i++) {
    const thumb = document.createElement("div");
    thumb.className = "page-thumb";
    thumb.dataset.page = String(i);
    thumb.innerHTML = `<span class="page-num">${i}</span><div class="thumb-ph" style="aspect-ratio:${ratio}"></div>`;
    thumb.addEventListener("click", () => {
      if (state.selected.has(i)) state.selected.delete(i); else state.selected.add(i);
      selectionChanged(true);
    });
    pageGrid.appendChild(thumb);
    if (observer) observer.observe(thumb); else renderThumb(thumb, generation);
  }
}

async function pageSize(n) {
  if (!state.sizes.has(n)) {
    const v = (await state.doc.getPage(n)).getViewport({ scale: 1 });
    state.sizes.set(n, { w: v.width, h: v.height });
  }
  return state.sizes.get(n);
}

async function loadFile(file) {
  const generation = ++state.generation;
  if (state.run) state.run.stopped = true;
  setStatus(statusEl, "Reading the PDF…", "");
  if (state.doc) state.doc.loadingTask.destroy();
  const doc = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { doc.loadingTask.destroy(); return; }
  Object.assign(state, { file, doc, count: doc.numPages, selected: new Set(Array.from({ length: doc.numPages }, (_, i) => i + 1)), sizes: new Map(), results: [] });
  const first = await pageSize(1);
  buildGrid((first.w / first.h).toFixed(4));
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("gridWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "pages");
  $("results").classList.remove("visible");
  dropzone.classList.add("compact");
  clearStatus(statusEl);
  selectionChanged(true);
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setStatus(statusEl, "Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err && err.name === "PasswordException"
      ? "This PDF is password protected. Remove the password with Unlock PDF first, then bring it back here."
      : `Could not read that PDF: ${String(err.message || "unknown error").replace(/[.\s]+$/, "")}. If it needs a password, remove it with Unlock PDF first.`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "pdf-to-images", dropzone, onFiles: handleFiles });

// ---------------------------------------------------------------- choosing pages

function syncRangeInput() {
  $("rangeInput").value = compactPages([...state.selected]);
  $("rangeNote").textContent = "";
  $("rangeNote").classList.remove("is-error");
  $("rangeInput").setAttribute("aria-invalid", "false");
}

// fromThumbs: the change came from a click or button, so the pages box is rewritten to match
function selectionChanged(fromThumbs) {
  if (fromThumbs) syncRangeInput();
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => el.classList.toggle("selected", state.selected.has(Number(el.dataset.page))));
  updatePlan();
}

$("rangeInput").addEventListener("input", () => {
  const text = $("rangeInput").value;
  const note = $("rangeNote");
  if (!text.trim()) {
    state.selected = new Set();
    note.textContent = "";
  } else {
    const r = parsePageSpec(text, state.count);
    note.textContent = r.error || "";
    note.classList.toggle("is-error", !!r.error);
    $("rangeInput").setAttribute("aria-invalid", String(!!r.error));
    if (r.error) return; // keep the last good selection while the box is mid-typing
    state.selected = new Set(r.pages);
    note.textContent = `${r.pages.length} of ${state.count} pages`;
  }
  selectionChanged(false);
});

for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("click", () => {
    const all = Array.from({ length: state.count }, (_, i) => i + 1);
    const pick = b.dataset.pick;
    state.selected = new Set(
      pick === "all" ? all : pick === "none" ? [] : pick === "odd" ? all.filter((n) => n % 2) : pick === "even" ? all.filter((n) => n % 2 === 0) : all.filter((n) => !state.selected.has(n)),
    );
    selectionChanged(true);
  });
}

// ---------------------------------------------------------------- settings and the plan shown before anything is made

function settings() {
  const format = $("format").value;
  const px = Number($("px").value);
  return {
    format,
    quality: Number($("quality").value) / 100,
    colour: $("colour").value,
    threshold: Number($("threshold").value),
    transparent: usesTransparency(format, $("background").value),
    mode: $("sizeMode").value,
    dpi: Number($("dpi").value),
    px: Number.isFinite(px) ? Math.min(16384, Math.max(16, Math.round(px))) : 1600,
    layout: $("layout").value,
    gap: Math.min(500, Math.max(0, Math.round(Number($("gap").value)) || 0)),
  };
}

const scaleFor = (s, size) => planScale({ widthPt: size.w, heightPt: size.h, mode: s.mode, dpi: s.dpi, px: s.px });

function say(text, isError = false) {
  summaryEl.textContent = text;
  summaryEl.classList.toggle("is-error", isError);
}

let noteToken = 0;
async function updateSizeNote() {
  const token = ++noteToken;
  if (!state.count || !state.selected.size) { $("sizeNote").textContent = ""; return; }
  const n = Math.min(...state.selected);
  const generation = state.generation;
  const size = await pageSize(n);
  if (token !== noteToken || generation !== state.generation) return;
  const p = scaleFor(settings(), size);
  $("sizeNote").textContent = `Page ${n} comes out ${p.width} × ${p.height} px.${p.clamped ? " That is the most a browser can draw, so it is reduced to fit." : ""}`;
}

function updatePlan() {
  const busy = !!state.run;
  if (!state.count) { exportBtn.disabled = true; say("Add a PDF to begin."); $("sizeNote").textContent = ""; return; }
  const n = state.selected.size;
  const s = settings();
  const ext = FORMATS[s.format].ext.toUpperCase();
  exportBtn.disabled = busy || n === 0;
  if (!n) { say("Pick at least one page.", true); updateSizeNote(); return; }
  say(s.layout === "stitch"
    ? `${n} page${n === 1 ? "" : "s"} stacked into one ${ext} image, or more if it would be too tall.`
    : n === 1 ? `1 ${ext} image.` : `${n} ${ext} images, together in one ZIP.`);
  updateSizeNote();
}

function syncControls() {
  const f = FORMATS[$("format").value];
  $("qualityBlock").hidden = !f.lossy;
  $("thresholdBlock").hidden = $("colour").value !== "bw";
  $("background").disabled = !f.alpha;
  $("backgroundHelp").textContent = !f.alpha
    ? "JPG cannot be see-through, so its background is always white."
    : $("background").value === "transparent" ? "Blank areas are see-through. Some viewers show them as black or grey." : "";
  const dpi = $("sizeMode").value === "dpi";
  $("block-dpi").hidden = !dpi;
  $("block-px").hidden = dpi;
  $("block-gap").hidden = $("layout").value !== "stitch";
  $("qualityVal").textContent = $("quality").value;
  $("thresholdVal").textContent = $("threshold").value;
  updatePlan();
}

for (const id of ["format", "colour", "background", "sizeMode", "dpi", "px", "layout", "gap", "quality", "threshold"]) {
  $(id).addEventListener("input", syncControls);
  $(id).addEventListener("change", syncControls);
}

// ---------------------------------------------------------------- making the images

// One page drawn at the planned size, then given its colour treatment
async function drawPage(n, s, plan) {
  const page = await state.doc.getPage(n);
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: s.colour !== "colour" });
  await page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale: plan.scale }),
    background: s.transparent ? "rgba(0,0,0,0)" : "#ffffff",
  }).promise;
  page.cleanup();
  if (s.colour !== "colour") {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (s.colour === "grey") toGreyscale(img.data); else toBlackWhite(img.data, s.threshold);
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

function makeThumb(canvas) {
  const k = 96 / Math.max(canvas.width, canvas.height);
  const t = document.createElement("canvas");
  t.width = Math.max(1, Math.round(canvas.width * k));
  t.height = Math.max(1, Math.round(canvas.height * k));
  t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
  t.className = "result-thumb";
  const box = document.createElement("span"); // a fixed-width box, so the names line up whatever shape each page is
  box.className = "result-thumb-box";
  box.setAttribute("aria-hidden", "true");
  box.appendChild(t);
  return box;
}

async function toResult(canvas, s, name, clamped) {
  const fmt = FORMATS[s.format];
  const blob = await canvasToBlob(canvas, fmt.mime, fmt.lossy ? s.quality : undefined);
  if (!blob || blob.type !== fmt.mime) throw new Error(`This browser could not make a ${fmt.ext.toUpperCase()} image${fmt.ext === "webp" ? ". Try PNG or JPG" : " this big. Try a smaller size"}`);
  return { name, blob, width: canvas.width, height: canvas.height, thumb: makeThumb(canvas), clamped };
}

const sortedPages = () => [...state.selected].sort((a, b) => a - b);

async function makeSeparate(pages, s, base, run) {
  const out = [];
  for (const [i, n] of pages.entries()) {
    if (run.stopped) break;
    setStatus(statusEl, `Making image ${i + 1} of ${pages.length}…`, "");
    await breathe();
    const plan = scaleFor(s, await pageSize(n));
    const canvas = await drawPage(n, s, plan);
    out.push(await toResult(canvas, s, imageName(base, n, state.count, FORMATS[s.format].ext), plan.clamped));
    canvas.width = canvas.height = 0; // lets the browser free the pixels before the next page
  }
  return out;
}

async function makeStitched(pages, s, base, run) {
  const plans = [];
  for (const n of pages) plans.push(scaleFor(s, await pageSize(n)));
  const { width, groups } = planStitch(plans, s.gap);
  const out = [];
  let done = 0;
  for (const g of groups) {
    if (run.stopped) break;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = g.height;
    const ctx = canvas.getContext("2d");
    if (!s.transparent) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, g.height); }
    for (const item of g.items) {
      if (run.stopped) break;
      setStatus(statusEl, `Drawing page ${++done} of ${pages.length}…`, "");
      await breathe();
      const part = await drawPage(pages[item.index], s, plans[item.index]);
      ctx.drawImage(part, item.x, item.y);
      part.width = part.height = 0;
    }
    if (run.stopped) break;
    setStatus(statusEl, "Saving the image…", "");
    await breathe();
    const first = pages[g.items[0].index];
    const last = pages[g.items[g.items.length - 1].index];
    out.push(await toResult(canvas, s, stitchName(base, first, last, FORMATS[s.format].ext), plans.some((p) => p.clamped)));
    canvas.width = canvas.height = 0;
  }
  return out;
}

const download = (r) => triggerDownload(r.blob, brandFilename("pdf-to-images", stripExtension(r.name), r.name.split(".").pop()));

function showResults() {
  const total = state.results.reduce((n, r) => n + r.blob.size, 0);
  $("resultTotal").textContent = `${state.results.length} image${state.results.length === 1 ? "" : "s"}, ${formatBytes(total)} together`;
  $("zipBtn").hidden = state.results.length < 2;
  const box = $("resultItems");
  box.innerHTML = "";
  for (const r of state.results) {
    const row = document.createElement("div");
    row.className = "result-item";
    row.appendChild(r.thumb);
    const info = document.createElement("div");
    info.className = "info";
    info.innerHTML = `<div class="ci-name">${escapeHtml(r.name)}</div><div class="ci-line ci-muted">${r.width} × ${r.height} px · ${formatBytes(r.blob.size)}</div>${r.clamped ? '<div class="ci-note">Reduced to the most a browser can draw.</div>' : ""}`;
    row.appendChild(info);
    const dl = document.createElement("button");
    dl.className = "btn small";
    dl.type = "button";
    dl.textContent = "Download";
    dl.addEventListener("click", () => download(r));
    row.appendChild(dl);
    box.appendChild(row);
  }
  $("results").classList.add("visible");
}

async function downloadZip() {
  const entries = {};
  for (const r of state.results) entries[r.name] = new Uint8Array(await r.blob.arrayBuffer());
  // PNG, JPG and WebP are already compressed, so storing the files is as small as deflating them and much quicker
  const zip = fflate.zipSync(entries, { level: 0 });
  triggerDownload(new Blob([zip], { type: "application/zip" }), brandFilename("pdf-to-images", `${safeBaseName($("prefix").value, "pages")}-images`, "zip"));
}
$("zipBtn").addEventListener("click", downloadZip);

stopBtn.addEventListener("click", () => {
  if (!state.run) return;
  state.run.stopped = true;
  stopBtn.disabled = true;
  setStatus(statusEl, "Stopping…", "");
});

exportBtn.addEventListener("click", async () => {
  const pages = sortedPages();
  if (!pages.length || state.run) return;
  const s = settings();
  const base = safeBaseName($("prefix").value, "pages");
  const run = { stopped: false, generation: state.generation };
  state.run = run;
  exportBtn.disabled = true;
  stopBtn.disabled = false;
  stopBtn.hidden = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none"; // an offer from an earlier run no longer matches
  document.querySelector(".related-tools-section").style.display = "";
  const stale = () => run.generation !== state.generation;
  try {
    const made = s.layout === "stitch" ? await makeStitched(pages, s, base, run) : await makeSeparate(pages, s, base, run);
    if (stale()) return; // another PDF was opened meanwhile
    state.results = made;
    if (!made.length) { setStatus(statusEl, "Stopped before any image was made.", ""); return; }
    showResults();
    if (run.stopped) { setStatus(statusEl, `Stopped. ${made.length} image${made.length === 1 ? " is" : "s are"} ready to download.`, ""); return; }
    if (made.length === 1) download(made[0]); else await downloadZip();
    // with several images there is no single "it" to carry on with, so Keep it sorted is only offered for one
    if (window.KeepSorted && made.length === 1) {
      KeepSorted.offer({
        currentTool: "pdf-to-images",
        blob: made[0].blob,
        filename: brandFilename("pdf-to-images", stripExtension(made[0].name), FORMATS[s.format].ext),
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Done, ${made.length} image${made.length === 1 ? "" : "s"} made${made.length === 1 ? "" : ", downloaded as a ZIP"}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    if (state.run === run) state.run = null;
    stopBtn.hidden = true;
    updatePlan();
  }
});

// what the closed rows of the settings card say
if (window.FGPAcc) {
  const text = (id) => $(id).options[$(id).selectedIndex].text;
  FGPAcc.set("pages", () => (!state.count ? "All pages" : state.selected.size === state.count ? `All ${state.count} pages` : state.selected.size ? compactPages([...state.selected]) : "No pages"));
  FGPAcc.set("image", () => {
    const s = settings();
    return [s.format.toUpperCase() + (FORMATS[s.format].lossy ? ` ${$("quality").value}%` : ""), s.colour === "colour" ? "colour" : text("colour").toLowerCase(), s.transparent ? "see-through" : ""].filter(Boolean).join(", ");
  });
  FGPAcc.set("size", () => { const s = settings(); return s.mode === "dpi" ? `${s.dpi} DPI` : s.mode === "width" ? `${s.px} px wide` : `${s.px} px longest side`; });
  FGPAcc.set("output", () => (settings().layout === "stitch" ? "One long image" : "One image per page"));
}

syncControls();
