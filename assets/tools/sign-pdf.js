// Sign PDF page. The rules (turning a spot chosen on the page as shown into the page's own coordinates, dates, which text the PDF's font
// can set) are in sign-core.js, and turning a photo of a signature into one that can be stamped is signature-image.js; this file is
// the page around them: the maker for a signature, the page with the things placed on it, and writing them into the PDF.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { loadSignatureSource, processSignature } from "/assets/tools/signature-image.js";
import { parsePageSpec, safeBaseName } from "/assets/tools/page-tools.js";
import { placeBox, shownSize, formatDate, DATE_STYLES, pdfSafe, keepInside, describeItems } from "/assets/tools/sign-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const stage = $("sigStage");
const pageCanvas = $("pageCanvas");
const layer = $("itemLayer");
const runBtn = $("runBtn");
const pad = $("sigPad");

const SAVED_KEY = "fgp-signatures";
const INK = "#1a1a1a";

// items: what is placed. { id, kind: signature | date | text | tick | cross, page (from 0), x, y (top left, as fractions of the page as shown),
// w (fraction of the page's width, for pictures), size (points, for text), text, canvas (for pictures) }
const state = { file: null, pj: null, count: 0, page: 0, size: { w: 595, h: 842 }, items: [], selected: null, nextId: 1, mode: "draw", sig: null, drawn: false, upload: null, token: 0, result: null, generation: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

// ---------------------------------------------------------------- the page

async function showPage(index) {
  const token = ++state.token;
  state.page = Math.min(Math.max(0, index), state.count - 1);
  $("pageNum").value = String(state.page + 1);
  $("prevPageBtn").disabled = state.page <= 0;
  $("nextPageBtn").disabled = state.page >= state.count - 1;
  const page = await state.pj.getPage(state.page + 1);
  const vp = page.getViewport({ scale: 1 });
  const canvas = await renderPageThumbCanvas(state.pj, state.page + 1, 760);
  if (token !== state.token) return;
  state.size = { w: vp.width, h: vp.height };
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext("2d").drawImage(canvas, 0, 0);
  renderItems();
}

async function loadFile(file) {
  const generation = ++state.generation;
  setMsg("Reading your PDF…");
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  const pj = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { pj.loadingTask.destroy(); return; }
  Object.assign(state, { file, pj, count: pj.numPages, items: [], selected: null, result: null });
  $("pageNum").max = String(state.count);
  $("pageTotal").textContent = String(state.count);
  $("pager").style.display = state.count > 1 ? "flex" : "none";
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("signWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "signed");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  await showPage(state.count > 1 ? state.count - 1 : 0); // signatures usually go on the last page
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
if (window.KeepSorted) KeepSorted.init({ currentTool: "sign-pdf", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  state.token++;
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  Object.assign(state, { file: null, pj: null, count: 0, items: [], selected: null, result: null });
  layer.innerHTML = "";
  $("signWrap").hidden = true;
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
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

// ---------------------------------------------------------------- making a signature

const TABS = { draw: ["tabDraw", "drawPane"], type: ["tabType", "typePane"], upload: ["tabUpload", "uploadPane"] };
function showTab(name) {
  state.mode = name;
  for (const [key, [tab, pane]] of Object.entries(TABS)) {
    $(tab).setAttribute("aria-pressed", String(key === name));
    $(pane).hidden = key !== name;
  }
  refreshSignature();
}
for (const [key, [tab]] of Object.entries(TABS)) $(tab).addEventListener("click", () => showTab(key));

// the pad
const ctx = pad.getContext("2d");
let stroke = null;
const padPoint = (e) => {
  const r = pad.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) };
};
pad.addEventListener("pointerdown", (e) => {
  pad.setPointerCapture(e.pointerId);
  const p = padPoint(e);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = $("penColour").value;
  ctx.lineWidth = Number($("penSize").value) * (pad.width / 500);
  stroke = { last: p };
  state.drawn = true;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
});
pad.addEventListener("pointermove", (e) => {
  if (!stroke) return;
  const p = padPoint(e);
  const mid = { x: (stroke.last.x + p.x) / 2, y: (stroke.last.y + p.y) / 2 }; // curves through the midpoints, so the line is smooth
  ctx.beginPath();
  ctx.moveTo(stroke.mid ? stroke.mid.x : stroke.last.x, stroke.mid ? stroke.mid.y : stroke.last.y);
  ctx.quadraticCurveTo(stroke.last.x, stroke.last.y, mid.x, mid.y);
  ctx.stroke();
  stroke.last = p;
  stroke.mid = mid;
});
const endStroke = () => { if (!stroke) return; stroke = null; refreshSignature(); };
pad.addEventListener("pointerup", endStroke);
pad.addEventListener("pointercancel", endStroke);
$("clearSigBtn").addEventListener("click", () => { ctx.clearRect(0, 0, pad.width, pad.height); state.drawn = false; refreshSignature(); });

// typed
async function typedCanvas() {
  const name = $("typedName").value.trim();
  if (!name) return null;
  const family = $("typedFont").value;
  const fontSize = 96;
  try { await document.fonts.load(`600 ${fontSize}px "${family}"`, name); } catch (err) { /* the fallback font is used */ }
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `600 ${fontSize}px "${family}", cursive`;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(measure.measureText(name).width + 60);
  canvas.height = Math.ceil(fontSize * 1.7);
  const c = canvas.getContext("2d");
  c.font = `600 ${fontSize}px "${family}", cursive`;
  c.fillStyle = $("typedColour").value;
  c.textBaseline = "middle";
  c.fillText(name, 30, canvas.height / 2);
  return trim(canvas);
}
const typedChanged = () => {
  $("typedPreview").textContent = $("typedName").value;
  $("typedPreview").style.fontFamily = `"${$("typedFont").value}", cursive`;
  $("typedPreview").style.color = $("typedColour").value;
  refreshSignature();
};
for (const id of ["typedName", "typedFont", "typedColour"]) $(id).addEventListener("input", typedChanged);

// uploaded
function refreshUploadPreview() {
  if (!state.upload) return;
  const result = processSignature(state.upload.source, { removeBackground: $("optTransparent").checked, trim: $("optTrim").checked });
  state.upload.result = result;
  const prev = $("sigUploadPreview");
  prev.width = result.canvas.width;
  prev.height = result.canvas.height;
  prev.getContext("2d").clearRect(0, 0, prev.width, prev.height);
  prev.getContext("2d").drawImage(result.canvas, 0, 0);
  $("sigUploadWrap").hidden = false;
  refreshSignature();
}
$("sigFile").addEventListener("change", async () => {
  const file = $("sigFile").files && $("sigFile").files[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) { setMsg("Please choose a JPG, PNG or WebP picture of your signature.", "error"); return; }
  try {
    clearStatus(statusEl);
    state.upload = { source: await loadSignatureSource(file), result: null };
    refreshUploadPreview();
  } catch (err) {
    state.upload = null;
    $("sigUploadWrap").hidden = true;
    setMsg(err.message || "Could not read that picture.", "error");
    refreshSignature();
  }
});
$("optTransparent").addEventListener("change", refreshUploadPreview);
$("optTrim").addEventListener("change", refreshUploadPreview);

function trim(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const padding = 4;
  x0 = Math.max(0, x0 - padding); y0 = Math.max(0, y0 - padding); x1 = Math.min(w - 1, x1 + padding); y1 = Math.min(h - 1, y1 + padding);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

let sigRun = 0;
async function refreshSignature() {
  const run = ++sigRun;
  let canvas = null;
  if (state.mode === "draw") canvas = state.drawn ? trim(pad) : null;
  else if (state.mode === "type") canvas = await typedCanvas();
  else canvas = state.upload && state.upload.result ? state.upload.result.canvas : null;
  if (run !== sigRun) return;
  state.sig = canvas;
  state.sigTransparent = state.mode !== "upload" || !state.upload || !state.upload.result || state.upload.result.transparent;
  refreshPanel();
}

// ---------------------------------------------------------------- what is saved on this device

const saved = {
  read() { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]").filter((s) => typeof s.png === "string"); } catch (err) { return []; } },
  write(list) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 6))); return true; } catch (err) { return false; } },
};
function renderSaved() {
  const list = saved.read();
  $("savedSigs").hidden = !list.length;
  const box = $("savedList");
  box.innerHTML = "";
  list.forEach((s, i) => {
    const wrap = document.createElement("div");
    wrap.className = "saved-sig";
    const use = document.createElement("button");
    use.type = "button";
    use.className = "use";
    use.setAttribute("aria-label", `Add saved signature ${i + 1} to the page`);
    use.innerHTML = `<img alt="" src="${s.png}">`;
    use.addEventListener("click", async () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        addItem({ kind: "signature", canvas: c, transparent: true });
      };
      img.src = s.png;
    });
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "✕";
    drop.setAttribute("aria-label", `Forget saved signature ${i + 1}`);
    drop.addEventListener("click", () => { const all = saved.read(); all.splice(i, 1); saved.write(all); renderSaved(); });
    wrap.append(use, drop);
    box.appendChild(wrap);
  });
}
$("forgetAll").addEventListener("click", () => { try { localStorage.removeItem(SAVED_KEY); } catch (err) { /* nothing to forget */ } renderSaved(); });
function keepSignature(canvas) {
  if (!$("keepSig").checked) return;
  const png = canvas.toDataURL("image/png");
  const list = saved.read().filter((s) => s.png !== png);
  list.unshift({ png });
  if (!saved.write(list)) setMsg("This browser would not keep the signature, so it was added to the page only.", "error");
  renderSaved();
}

// ---------------------------------------------------------------- the things placed on the page

const kindName = { signature: "Signature", date: "Date", text: "Text", tick: "Tick", cross: "Cross" };
const isPicture = (it) => it.kind === "signature" || it.kind === "tick" || it.kind === "cross";
const byId = (id) => state.items.find((i) => i.id === id);
const selectedItem = () => (state.selected ? byId(state.selected) : null);

const measureCtx = document.createElement("canvas").getContext("2d");
function textWidthPts(text, size) {
  measureCtx.font = `${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

// an item's size as fractions of the page as shown
function boxOf(it) {
  const { w: pw, h: ph } = state.size;
  if (isPicture(it)) return { wFrac: it.w, hFrac: (it.w * pw * (it.canvas.height / it.canvas.width)) / ph };
  return { wFrac: textWidthPts(it.text, it.size) / pw, hFrac: (it.size * 1.2) / ph };
}

function tickCanvas(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 120;
  const g = c.getContext("2d");
  g.strokeStyle = INK;
  g.lineWidth = 12;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (kind === "tick") { g.moveTo(18, 66); g.lineTo(48, 96); g.lineTo(104, 24); } else { g.moveTo(24, 24); g.lineTo(96, 96); g.moveTo(96, 24); g.lineTo(24, 96); }
  g.stroke();
  return c;
}

function addItem(spec) {
  if (!state.pj) { setMsg("Add a PDF first.", "error"); return; }
  const onPage = state.items.filter((i) => i.page === state.page).length;
  const it = { id: state.nextId++, page: state.page, x: 0.08, y: 0.78 - (onPage % 6) * 0.04, w: 0.28, size: 12, text: "", ...spec };
  if (it.kind === "signature") { it.w = 0.28; it.x = 1 - 0.04 - it.w; it.y = 0.86 - (onPage % 5) * 0.05; }
  if (it.kind === "tick" || it.kind === "cross") { it.canvas = tickCanvas(it.kind); it.w = 0.035; }
  const { wFrac, hFrac } = boxOf(it);
  Object.assign(it, keepInside(it, wFrac, hFrac));
  state.items.push(it);
  state.selected = it.id;
  renderItems();
  refreshPanel();
  setMsg(`${kindName[it.kind]} added to page ${it.page + 1}. Drag it into place.`);
}

for (const b of document.querySelectorAll("[data-add]")) {
  b.addEventListener("click", () => {
    const kind = b.dataset.add;
    if (kind === "signature") {
      if (!state.sig) { setMsg("Make your signature first: draw it, type your name or upload a picture.", "error"); return; }
      const copy = document.createElement("canvas");
      copy.width = state.sig.width;
      copy.height = state.sig.height;
      copy.getContext("2d").drawImage(state.sig, 0, 0);
      keepSignature(copy);
      addItem({ kind, canvas: copy, transparent: state.sigTransparent });
    } else if (kind === "date") {
      addItem({ kind, text: formatDate(new Date(), $("dateStyle").value) });
    } else if (kind === "text") {
      const text = $("newText").value.trim();
      if (!text) { setMsg("Type the text to add first.", "error"); $("newText").focus(); return; }
      addItem({ kind, text });
    } else addItem({ kind });
  });
}

// the page's things, drawn over it
function renderItems() {
  layer.innerHTML = "";
  const k = stage.clientWidth / state.size.w; // pixels for each point
  for (const it of state.items) {
    if (it.page !== state.page) continue;
    const { wFrac } = boxOf(it);
    const el = document.createElement("div");
    el.className = "sig-item";
    el.dataset.id = String(it.id);
    el.tabIndex = 0;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", `${kindName[it.kind]}${it.text ? `: ${it.text}` : ""}. Drag to move it, use the arrow keys to nudge it, plus or minus to resize it, and Delete to remove it.`);
    el.style.left = `${it.x * 100}%`;
    el.style.top = `${it.y * 100}%`;
    if (isPicture(it)) {
      el.style.width = `${wFrac * 100}%`;
      const c = document.createElement("canvas");
      c.width = it.canvas.width;
      c.height = it.canvas.height;
      c.getContext("2d").drawImage(it.canvas, 0, 0);
      el.appendChild(c);
      const handle = document.createElement("span");
      handle.className = "sig-handle";
      handle.setAttribute("aria-hidden", "true");
      el.appendChild(handle);
    } else {
      const t = document.createElement("span");
      t.className = "sig-text";
      t.style.fontSize = `${it.size * k}px`;
      t.textContent = it.text;
      el.appendChild(t);
    }
    layer.appendChild(el);
  }
  refreshSelection();
}
window.addEventListener("resize", () => { if (state.pj) renderItems(); });

function refreshSelection() {
  layer.querySelectorAll(".sig-item").forEach((el) => el.classList.toggle("selected", Number(el.dataset.id) === state.selected));
  const handles = layer.querySelectorAll(".sig-handle");
  handles.forEach((h) => { h.style.display = Number(h.parentElement.dataset.id) === state.selected ? "block" : "none"; });
  refreshPanel();
}

function select(id, jump) {
  state.selected = id;
  const it = byId(id);
  if (jump && it && it.page !== state.page) showPage(it.page);
  else refreshSelection();
}

// drag to move, drag the corner to resize
let drag = null;
const stagePoint = (e) => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
function placeElement(it, el) {
  const { wFrac, hFrac } = boxOf(it);
  Object.assign(it, keepInside(it, wFrac, hFrac));
  el.style.left = `${it.x * 100}%`;
  el.style.top = `${it.y * 100}%`;
  if (isPicture(it)) el.style.width = `${wFrac * 100}%`;
}
layer.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".sig-item");
  if (!el) return;
  const it = byId(Number(el.dataset.id));
  if (!it) return;
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  el.focus();
  if (state.selected !== it.id) { state.selected = it.id; refreshSelection(); }
  const p = stagePoint(e);
  drag = e.target.classList.contains("sig-handle") ? { type: "resize", it, el } : { type: "move", it, el, dx: p.x - it.x, dy: p.y - it.y };
});
layer.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const p = stagePoint(e);
  if (drag.type === "move") { drag.it.x = p.x - drag.dx; drag.it.y = p.y - drag.dy; }
  else drag.it.w = Math.min(0.95, Math.max(0.03, p.x - drag.it.x));
  placeElement(drag.it, drag.el);
  if (drag.type === "resize") syncSelectedControls();
});
const endDrag = () => { drag = null; };
layer.addEventListener("pointerup", endDrag);
layer.addEventListener("pointercancel", endDrag);

layer.addEventListener("keydown", (e) => {
  const el = e.target.closest(".sig-item");
  const it = el && byId(Number(el.dataset.id));
  if (!it) return;
  const step = e.shiftKey ? 0.02 : 0.005;
  let used = true;
  if (e.key === "ArrowLeft") it.x -= step;
  else if (e.key === "ArrowRight") it.x += step;
  else if (e.key === "ArrowUp") it.y -= step;
  else if (e.key === "ArrowDown") it.y += step;
  else if (e.key === "+" || e.key === "=") { if (isPicture(it)) it.w = Math.min(0.95, it.w + step * 2); else it.size = Math.min(60, it.size + 1); }
  else if (e.key === "-" || e.key === "_") { if (isPicture(it)) it.w = Math.max(0.03, it.w - step * 2); else it.size = Math.max(6, it.size - 1); }
  else if (e.key === "Delete" || e.key === "Backspace") { removeItem(it.id); e.preventDefault(); return; }
  else used = false;
  if (!used) return;
  e.preventDefault();
  if (!isPicture(it)) { renderItems(); layer.querySelector(`[data-id="${it.id}"]`)?.focus(); } else placeElement(it, el);
  syncSelectedControls();
});

function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  if (state.selected === id) state.selected = null;
  renderItems();
}

// ---------------------------------------------------------------- the panel

function syncSelectedControls() {
  const it = selectedItem();
  if (!it) return;
  if (isPicture(it)) $("selSize").value = String(Math.round(it.w * state.size.w));
  else $("selSize").value = String(it.size);
  $("selSizeLabel").textContent = isPicture(it) ? `Width (${Math.round(it.w * state.size.w)} pt)` : `Text size (${it.size} pt)`;
}

function refreshPanel() {
  const has = !!state.pj;
  runBtn.disabled = !has || !state.items.length;
  $("clearBtn").disabled = !has;
  document.querySelector('[data-add="signature"]').disabled = !has;
  const sum = $("summary");
  sum.classList.remove("is-error");
  sum.textContent = !has ? "Add a PDF to begin." : state.items.length ? describeItems(state.items) : "Add your signature to a page first.";
  $("noItems").hidden = state.items.length > 0;
  const list = $("itemList");
  list.innerHTML = "";
  state.items.forEach((it) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(it.id === state.selected));
    b.textContent = `${kindName[it.kind]}${it.text ? `, ${it.text.length > 24 ? it.text.slice(0, 24) + "…" : it.text}` : ""}, page ${it.page + 1}`;
    b.addEventListener("click", () => select(it.id, true));
    li.appendChild(b);
    list.appendChild(li);
  });
  const it = selectedItem();
  $("selected").hidden = !it;
  if (it) {
    $("selectedTitle").textContent = `Selected: ${kindName[it.kind].toLowerCase()} on page ${it.page + 1}`;
    $("selTextField").hidden = isPicture(it);
    if (!isPicture(it) && document.activeElement !== $("selText")) $("selText").value = it.text;
    $("selSize").min = isPicture(it) ? "20" : "6";
    $("selSize").max = isPicture(it) ? "400" : "60";
    syncSelectedControls();
  }
  const hint = !has ? "" : state.sig || state.items.length ? "Drag a thing to move it, drag its corner to resize it. The arrow keys nudge it, plus and minus resize it, Delete removes it." : "Make your signature on the right, then add it to the page.";
  $("placeHint").textContent = hint;
}

$("selSize").addEventListener("input", () => {
  const it = selectedItem();
  if (!it) return;
  if (isPicture(it)) it.w = Number($("selSize").value) / state.size.w; else it.size = Number($("selSize").value);
  renderItems();
});
$("selText").addEventListener("input", () => {
  const it = selectedItem();
  if (!it || isPicture(it)) return;
  it.text = $("selText").value || " ";
  renderItems();
});
$("deleteBtn").addEventListener("click", () => { const it = selectedItem(); if (it) removeItem(it.id); });

function copyTo(pages) {
  const it = selectedItem();
  if (!it) return;
  let n = 0;
  for (const p of pages) {
    if (p === it.page + 1 || p < 1 || p > state.count) continue;
    state.items.push({ ...it, id: state.nextId++, page: p - 1 });
    n++;
  }
  renderItems();
  refreshPanel();
  setMsg(n ? `Copied to ${n} page${n === 1 ? "" : "s"}, in the same place.` : "It is already on every page you asked for.");
}
$("copyBtn").addEventListener("click", () => {
  const text = $("copyPages").value.trim();
  const r = parsePageSpec(text || "1-", state.count);
  if (r.error) { setMsg(r.error, "error"); return; }
  copyTo(r.pages);
});
$("copyAllBtn").addEventListener("click", () => copyTo(Array.from({ length: state.count }, (_, i) => i + 1)));

for (const d of Object.keys(DATE_STYLES)) {
  const o = document.createElement("option");
  o.value = d;
  o.textContent = formatDate(new Date(), d);
  $("dateStyle").appendChild(o);
}

if (window.FGPAcc) {
  FGPAcc.set("signature", () => (state.sig ? { draw: "Drawn", type: `Typed, ${$("typedName").value.trim()}`, upload: "Uploaded" }[state.mode] : "Make one"));
  FGPAcc.set("add", () => (state.items.length ? `${state.items.length} added` : "Signature, date, text"));
  FGPAcc.set("items", () => (state.items.length ? `${state.items.length} on ${new Set(state.items.map((i) => i.page)).size} page${new Set(state.items.map((i) => i.page)).size === 1 ? "" : "s"}` : "Nothing placed"));
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}
try { void localStorage.length; } catch (err) { $("keepSig").closest(".qr-field").hidden = true; }

// ---------------------------------------------------------------- writing it into the PDF

const blobOf = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type));

// text as a picture, for characters the PDF's own font lacks
function textPicture(text, size) {
  const scale = 4;
  const c = document.createElement("canvas");
  const m = c.getContext("2d");
  m.font = `${size * scale}px Helvetica, Arial, sans-serif`;
  c.width = Math.ceil(m.measureText(text).width) + 4;
  c.height = Math.ceil(size * scale * 1.25);
  const g = c.getContext("2d");
  g.font = `${size * scale}px Helvetica, Arial, sans-serif`;
  g.fillStyle = INK;
  g.textBaseline = "middle";
  g.fillText(text, 2, c.height / 2);
  return c;
}

runBtn.addEventListener("click", async () => {
  if (!state.file || !state.items.length) return;
  runBtn.disabled = true;
  setMsg("Signing…");
  try {
    const doc = await loadEditable(state.file);
    const pages = doc.getPages();
    const images = new Map(); // canvas -> embedded picture
    let helvetica = null;
    const embed = async (canvas, transparent) => {
      if (!images.has(canvas)) {
        const png = !(transparent === false);
        const blob = await blobOf(canvas, png ? "image/png" : "image/jpeg");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        images.set(canvas, png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
      }
      return images.get(canvas);
    };
    for (const it of state.items) {
      const page = pages[Math.min(it.page, pages.length - 1)];
      const box = page.getCropBox();
      const rot = page.getRotation().angle;
      const shown = shownSize(box, rot);
      let canvas = isPicture(it) ? it.canvas : null;
      if (!isPicture(it) && !pdfSafe(it.text)) canvas = textPicture(it.text, it.size);
      if (canvas) {
        const img = await embed(canvas, it.transparent);
        const wPts = isPicture(it) ? it.w * shown.w : textWidthPts(it.text, it.size);
        const hPts = wPts * (img.height / img.width);
        const at = placeBox({ xFrac: it.x, yFrac: it.y, wPts, hPts, box, rotation: rot });
        page.drawImage(img, { x: at.x, y: at.y, width: wPts, height: hPts, rotate: PDFLib.degrees(at.rotate) });
      } else {
        helvetica = helvetica || (await doc.embedFont(PDFLib.StandardFonts.Helvetica));
        const wPts = helvetica.widthOfTextAtSize(it.text, it.size);
        const hPts = it.size * 1.2;
        const at = placeBox({ xFrac: it.x, yFrac: it.y, wPts, hPts, box, rotation: rot });
        const d = it.size * 0.24; // from the bottom of the box up to the baseline
        const t = (at.rotate * Math.PI) / 180;
        page.drawText(it.text, { x: at.x - d * Math.sin(t), y: at.y + d * Math.cos(t), size: it.size, font: helvetica, color: PDFLib.rgb(0.1, 0.1, 0.1), rotate: PDFLib.degrees(at.rotate) });
      }
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("sign-pdf", safeBaseName($("prefix").value, "signed"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${state.count} page${state.count === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    $("resultNote").textContent = `${describeItems(state.items)} Open the copy and check each page before you send it. This is a visual signature, not a certified digital one.`;
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "sign-pdf",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setMsg(`Sorted, signed (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setMsg(err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    refreshPanel();
  }
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

renderSaved();
typedChanged();
refreshPanel();
