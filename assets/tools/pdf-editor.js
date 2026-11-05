// PDF Editor page. Breaking text into lines, where each line sits and finding a page's background colour is editor-core.js; this file is
// the page around it: the page shown with the things added to it as boxes that can be dragged and resized, the panel for what is
// selected, undo, and writing it all into the PDF. The preview and the saved PDF share the same line breaking and placement.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, enterShownSpace } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { parsePageSpec, safeBaseName } from "/assets/tools/page-tools.js";
import { pdfSafe } from "/assets/tools/sign-core.js";
import { wrapText, baselineFromTop, textHeight, lineX, keepOnPage, toHex, fromHex, medianColour, describeItems } from "/assets/tools/editor-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const pageCanvas = $("pageCanvas");
const layer = $("edLayer");
const stage = $("edStage");
const runBtn = $("runBtn");

// items: { id, kind: text | picture | box, page (from 0), x, y, w, h (points from the page's top left), and for text: text, font (Helvetica,
// TimesRoman, Courier), size, bold, italic, colour, align, spacing; for a box: fillOn, fill, stroke, strokeW; for a picture: canvas, src, alpha;
// and opacity (0 to 1) on all }
const state = { file: null, pj: null, count: 0, page: 0, size: { w: 595, h: 842 }, items: [], selected: null, nextId: 1, token: 0, generation: 0, undo: [], redo: [], result: null };
const MIN = 10;

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

const byId = (id) => state.items.find((i) => i.id === id);
const selectedItem = () => (state.selected ? byId(state.selected) : null);
const onPage = () => state.items.filter((i) => i.page === state.page);

// ---------------------------------------------------------------- measuring text

// the standard fonts, embedded once in a scratch document just to measure with: the saved PDF uses the very same widths
const FONT_KEYS = ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique", "TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic", "Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"];
const fonts = {};
const fontsReady = (async () => {
  const scratch = await PDFLib.PDFDocument.create();
  for (const key of FONT_KEYS) fonts[key] = await scratch.embedFont(PDFLib.StandardFonts[key]);
})();

const fontKey = (it) => it.font + (it.bold ? "Bold" : "") + (it.italic ? (it.font === "TimesRoman" ? "Italic" : "Oblique") : "");
// browser fonts that match the standard ones in width and in how high the baseline sits
const CSS_FAMILY = { Helvetica: 'Arial, "Liberation Sans", Helvetica, sans-serif', TimesRoman: '"Times New Roman", "Liberation Serif", Times, serif', Courier: '"Courier New", "Liberation Mono", Courier, monospace' };
const cssFont = (it, size = it.size) => `${it.italic ? "italic " : ""}${it.bold ? "bold " : ""}${size}px ${CSS_FAMILY[it.font]}`;

const scratchCtx = document.createElement("canvas").getContext("2d");
function measureFor(it) {
  const f = fonts[fontKey(it)];
  return (str) => {
    if (f && pdfSafe(str)) return f.widthOfTextAtSize(str, it.size);
    scratchCtx.font = cssFont(it);
    return scratchCtx.measureText(str).width;
  };
}

// the lines of a text item, and how tall it makes the box
function layoutText(it) {
  const lines = wrapText(it.text, it.w, measureFor(it));
  it.h = textHeight(lines.length, it.size, it.spacing);
  return lines;
}

// ---------------------------------------------------------------- history

function snapshot() { return state.items.map((i) => ({ ...i })); }
let lastRemember = 0;
let lastKey = "";
// call before a change; changes of one kind close together (typing, dragging a slider) are one step
function remember(key = "", throttle = 0) {
  const now = Date.now();
  if (throttle && key === lastKey && now - lastRemember < throttle) { lastRemember = now; return; }
  lastKey = key;
  lastRemember = now;
  state.undo.push(snapshot());
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
  refreshPanel();
}
function restore(items) {
  state.items = items.map((i) => ({ ...i }));
  if (state.selected && !byId(state.selected)) state.selected = null;
  renderItems();
  syncSelection();
  refreshPanel();
}
function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
}
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);

// ---------------------------------------------------------------- the page

function setScale() {
  const ratio = stage.clientWidth / state.size.w || 1;
  layer.style.width = `${state.size.w}px`;
  layer.style.height = `${state.size.h}px`;
  layer.style.transform = `scale(${ratio})`;
  state.ratio = ratio;
}
if (window.ResizeObserver) new ResizeObserver(setScale).observe(stage);

async function showPage(index) {
  const token = ++state.token;
  state.page = Math.min(Math.max(0, index), state.count - 1);
  $("pageNum").value = String(state.page + 1);
  $("prevPageBtn").disabled = state.page <= 0;
  $("nextPageBtn").disabled = state.page >= state.count - 1;
  const page = await state.pj.getPage(state.page + 1);
  const vp = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = await renderPageThumbCanvas(state.pj, state.page + 1, Math.round(900 * dpr));
  if (token !== state.token) return;
  state.size = { w: vp.width, h: vp.height };
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext("2d").drawImage(canvas, 0, 0);
  setScale();
  renderItems();
  syncSelection();
}

async function loadFile(file) {
  const generation = ++state.generation;
  setMsg("Reading your PDF…");
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  const pj = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { pj.loadingTask.destroy(); return; }
  Object.assign(state, { file, pj, count: pj.numPages, items: [], selected: null, undo: [], redo: [], result: null });
  $("pageNum").max = String(state.count);
  $("pageTotal").textContent = String(state.count);
  $("pagerPages").hidden = state.count < 2;
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("edWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "edited");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  await fontsReady;
  await showPage(0);
  clearStatus(statusEl);
  refreshPanel();
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
if (window.KeepSorted) KeepSorted.init({ currentTool: "pdf-editor", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  state.token++;
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  Object.assign(state, { file: null, pj: null, count: 0, items: [], selected: null, undo: [], redo: [], result: null });
  layer.innerHTML = "";
  $("edWrap").hidden = true;
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  refreshPanel();
});

$("prevPageBtn").addEventListener("click", () => showPage(state.page - 1));
$("nextPageBtn").addEventListener("click", () => showPage(state.page + 1));
$("pageNum").addEventListener("change", () => {
  const n = parseInt($("pageNum").value, 10);
  showPage(Number.isFinite(n) ? n - 1 : state.page);
});

// ---------------------------------------------------------------- the things on the page, as boxes

function placeEl(it, el) {
  el.style.left = `${it.x}px`;
  el.style.top = `${it.y}px`;
  el.style.width = `${it.w}px`;
  el.style.height = `${it.h}px`;
}

function buildEl(it) {
  const el = document.createElement("div");
  el.className = `ed-item ed-${it.kind}${it.id === state.selected ? " selected" : ""}`;
  el.dataset.id = String(it.id);
  el.tabIndex = 0;
  el.style.opacity = String(it.opacity);
  if (it.kind === "text") {
    const lines = layoutText(it);
    const body = document.createElement("div");
    body.className = "ed-text-body";
    body.textContent = lines.join("\n");
    Object.assign(body.style, { font: cssFont(it), lineHeight: `${it.size * it.spacing}px`, color: it.colour, textAlign: it.align });
    el.appendChild(body);
  } else if (it.kind === "box") {
    el.style.background = it.fillOn ? it.fill : "transparent";
    el.style.border = it.strokeW ? `${it.strokeW}px solid ${it.stroke}` : "0";
    el.style.boxSizing = "border-box";
  } else {
    const img = document.createElement("img");
    img.src = it.src;
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);
  }
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const h = document.createElement("span");
    h.className = `ed-handle ${corner}`;
    h.dataset.handle = corner;
    el.appendChild(h);
  }
  placeEl(it, el);
  return el;
}

function renderItems() {
  layer.innerHTML = "";
  for (const it of onPage()) layer.appendChild(buildEl(it));
  $("edHint").textContent = state.pj ? (state.items.length ? "Drag to move, drag a corner to resize. Arrow keys nudge, Delete removes, Ctrl+Z undoes." : "Add text, a picture or a box from the right, then drag it where you want it.") : "";
}

function refreshEl(it) {
  const old = layer.querySelector(`[data-id="${it.id}"]`);
  const el = buildEl(it);
  if (old) old.replaceWith(el); else layer.appendChild(el);
}

const toPage = (e) => {
  const r = layer.getBoundingClientRect();
  return { x: (e.clientX - r.left) / (state.ratio || 1), y: (e.clientY - r.top) / (state.ratio || 1) };
};

// dragging and resizing
let drag = null;
layer.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".ed-item");
  if (!el) { select(null); return; }
  const it = byId(Number(el.dataset.id));
  if (!it) return;
  e.preventDefault();
  const handle = e.target.dataset.handle || null;
  if (state.selected !== it.id) select(it.id);
  const live = layer.querySelector(`[data-id="${it.id}"]`);
  try { live.setPointerCapture(e.pointerId); } catch (err) { /* no pointer to capture */ }
  const p = toPage(e);
  drag = { id: it.id, handle, start: p, orig: { x: it.x, y: it.y, w: it.w, h: it.h }, moved: false, el: live };
});
layer.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const it = byId(drag.id);
  if (!it) return;
  const p = toPage(e);
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
  if (!drag.moved) { remember(`drag${it.id}`); drag.moved = true; }
  const o = drag.orig;
  if (!drag.handle) {
    Object.assign(it, keepOnPage({ x: o.x + dx, y: o.y + dy, w: it.w, h: it.h }, state.size));
  } else {
    const west = drag.handle.includes("w");
    const north = drag.handle.includes("n");
    let w = Math.max(MIN, o.w + (west ? -dx : dx));
    let h = Math.max(MIN, o.h + (north ? -dy : dy));
    if (it.kind === "picture") h = w / (o.w / o.h);
    it.w = w;
    if (it.kind === "text") layoutText(it); // the height follows the width
    else it.h = h;
    it.x = west ? o.x + o.w - it.w : o.x;
    it.y = north && it.kind !== "text" ? o.y + o.h - it.h : o.y;
  }
  if (it.kind === "text") {
    // the lines can change as the box does
    const body = drag.el.querySelector(".ed-text-body");
    if (body) body.textContent = layoutText(it).join("\n");
  }
  placeEl(it, drag.el);
});
const endDrag = () => { if (drag && drag.moved) syncSelection(); drag = null; };
layer.addEventListener("pointerup", endDrag);
layer.addEventListener("pointercancel", endDrag);
layer.addEventListener("dblclick", (e) => {
  const el = e.target.closest(".ed-item");
  const it = el && byId(Number(el.dataset.id));
  if (it && it.kind === "text") { $("selText").focus(); $("selText").select(); }
});

// ---------------------------------------------------------------- selecting, and the panel for what is selected

function select(id, open = true) {
  state.selected = id;
  layer.querySelectorAll(".ed-item").forEach((el) => el.classList.toggle("selected", Number(el.dataset.id) === id));
  syncSelection();
  if (id && open) { const d = document.querySelector('[data-key="selected"]'); if (d && !d.open) d.open = true; }
  refreshPanel();
}

function syncSelection() {
  const it = selectedItem();
  $("noSel").hidden = !!it;
  $("selPanel").hidden = !it;
  if (!it) return;
  $("textOpts").hidden = it.kind !== "text";
  $("boxOpts").hidden = it.kind !== "box";
  if (it.kind === "text") {
    if (document.activeElement !== $("selText")) $("selText").value = it.text;
    $("selFont").value = it.font;
    $("selSize").value = String(it.size);
    $("selColour").value = it.colour;
    $("selBold").checked = it.bold;
    $("selItalic").checked = it.italic;
    $("selAlign").value = it.align;
    $("selSpacing").value = String(it.spacing);
  }
  if (it.kind === "box") {
    $("selFill").value = it.fill;
    $("selFillOn").value = it.fillOn ? "1" : "0";
    $("selStroke").value = it.stroke;
    $("selStrokeW").value = String(it.strokeW);
  }
  $("selOpacity").value = String(Math.round(it.opacity * 100));
  $("selOpacityVal").textContent = String(Math.round(it.opacity * 100));
}

// changing the selected item from the panel
function change(fn, key) {
  const it = selectedItem();
  if (!it) return;
  remember(key, 700);
  fn(it);
  if (it.kind === "text") Object.assign(it, keepOnPage(it, state.size));
  refreshEl(it);
  refreshPanel();
}
$("selText").addEventListener("input", () => change((it) => { it.text = $("selText").value; }, "text"));
$("selFont").addEventListener("change", () => change((it) => { it.font = $("selFont").value; }, "font"));
$("selSize").addEventListener("input", () => change((it) => { it.size = Math.min(200, Math.max(4, Number($("selSize").value) || it.size)); }, "size"));
$("selColour").addEventListener("input", () => change((it) => { it.colour = $("selColour").value; }, "colour"));
$("selBold").addEventListener("change", () => change((it) => { it.bold = $("selBold").checked; }, "bold"));
$("selItalic").addEventListener("change", () => change((it) => { it.italic = $("selItalic").checked; }, "italic"));
$("selAlign").addEventListener("change", () => change((it) => { it.align = $("selAlign").value; }, "align"));
$("selSpacing").addEventListener("change", () => change((it) => { it.spacing = Number($("selSpacing").value) || 1.2; }, "spacing"));
$("selFill").addEventListener("input", () => change((it) => { it.fill = $("selFill").value; it.fillOn = true; }, "fill"));
$("selFillOn").addEventListener("change", () => change((it) => { it.fillOn = $("selFillOn").value === "1"; }, "fillOn"));
$("selStroke").addEventListener("input", () => change((it) => { it.stroke = $("selStroke").value; if (!it.strokeW) it.strokeW = 1; }, "stroke"));
$("selStrokeW").addEventListener("change", () => change((it) => { it.strokeW = Number($("selStrokeW").value); }, "strokeW"));
$("selOpacity").addEventListener("input", () => change((it) => { it.opacity = Number($("selOpacity").value) / 100; $("selOpacityVal").textContent = $("selOpacity").value; }, "opacity"));
$("matchBtn").addEventListener("click", () => change((it) => { const c = pageColourAround(it); if (c) { it.fill = c; it.fillOn = true; } }, "match"));

// ---------------------------------------------------------------- adding

function newItem(kind, extra = {}) {
  const w = kind === "text" ? 220 : 160;
  const n = onPage().length % 6; // each new thing lands a little below and right of the last, so they do not hide each other
  return {
    id: state.nextId++, kind, page: state.page, x: Math.max(0, (state.size.w - w) / 2 + n * 18), y: Math.max(0, state.size.h * 0.2 + n * 28), w, h: 28, opacity: 1,
    text: "", font: "Helvetica", size: 16, bold: false, italic: false, colour: "#1a1a1a", align: "left", spacing: 1.2,
    fillOn: true, fill: "#ffffff", stroke: "#1a1a1a", strokeW: 0, ...extra,
  };
}

function addItem(it) {
  remember();
  state.items.push(it);
  Object.assign(it, keepOnPage(it.kind === "text" ? (layoutText(it), it) : it, state.size));
  renderItems();
  select(it.id);
  if (it.kind === "text") { $("selText").focus(); $("selText").select(); }
}

// the page's own colour around a box: the median colour of a thin ring just outside it
function pageColourAround(it) {
  const k = pageCanvas.width / state.size.w;
  const ctx = pageCanvas.getContext("2d");
  const pad = 3;
  const x0 = Math.max(0, Math.floor((it.x - pad) * k));
  const y0 = Math.max(0, Math.floor((it.y - pad) * k));
  const x1 = Math.min(pageCanvas.width, Math.ceil((it.x + it.w + pad) * k));
  const y1 = Math.min(pageCanvas.height, Math.ceil((it.y + it.h + pad) * k));
  const t = Math.max(1, Math.round(pad * k));
  const strips = [[x0, y0, x1 - x0, t], [x0, y1 - t, x1 - x0, t], [x0, y0, t, y1 - y0], [x1 - t, y0, t, y1 - y0]];
  const data = [];
  for (const [x, y, w, h] of strips) if (w > 0 && h > 0) data.push(...ctx.getImageData(x, y, w, h).data);
  const c = medianColour(data);
  return c ? toHex(c) : null;
}

document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
  if (!state.pj) return;
  const kind = b.dataset.add;
  if (kind === "picture") { $("imageInput").click(); return; }
  if (kind === "text") addItem(newItem("text", { text: "New text" }));
  else if (kind === "box") addItem(newItem("box", { w: 160, h: 80, fill: "#fff3a0", fillOn: true, strokeW: 1, opacity: 1 }));
  else {
    const it = newItem("box", { w: 200, h: 26 });
    it.fill = pageColourAround(it) || "#ffffff";
    addItem(it);
  }
}));

$("imageInput").addEventListener("change", async () => {
  const file = $("imageInput").files && $("imageInput").files[0];
  $("imageInput").value = "";
  if (!file || !state.pj) return;
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
    const alpha = file.type !== "image/jpeg";
    const w = Math.min(220, state.size.w * 0.5);
    addItem(newItem("picture", { canvas: c, alpha, src: c.toDataURL(alpha ? "image/png" : "image/jpeg", 0.92), w, h: w * (c.height / c.width) }));
  } catch (err) {
    setMsg("That picture could not be read. Try a PNG, JPG or WebP.", "error");
  } finally {
    URL.revokeObjectURL(url);
  }
});

// ---------------------------------------------------------------- copying, ordering, deleting

function removeItem(id) {
  remember();
  state.items = state.items.filter((i) => i.id !== id);
  if (state.selected === id) state.selected = null;
  renderItems();
  syncSelection();
  refreshPanel();
}
function duplicate() {
  const it = selectedItem();
  if (!it) return;
  remember();
  const copy = { ...it, id: state.nextId++ };
  Object.assign(copy, keepOnPage({ ...copy, x: copy.x + 12, y: copy.y + 12 }, state.size));
  state.items.push(copy);
  renderItems();
  select(copy.id, false);
}
function copyTo(pages) {
  const it = selectedItem();
  if (!it) return;
  const targets = pages.filter((p) => p - 1 !== it.page);
  if (!targets.length) { setMsg("It is already on every page you asked for."); return; }
  remember();
  for (const p of targets) state.items.push({ ...it, id: state.nextId++, page: p - 1 });
  refreshPanel();
  setMsg(`Copied to ${targets.length} page${targets.length === 1 ? "" : "s"}, in the same place.`);
}
function reorder(dir) {
  const it = selectedItem();
  if (!it) return;
  const i = state.items.indexOf(it);
  let j = i + dir;
  while (j >= 0 && j < state.items.length && state.items[j].page !== it.page) j += dir;
  if (j < 0 || j >= state.items.length) return;
  remember();
  [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
  renderItems();
}
$("deleteBtn").addEventListener("click", () => { const it = selectedItem(); if (it) removeItem(it.id); });
$("dupBtn").addEventListener("click", duplicate);
$("frontBtn").addEventListener("click", () => reorder(1));
$("backBtn").addEventListener("click", () => reorder(-1));
$("copyBtn").addEventListener("click", () => {
  const r = parsePageSpec($("copyPages").value.trim() || "1-", state.count);
  if (r.error) { setMsg(r.error, "error"); return; }
  copyTo(r.pages);
});
$("copyAllBtn").addEventListener("click", () => copyTo(Array.from({ length: state.count }, (_, i) => i + 1)));

document.addEventListener("keydown", (e) => {
  if (!state.pj) return;
  const t = e.target;
  const typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && !typing && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (typing) return;
  const it = selectedItem();
  if (!it) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeItem(it.id); return; }
  if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); return; }
  const step = e.shiftKey ? 10 : 1;
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (move) {
    e.preventDefault();
    remember(`nudge${it.id}`, 600);
    Object.assign(it, keepOnPage({ ...it, x: it.x + move[0], y: it.y + move[1] }, state.size));
    const el = layer.querySelector(`[data-id="${it.id}"]`);
    if (el) placeEl(it, el);
  }
});

// ---------------------------------------------------------------- the panel as a whole

function refreshPanel() {
  const has = !!state.pj;
  $("undoBtn").disabled = !state.undo.length;
  $("redoBtn").disabled = !state.redo.length;
  runBtn.disabled = !has || !state.items.length || runBtn.dataset.busy === "1";
  $("clearBtn").disabled = !has;
  const sum = $("summary");
  sum.classList.remove("is-error");
  sum.textContent = !has ? "Add a PDF to begin." : state.items.length ? describeItems(state.items) : "Add text, a picture or a box to begin.";
  document.querySelectorAll("[data-add]").forEach((b) => { b.disabled = !has; });
  const it = selectedItem();
  $("copyBtn").disabled = $("copyAllBtn").disabled = $("dupBtn").disabled = $("deleteBtn").disabled = !it;
}

if (window.FGPAcc) {
  FGPAcc.set("add", () => (state.items.length ? `${state.items.length} added` : "Text, picture, box"));
  FGPAcc.set("selected", () => { const it = selectedItem(); return it ? { text: "Text box", picture: "Picture", box: "Box" }[it.kind] : "Nothing selected"; });
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

// ---------------------------------------------------------------- writing it into the PDF

const blobOf = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
const rgbOf = (hex) => { const c = fromHex(hex); return PDFLib.rgb(c.r / 255, c.g / 255, c.b / 255); };

// a text box as a picture, for text the PDF's own fonts can't set
function textPicture(it, lines) {
  const k = 3;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(it.w * k));
  c.height = Math.max(1, Math.ceil(it.h * k));
  const g = c.getContext("2d");
  g.font = cssFont(it, it.size * k);
  g.fillStyle = it.colour;
  g.textBaseline = "alphabetic";
  lines.forEach((line, li) => {
    const w = g.measureText(line).width / k;
    g.fillText(line, (lineX({ x: 0, w: it.w }, w, it.align)) * k, baselineFromTop(it.font, it.size, it.spacing, li) * k);
  });
  return c;
}

runBtn.addEventListener("click", async () => {
  if (!state.file || !state.items.length) return;
  runBtn.dataset.busy = "1";
  runBtn.disabled = true;
  setMsg("Saving…");
  try {
    const doc = await loadEditable(state.file);
    const pages = doc.getPages();
    const embedded = new Map();
    const embedFont = async (key) => {
      if (!embedded.has(key)) embedded.set(key, await doc.embedFont(PDFLib.StandardFonts[key]));
      return embedded.get(key);
    };
    const pictures = new Map();
    const embedCanvas = async (canvas, alpha) => {
      if (!pictures.has(canvas)) {
        const blob = await blobOf(canvas, alpha ? "image/png" : "image/jpeg", 0.92);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        pictures.set(canvas, alpha ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
      }
      return pictures.get(canvas);
    };
    let asPicture = 0;
    for (const [i, page] of pages.entries()) {
      const mine = state.items.filter((it) => it.page === i);
      if (!mine.length) continue;
      const shown = enterShownSpace(page);
      const H = shown.height;
      for (const it of mine) {
        if (it.kind === "box") {
          page.drawRectangle({ x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, color: it.fillOn ? rgbOf(it.fill) : undefined, opacity: it.opacity, borderColor: it.strokeW ? rgbOf(it.stroke) : undefined, borderWidth: it.strokeW || 0, borderOpacity: it.opacity });
        } else if (it.kind === "picture") {
          page.drawImage(await embedCanvas(it.canvas, it.alpha), { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, opacity: it.opacity });
        } else {
          const lines = layoutText(it);
          if (!it.text.trim()) continue;
          if (!lines.every(pdfSafe)) {
            asPicture++;
            const img = await embedCanvas(textPicture(it, lines), true);
            page.drawImage(img, { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, opacity: it.opacity });
            continue;
          }
          const font = await embedFont(fontKey(it));
          lines.forEach((line, li) => {
            if (!line) return;
            const w = font.widthOfTextAtSize(line, it.size);
            page.drawText(line, { x: lineX(it, w, it.align), y: H - (it.y + baselineFromTop(it.font, it.size, it.spacing, li)), size: it.size, font, color: rgbOf(it.colour), opacity: it.opacity });
          });
        }
      }
      shown.done();
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("pdf-editor", safeBaseName($("prefix").value, "edited"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${state.count} page${state.count === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    $("resultNote").textContent = `${describeItems(state.items)} ${asPicture ? `${asPicture} text box${asPicture === 1 ? " has" : "es have"} letters outside the standard fonts, so ${asPicture === 1 ? "it was" : "they were"} stamped as ${asPicture === 1 ? "a picture" : "pictures"}. ` : ""}Open the copy and check each page before you send it. A cover-up hides what is under it but does not remove it: use Redact PDF for that.`;
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({ currentTool: "pdf-editor", blob, filename: outName, els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") }, relatedSection: document.querySelector(".related-tools-section") });
    }
    setMsg(`Sorted, saved (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setMsg(err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.dataset.busy = "0";
    refreshPanel();
  }
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

refreshPanel();
