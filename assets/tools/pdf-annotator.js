// PDF Annotator page. Following the text a drag covers, smoothing a stroke and sizing each kind of mark is annotate-core.js; this
// file is the page around it: the page shown with its marks drawn over it as SVG, the tools and the panel for what is selected, undo,
// and writing the marks into the PDF the way they are drawn on the screen.
import { PDFLib, pdfjsLib, loadPdfJsDoc, renderPageThumbCanvas, enterShownSpace } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { parsePageSpec, safeBaseName } from "/assets/tools/page-tools.js";
import { pdfSafe } from "/assets/tools/sign-core.js";
import { wrapText } from "/assets/tools/editor-core.js";
import { selectText, strokePath, arrowHead, boundsOf, moved, keepDelta, noteHeight, NOTE_PAD, NOTE_LINE, describeItems } from "/assets/tools/annotate-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const pageCanvas = $("pageCanvas");
const layer = $("anLayer");
const stage = $("anStage");
const runBtn = $("runBtn");
const SVG = "http://www.w3.org/2000/svg";

// items (page counts from 0, positions in points from the page's top left):
//   mark:  { kind: "mark", style: highlight | underline | strike, rects: [{x, y, w, h}], colour }
//   ink:   { kind: "ink", points: [{x, y}], colour, width }
//   shape: { kind: "shape", shape: rect | ellipse | arrow, x1, y1, x2, y2, colour, width }
//   note:  { kind: "note", x, y, w, text, size, colour }   (its height follows its text)
const state = { file: null, pj: null, count: 0, page: 0, size: { w: 595, h: 842 }, runs: [], items: [], selected: null, nextId: 1, tool: "highlight", colours: { highlight: "#fff176", underline: "#e53935", strike: "#e53935", pen: "#e53935", rect: "#e53935", ellipse: "#e53935", arrow: "#e53935", note: "#fff176" }, width: 3, token: 0, generation: 0, undo: [], redo: [], result: null, ratio: 1 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

const byId = (id) => state.items.find((i) => i.id === id);
const selectedItem = () => (state.selected ? byId(state.selected) : null);
const onPage = () => state.items.filter((i) => i.page === state.page);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------- how marks sit on a line of text

// a text run's box runs from the top of its capitals to below its descenders, so the baseline is this share of the way down
const UNDERLINE_AT = 0.9;
const STRIKE_AT = 0.52;
const markLines = (it, r) => (it.style === "underline" ? [r.y + r.h * UNDERLINE_AT] : it.style === "strike" ? [r.y + r.h * STRIKE_AT] : []);
const MARK_WIDTH = 1.4;

const scratch = document.createElement("canvas").getContext("2d");
function measure(text) {
  scratch.font = "20px Arial, Helvetica, sans-serif";
  return scratch.measureText(text).width;
}

// ---------------------------------------------------------------- notes

const NOTE_BASELINE = NOTE_LINE / 2 + 0.3465; // from the top of a line, in sizes
function noteLines(it) {
  scratch.font = `${it.size}px Arial, Helvetica, sans-serif`;
  return wrapText(it.text, it.w - 2 * NOTE_PAD, (s) => scratch.measureText(s).width);
}
function fitNote(it) { it.h = noteHeight(noteLines(it).length, it.size); }

// ---------------------------------------------------------------- history

const snapshot = () => clone(state.items);
let lastRemember = 0;
let lastKey = "";
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
  state.items = items;
  if (state.selected && !byId(state.selected)) state.selected = null;
  render();
  syncSelection();
  refreshPanel();
}
function undo() { if (state.undo.length) { state.redo.push(snapshot()); restore(state.undo.pop()); } }
function redo() { if (state.redo.length) { state.undo.push(snapshot()); restore(state.redo.pop()); } }
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);

// ---------------------------------------------------------------- the page

async function showPage(index) {
  const token = ++state.token;
  state.page = Math.min(Math.max(0, index), state.count - 1);
  $("pageNum").value = String(state.page + 1);
  $("prevPageBtn").disabled = state.page <= 0;
  $("nextPageBtn").disabled = state.page >= state.count - 1;
  const page = await state.pj.getPage(state.page + 1);
  const vp = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const [canvas, content] = await Promise.all([renderPageThumbCanvas(state.pj, state.page + 1, Math.round(900 * dpr)), page.getTextContent()]);
  if (token !== state.token) return;
  state.size = { w: vp.width, h: vp.height };
  // the text on the page, as boxes: the top of the capitals down past the descenders
  state.runs = [];
  for (const it of content.items) {
    if (typeof it.str !== "string" || !it.str.trim()) continue;
    const m = pdfjsLib.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(m[0], m[1]);
    if (!(size > 0) || Math.abs(m[1]) > 0.2 * Math.abs(m[0]) || m[0] < 0) continue; // sideways or upside-down text is left alone
    const unit = Math.hypot(it.transform[0], it.transform[1]) || 1;
    state.runs.push({ str: it.str, x: m[4], y: m[5] - size * 0.9, w: it.width * (size / unit), h: size * 1.15 });
  }
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext("2d").drawImage(canvas, 0, 0);
  layer.setAttribute("viewBox", `0 0 ${state.size.w} ${state.size.h}`);
  setRatio();
  render();
  syncSelection();
}

function setRatio() { state.ratio = stage.clientWidth / state.size.w || 1; }
if (window.ResizeObserver) new ResizeObserver(() => { setRatio(); render(); }).observe(stage);

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
  $("anWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "marked-up");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
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
if (window.KeepSorted) KeepSorted.init({ currentTool: "pdf-annotator", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  state.token++;
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  Object.assign(state, { file: null, pj: null, count: 0, items: [], selected: null, undo: [], redo: [], result: null });
  layer.innerHTML = "";
  $("anWrap").hidden = true;
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

// ---------------------------------------------------------------- drawing the marks

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

// one item as SVG, with a wider invisible copy that is what a click lands on
function drawItem(it, parent, live = false) {
  const g = el("g", live ? {} : { "data-id": it.id, class: "an-item" }, parent);
  if (it.kind === "mark") {
    for (const r of it.rects) {
      if (it.style === "highlight") el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: it.colour, style: "mix-blend-mode:multiply" }, g);
      else {
        for (const y of markLines(it, r)) el("line", { x1: r.x, y1: y, x2: r.x + r.w, y2: y, stroke: it.colour, "stroke-width": MARK_WIDTH }, g);
        el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "transparent", class: "an-hit" }, g);
      }
      if (it.style === "highlight") el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "transparent", class: "an-hit" }, g);
    }
  } else if (it.kind === "ink") {
    const d = strokePath(it.points);
    el("path", { d, fill: "none", stroke: it.colour, "stroke-width": it.width, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    el("path", { d, fill: "none", stroke: "transparent", "stroke-width": Math.max(12, it.width + 8), "stroke-linecap": "round", class: "an-hit" }, g);
  } else if (it.kind === "shape") {
    const hit = { fill: "none", stroke: "transparent", "stroke-width": Math.max(12, it.width + 8), class: "an-hit" };
    const look = { fill: "none", stroke: it.colour, "stroke-width": it.width, "stroke-linejoin": "round", "stroke-linecap": "round" };
    const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
    if (it.shape === "rect") { el("rect", { x, y, width: w, height: h, ...look }, g); el("rect", { x, y, width: w, height: h, ...hit }, g); }
    else if (it.shape === "ellipse") { el("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...look }, g); el("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...hit }, g); }
    else {
      el("line", { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, ...look }, g);
      const head = arrowHead(it.x1, it.y1, it.x2, it.y2, it.width);
      el("polygon", { points: head.map((p) => `${p.x},${p.y}`).join(" "), fill: it.colour, stroke: it.colour, "stroke-width": 0.5, "stroke-linejoin": "round" }, g);
      el("line", { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, ...hit }, g);
    }
  } else {
    fitNote(it);
    el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, fill: it.colour, stroke: "#333", "stroke-width": 1, class: "an-hit-fill" }, g);
    noteLines(it).forEach((line, li) => {
      const t = el("text", { x: it.x + NOTE_PAD, y: it.y + NOTE_PAD + li * it.size * NOTE_LINE + it.size * NOTE_BASELINE, "font-size": it.size, "font-family": "Arial, Helvetica, sans-serif", fill: "#1a1a1a", style: "white-space:pre" }, g);
      t.textContent = line;
    });
  }
  return g;
}

function render() {
  layer.innerHTML = "";
  layer.dataset.tool = state.tool;
  for (const it of onPage()) drawItem(it, layer);
  drawSelection();
}

// the dashed box and the handles round the selected item
const HANDLE = 6;
function drawSelection() {
  const it = selectedItem();
  if (!it || it.page !== state.page) return;
  const b = boundsOf(it.kind === "note" ? (fitNote(it), it) : it);
  const r = HANDLE / (state.ratio || 1);
  const g = el("g", { class: "an-selection" }, layer);
  el("rect", { x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4, fill: "none", stroke: "#171614", "stroke-width": 1.2 / (state.ratio || 1), "stroke-dasharray": `${4 / (state.ratio || 1)} ${3 / (state.ratio || 1)}`, "pointer-events": "none" }, g);
  const handles = it.kind === "shape" ? [["p1", it.x1, it.y1], ["p2", it.x2, it.y2]] : it.kind === "note" ? [["e", it.x + it.w, it.y + it.h / 2]] : [];
  for (const [name, x, y] of handles) el("circle", { cx: x, cy: y, r, fill: "#171614", stroke: "#fff", "stroke-width": 1.5 / (state.ratio || 1), "data-handle": name, class: "an-handle" }, g);
}

// ---------------------------------------------------------------- tools

const HINTS = {
  select: "Click something to select it, then drag to move it or use the panel to change it.",
  highlight: "Drag from where the text starts to where it ends.",
  underline: "Drag from where the text starts to where it ends.",
  strike: "Drag from where the text starts to where it ends.",
  pen: "Draw on the page with the mouse or your finger.",
  rect: "Drag to draw a rectangle.",
  ellipse: "Drag to draw an ellipse.",
  arrow: "Drag from the tail to the point of the arrow.",
  note: "Click where the note should go, then type in it.",
};
const MARKER_COLOURS = ["#fff176", "#a5d6a7", "#f48fb1", "#90caf9", "#ffcc80"];
const INK_COLOURS = ["#e53935", "#1e63d6", "#2e7d32", "#171614", "#f57c00"];
const COLOUR_NAMES = { "#fff176": "Yellow", "#a5d6a7": "Green", "#f48fb1": "Pink", "#90caf9": "Blue", "#ffcc80": "Orange", "#e53935": "Red", "#1e63d6": "Blue", "#2e7d32": "Green", "#171614": "Black", "#f57c00": "Orange" };

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((b) => b.tagName === "BUTTON" && b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
  $("toolHelp").textContent = HINTS[tool];
  $("widthField").hidden = !["pen", "rect", "ellipse", "arrow"].includes(tool);
  $("swatches").hidden = tool === "select";
  buildSwatches();
  if (tool !== "select") select(null, false);
  render();
}
function buildSwatches() {
  const box = $("swatches");
  const palette = ["highlight", "note"].includes(state.tool) ? MARKER_COLOURS : INK_COLOURS;
  const current = state.colours[state.tool] || palette[0];
  box.querySelectorAll(".an-swatch").forEach((b) => b.remove());
  const custom = $("toolColour");
  for (const c of palette) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "an-swatch";
    b.style.setProperty("--sw", c);
    b.dataset.colour = c;
    b.setAttribute("aria-label", COLOUR_NAMES[c] || c);
    b.setAttribute("aria-pressed", String(c === current));
    b.addEventListener("click", () => { state.colours[state.tool] = c; buildSwatches(); });
    box.insertBefore(b, custom);
  }
  custom.value = current;
}
document.querySelectorAll("button[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
$("toolColour").addEventListener("input", () => { state.colours[state.tool] = $("toolColour").value; buildSwatches(); });
$("toolWidth").addEventListener("change", () => { state.width = Number($("toolWidth").value); });

// ---------------------------------------------------------------- making and moving things with the pointer

const toPage = (e) => {
  const r = layer.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * state.size.w, y: ((e.clientY - r.top) / r.height) * state.size.h };
};

let gesture = null;
let liveG = null;

function addItem(it) {
  remember();
  it.id = state.nextId++;
  it.page = state.page;
  state.items.push(it);
  render();
  refreshPanel();
  return it;
}

layer.addEventListener("pointerdown", (e) => {
  if (!state.pj) return;
  const p = toPage(e);
  e.preventDefault();
  try { layer.setPointerCapture(e.pointerId); } catch (err) { /* no pointer to capture */ }
  const tool = state.tool;
  if (tool === "select") {
    const handle = e.target.dataset && e.target.dataset.handle;
    const g = e.target.closest && e.target.closest("[data-id]");
    const it = handle ? selectedItem() : g && byId(Number(g.dataset.id));
    if (!it) { select(null); return; }
    if (state.selected !== it.id) select(it.id);
    gesture = { kind: handle ? "handle" : "move", handle, id: it.id, start: p, orig: clone(it), moved: false };
  } else if (["highlight", "underline", "strike"].includes(tool)) {
    gesture = { kind: "text", start: p, end: p, rects: [] };
  } else if (tool === "pen") {
    gesture = { kind: "pen", points: [p] };
  } else if (tool === "note") {
    const it = addItem({ kind: "note", x: Math.min(p.x, state.size.w - 160), y: Math.min(p.y, state.size.h - 60), w: 160, text: "Note", size: 11, colour: state.colours.note });
    setTool("select");
    select(it.id);
    $("selText").focus();
    $("selText").select();
    gesture = null;
  } else {
    gesture = { kind: "shape", start: p, end: p };
  }
});

layer.addEventListener("pointermove", (e) => {
  if (!gesture) return;
  const p = toPage(e);
  if (gesture.kind === "text") {
    gesture.end = p;
    gesture.rects = selectText(state.runs, gesture.start, p, measure);
    if (!gesture.rects.length && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 6) {
      gesture.rects = [{ x: Math.min(gesture.start.x, p.x), y: Math.min(gesture.start.y, p.y), w: Math.abs(p.x - gesture.start.x), h: Math.abs(p.y - gesture.start.y) }];
    }
    live({ kind: "mark", style: state.tool, rects: gesture.rects, colour: state.colours[state.tool] });
  } else if (gesture.kind === "pen") {
    const last = gesture.points[gesture.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
    gesture.points.push(p);
    live({ kind: "ink", points: gesture.points, colour: state.colours.pen, width: state.width });
  } else if (gesture.kind === "shape") {
    gesture.end = p;
    live({ kind: "shape", shape: state.tool, x1: gesture.start.x, y1: gesture.start.y, x2: p.x, y2: p.y, colour: state.colours[state.tool], width: state.width });
  } else {
    const it = byId(gesture.id);
    if (!it) return;
    const dx = p.x - gesture.start.x;
    const dy = p.y - gesture.start.y;
    if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!gesture.moved) { remember(`drag${it.id}`); gesture.moved = true; }
    if (gesture.kind === "move") {
      const orig = gesture.orig;
      const d = keepDelta(boundsOf(orig), dx, dy, state.size);
      Object.assign(it, moved(orig, d.dx, d.dy));
    } else if (it.kind === "shape") {
      const inside = (v, max) => Math.min(Math.max(v, 0), max);
      if (gesture.handle === "p1") { it.x1 = inside(p.x, state.size.w); it.y1 = inside(p.y, state.size.h); }
      else { it.x2 = inside(p.x, state.size.w); it.y2 = inside(p.y, state.size.h); }
    } else if (it.kind === "note") {
      it.w = Math.max(60, Math.min(state.size.w - it.x, gesture.orig.w + dx));
    }
    render();
  }
});

function live(it) {
  if (liveG) liveG.remove();
  liveG = el("g", { class: "an-live", opacity: it.kind === "mark" ? 1 : 0.9 }, layer);
  if (it.kind === "mark" && !it.rects.length) return;
  drawItem(it, liveG, true);
}

function endGesture() {
  const g = gesture;
  gesture = null;
  if (liveG) { liveG.remove(); liveG = null; }
  if (!g) return;
  if (g.kind === "text" && g.rects.length) addItem({ kind: "mark", style: state.tool, rects: g.rects, colour: state.colours[state.tool] });
  else if (g.kind === "pen" && g.points.length > 1) addItem({ kind: "ink", points: g.points, colour: state.colours.pen, width: state.width });
  else if (g.kind === "pen") addItem({ kind: "ink", points: [g.points[0], { x: g.points[0].x + 0.1, y: g.points[0].y }], colour: state.colours.pen, width: state.width });
  else if (g.kind === "shape" && Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) > 5) addItem({ kind: "shape", shape: state.tool, x1: g.start.x, y1: g.start.y, x2: g.end.x, y2: g.end.y, colour: state.colours[state.tool], width: state.width });
  else if (g.moved) syncSelection();
}
layer.addEventListener("pointerup", endGesture);
layer.addEventListener("pointercancel", endGesture);

// ---------------------------------------------------------------- selecting, and the panel for what is selected

function select(id, open = true) {
  state.selected = id;
  render();
  syncSelection();
  if (id && open) { const d = document.querySelector('[data-key="selected"]'); if (d && !d.open) d.open = true; }
  refreshPanel();
}

function syncSelection() {
  const it = selectedItem();
  $("noSel").hidden = !!it;
  $("selPanel").hidden = !it;
  if (!it) return;
  $("noteOpts").hidden = it.kind !== "note";
  $("selWidthField").hidden = !(it.kind === "ink" || it.kind === "shape");
  if (it.kind === "note") {
    if (document.activeElement !== $("selText")) $("selText").value = it.text;
    $("selSize").value = String(it.size);
  }
  $("selColour").value = it.colour;
  if (it.width) $("selWidth").value = String(it.width <= 2 ? 1.5 : it.width <= 4 ? 3 : 6);
}

function change(fn, key) {
  const it = selectedItem();
  if (!it) return;
  remember(key, 700);
  fn(it);
  render();
  refreshPanel();
}
$("selText").addEventListener("input", () => change((it) => { it.text = $("selText").value; }, "text"));
$("selSize").addEventListener("input", () => change((it) => { it.size = Math.min(48, Math.max(6, Number($("selSize").value) || it.size)); }, "size"));
$("selColour").addEventListener("input", () => change((it) => { it.colour = $("selColour").value; }, "colour"));
$("selWidth").addEventListener("change", () => change((it) => { it.width = Number($("selWidth").value); }, "width"));

function removeItem(id) {
  remember();
  state.items = state.items.filter((i) => i.id !== id);
  if (state.selected === id) state.selected = null;
  render();
  syncSelection();
  refreshPanel();
}
function duplicate() {
  const it = selectedItem();
  if (!it) return;
  remember();
  const d = keepDelta(boundsOf(it), 14, 14, state.size);
  const copy = { ...moved(clone(it), d.dx, d.dy), id: state.nextId++ };
  state.items.push(copy);
  select(copy.id, false);
}
function copyTo(pages) {
  const it = selectedItem();
  if (!it) return;
  const targets = pages.filter((p) => p - 1 !== it.page);
  if (!targets.length) { setMsg("It is already on every page you asked for."); return; }
  remember();
  for (const p of targets) state.items.push({ ...clone(it), id: state.nextId++, page: p - 1 });
  refreshPanel();
  setMsg(`Copied to ${targets.length} page${targets.length === 1 ? "" : "s"}, in the same place.`);
}
$("deleteBtn").addEventListener("click", () => { const it = selectedItem(); if (it) removeItem(it.id); });
$("dupBtn").addEventListener("click", duplicate);
$("copyBtn").addEventListener("click", () => {
  const r = parsePageSpec($("copyPages").value.trim() || "1-", state.count);
  if (r.error) { setMsg(r.error, "error"); return; }
  copyTo(r.pages);
});
$("copyAllBtn").addEventListener("click", () => copyTo(Array.from({ length: state.count }, (_, i) => i + 1)));

document.addEventListener("keydown", (e) => {
  if (!state.pj) return;
  const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && !typing && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (typing) return;
  if (e.key === "Escape") { setTool("select"); return; }
  const it = selectedItem();
  if (!it) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeItem(it.id); return; }
  if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); return; }
  const step = e.shiftKey ? 10 : 1;
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (mv) {
    e.preventDefault();
    remember(`nudge${it.id}`, 600);
    const d = keepDelta(boundsOf(it), mv[0], mv[1], state.size);
    Object.assign(it, moved(it, d.dx, d.dy));
    render();
  }
});

// ---------------------------------------------------------------- the panel as a whole

function refreshPanel() {
  const has = !!state.pj;
  $("undoBtn").disabled = !state.undo.length;
  $("redoBtn").disabled = !state.redo.length;
  runBtn.disabled = !has || !state.items.length || runBtn.dataset.busy === "1";
  $("clearBtn").disabled = !has;
  $("anHint").textContent = has ? HINTS[state.tool] : "";
  const sum = $("summary");
  sum.classList.remove("is-error");
  sum.textContent = !has ? "Add a PDF to begin." : state.items.length ? describeItems(state.items) : "Mark up the page to begin.";
  const it = selectedItem();
  $("copyBtn").disabled = $("copyAllBtn").disabled = $("dupBtn").disabled = $("deleteBtn").disabled = !it;
}

if (window.FGPAcc) {
  const NAMES = { select: "Select", highlight: "Highlight", underline: "Underline", strike: "Strikethrough", pen: "Pen", rect: "Rectangle", ellipse: "Ellipse", arrow: "Arrow", note: "Note" };
  FGPAcc.set("tool", () => NAMES[state.tool]);
  FGPAcc.set("selected", () => { const it = selectedItem(); return it ? { mark: "Text mark", ink: "Drawing", shape: "Shape", note: "Note" }[it.kind] : "Nothing selected"; });
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

// ---------------------------------------------------------------- writing it into the PDF

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const blobOf = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type));

// a note's text as a picture on a transparent canvas, for letters the PDF's own fonts can't set
function notePicture(it, lines) {
  const k = 3;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(it.w * k));
  c.height = Math.max(1, Math.ceil(it.h * k));
  const g = c.getContext("2d");
  g.font = `${it.size * k}px Arial, Helvetica, sans-serif`;
  g.fillStyle = "#1a1a1a";
  g.textBaseline = "alphabetic";
  lines.forEach((line, li) => g.fillText(line, NOTE_PAD * k, (NOTE_PAD + li * it.size * NOTE_LINE + it.size * NOTE_BASELINE) * k));
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
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    let asPicture = 0;
    for (const [i, page] of pages.entries()) {
      const mine = state.items.filter((it) => it.page === i);
      if (!mine.length) continue;
      const shown = enterShownSpace(page);
      const H = shown.height;
      for (const it of mine) {
        const colour = hexRgb(it.colour);
        if (it.kind === "mark") {
          for (const r of it.rects) {
            if (it.style === "highlight") page.drawRectangle({ x: r.x, y: H - r.y - r.h, width: r.w, height: r.h, color: colour, blendMode: PDFLib.BlendMode.Multiply });
            else for (const y of markLines(it, r)) page.drawLine({ start: { x: r.x, y: H - y }, end: { x: r.x + r.w, y: H - y }, thickness: MARK_WIDTH, color: colour });
          }
        } else if (it.kind === "ink") {
          page.drawSvgPath(strokePath(it.points), { x: 0, y: H, borderColor: colour, borderWidth: it.width, borderLineCap: PDFLib.LineCapStyle.Round });
        } else if (it.kind === "shape") {
          const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2), w = Math.abs(it.x2 - it.x1), h = Math.abs(it.y2 - it.y1);
          if (it.shape === "rect") page.drawRectangle({ x, y: H - y - h, width: w, height: h, borderColor: colour, borderWidth: it.width });
          else if (it.shape === "ellipse") page.drawEllipse({ x: x + w / 2, y: H - (y + h / 2), xScale: w / 2, yScale: h / 2, borderColor: colour, borderWidth: it.width });
          else {
            page.drawLine({ start: { x: it.x1, y: H - it.y1 }, end: { x: it.x2, y: H - it.y2 }, thickness: it.width, color: colour, lineCap: PDFLib.LineCapStyle.Round });
            const head = arrowHead(it.x1, it.y1, it.x2, it.y2, it.width);
            page.drawSvgPath(`M${head[0].x} ${head[0].y} L${head[1].x} ${head[1].y} L${head[2].x} ${head[2].y} Z`, { x: 0, y: H, color: colour, borderColor: colour, borderWidth: 0.5 });
          }
        } else {
          const lines = noteLines(it);
          fitNote(it);
          page.drawRectangle({ x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, color: colour, borderColor: PDFLib.rgb(0.2, 0.2, 0.2), borderWidth: 1 });
          if (!it.text.trim()) continue;
          if (lines.every(pdfSafe)) {
            lines.forEach((line, li) => {
              if (line) page.drawText(line, { x: it.x + NOTE_PAD, y: H - (it.y + NOTE_PAD + li * it.size * NOTE_LINE + it.size * NOTE_BASELINE), size: it.size, font, color: PDFLib.rgb(0.1, 0.1, 0.1) });
            });
          } else {
            asPicture++;
            const png = await doc.embedPng(new Uint8Array(await (await blobOf(notePicture(it, lines), "image/png")).arrayBuffer()));
            page.drawImage(png, { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h });
          }
        }
      }
      shown.done();
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("pdf-annotator", safeBaseName($("prefix").value, "marked-up"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${state.count} page${state.count === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    $("resultNote").textContent = `${describeItems(state.items)} ${asPicture ? `${asPicture} note${asPicture === 1 ? " has" : "s have"} letters outside the standard fonts, so the text was stamped as a picture. ` : ""}The marks are part of the page now. Open the copy and check each page before you send it.`;
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({ currentTool: "pdf-annotator", blob, filename: outName, els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") }, relatedSection: document.querySelector(".related-tools-section") });
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

setTool("highlight");
refreshPanel();
