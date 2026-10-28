// Organise PDF Pages page. The rules for moving, picking and undoing are in organise-core.js; this file is the page around them.
// A page here is { id, src, index, rotation, deleted, thumb } or a blank { id, blank, w, h }. Pages are never changed after they
// are made (a change makes a new object), which is what lets undo keep whole earlier lists cheaply.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { parsePageSpec, compactPages, safeBaseName } from "/assets/tools/page-tools.js";
import { reorderBlock, moveStep, moveToEdge, idsBetween, pickPages, insertAfterSelection, duplicateAfter, turn, createHistory } from "/assets/tools/organise-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const grid = $("pageGrid");
const statusEl = $("status");
const history = createHistory();

// sources[0] is the PDF that was opened; more are added with "Pages from a PDF". thumb is shared by a page and its copies.
const state = { sources: [], pages: [], initial: [], selected: new Set(), anchor: null, nextId: 1, focusId: null };

const makeId = () => state.nextId++;
const makeThumb = () => ({ master: null, promise: null, urls: new Map() });
const isTurned = (p) => p.rotation === 90 || p.rotation === 270;

// ---------------------------------------------------------------- thumbnails

function ensureMaster(p) {
  const t = p.thumb;
  t.promise ??= renderPageThumbCanvas(state.sources[p.src].doc, p.index + 1, 260).then((c) => (t.master = c));
  return t.promise;
}

// a picture of the page the way it is turned now; kept for each turn so changing a page back and forth costs nothing
function thumbUrl(p) {
  const t = p.thumb;
  if (t.urls.has(p.rotation)) return t.urls.get(p.rotation);
  if (!t.master) return null;
  const m = t.master;
  const c = document.createElement("canvas");
  c.width = isTurned(p) ? m.height : m.width;
  c.height = isTurned(p) ? m.width : m.height;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.drawImage(m, -m.width / 2, -m.height / 2);
  const url = c.toDataURL("image/jpeg", 0.85);
  t.urls.set(p.rotation, url);
  return url;
}

let observer = null;
function loadThumb(el, p, generation) {
  const img = p && el.querySelector("img");
  if (!img || img.getAttribute("src")) return;
  const show = () => {
    const url = thumbUrl(p);
    if (url && generation === renderGeneration) { img.src = url; img.closest(".thumb-img-wrap").style.aspectRatio = ""; }
  };
  if (p.thumb.master) return show();
  ensureMaster(p).then(show).catch(() => {});
}

// ---------------------------------------------------------------- the grid

let renderGeneration = 0;
function renderGrid() {
  const generation = ++renderGeneration;
  if (observer) observer.disconnect();
  observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); loadThumb(e.target, state.pages.find((x) => x.id === Number(e.target.dataset.id)), generation); } }), { rootMargin: "600px" })
    : null;
  grid.innerHTML = "";
  const ratio = state.sources[0] ? state.sources[0].ratio : 0.75;
  state.pages.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "page-thumb" + (state.selected.has(p.id) ? " picked" : "") + (p.deleted ? " marked-delete" : "");
    el.draggable = true;
    el.tabIndex = 0;
    el.dataset.id = String(p.id);
    el.setAttribute("role", "checkbox");
    el.setAttribute("aria-checked", String(state.selected.has(p.id)));
    el.setAttribute("aria-label", `Page ${i + 1} of ${state.pages.length}${p.blank ? ", blank" : ""}${p.deleted ? ", marked for deletion" : ""}`);
    const shape = p.blank ? p.w / p.h : isTurned(p) ? 1 / ratio : ratio;
    el.innerHTML = `<span class="page-num">${i + 1}</span><div class="thumb-img-wrap${p.blank ? " is-blank" : ""}" style="aspect-ratio:${shape}">${p.blank ? "<span>Blank</span>" : '<img alt="">'}</div>`;
    const actions = document.createElement("div");
    actions.className = "thumb-actions";
    const button = (text, label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = label;
      b.setAttribute("aria-label", `${label}, page ${i + 1}`);
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      b.addEventListener("keydown", (e) => e.stopPropagation()); // Space on a button should press it, not pick the page
      actions.appendChild(b);
    };
    if (!p.blank) {
      button("⟲", "Rotate left", () => change((q) => (q.id === p.id ? { ...q, rotation: turn(q.rotation, -90) } : q)));
      button("⟳", "Rotate right", () => change((q) => (q.id === p.id ? { ...q, rotation: turn(q.rotation, 90) } : q)));
    }
    button(p.deleted ? "↺" : "✕", p.deleted ? "Restore" : "Delete", () => change((q) => (q.id === p.id ? { ...q, deleted: !q.deleted } : q)));
    el.appendChild(actions);

    el.addEventListener("click", (e) => pick(p.id, e));
    el.addEventListener("keydown", (e) => keyOnPage(e, p.id, i));
    el.addEventListener("dragstart", (e) => {
      const ids = state.selected.has(p.id) ? new Set(state.selected) : new Set([p.id]);
      dragIds = ids;
      grid.querySelectorAll(".page-thumb").forEach((x) => x.classList.toggle("dragging", ids.has(Number(x.dataset.id))));
      e.dataTransfer.setData("text/plain", String(p.id)); // Firefox will not start a drag without data
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", clearDrag);
    el.addEventListener("dragover", (e) => {
      if (!dragIds || dragIds.has(p.id)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const before = e.clientX - r.left < r.width / 2;
      el.classList.toggle("drop-before", before);
      el.classList.toggle("drop-after", !before);
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
    el.addEventListener("drop", (e) => {
      if (!dragIds || dragIds.has(p.id)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ids = dragIds;
      clearDrag();
      applyOrder(reorderBlock(state.pages.map((x) => x.id), ids, p.id, e.clientX - r.left >= r.width / 2));
    });

    grid.appendChild(el);
    if (!p.blank) { if (p.thumb.urls.has(p.rotation)) loadThumb(el, p, generation); else if (observer) observer.observe(el); else loadThumb(el, p, generation); }
  });
  if (state.focusId !== null) { const f = grid.querySelector(`[data-id="${state.focusId}"]`); if (f) f.focus(); state.focusId = null; }
  updateTools();
}

let dragIds = null;
function clearDrag() {
  dragIds = null;
  grid.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after"));
}

// ---------------------------------------------------------------- changing the pages

function setPages(next) {
  state.pages = next;
  const ids = new Set(next.map((p) => p.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
}

// every change goes through here, so it can be undone
function commit(next) {
  history.push(state.pages);
  setPages(next);
  renderGrid();
}
const change = (fn) => commit(state.pages.map(fn));
const changeSelected = (fn) => change((p) => (state.selected.has(p.id) ? fn(p) : p));

function applyOrder(ids) {
  const byId = new Map(state.pages.map((p) => [p.id, p]));
  commit(ids.map((id) => byId.get(id)));
}
const ids = () => state.pages.map((p) => p.id);

function undoRedo(redo) {
  const prev = redo ? history.redo(state.pages) : history.undo(state.pages);
  if (!prev) return;
  setPages(prev);
  renderGrid();
}
$("undoBtn").addEventListener("click", () => undoRedo(false));
$("redoBtn").addEventListener("click", () => undoRedo(true));
document.addEventListener("keydown", (e) => {
  if (!state.pages.length || e.target.matches("input, textarea, select")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); undoRedo(e.shiftKey); }
  else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); undoRedo(true); }
});

// ---------------------------------------------------------------- picking pages

function pick(id, e) {
  if (e.shiftKey && state.anchor !== null) {
    for (const x of idsBetween(ids(), state.anchor, id)) state.selected.add(x);
  } else if (e.ctrlKey || e.metaKey) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    state.anchor = id;
  } else {
    // a plain click picks a page, or puts it down again when it is the only one picked
    const only = state.selected.size === 1 && state.selected.has(id);
    state.selected = only ? new Set() : new Set([id]);
    state.anchor = id;
  }
  state.focusId = id;
  refreshPicks();
}

function refreshPicks() {
  grid.querySelectorAll(".page-thumb").forEach((el) => {
    const on = state.selected.has(Number(el.dataset.id));
    el.classList.toggle("picked", on);
    el.setAttribute("aria-checked", String(on));
  });
  if (state.focusId !== null) { const f = grid.querySelector(`[data-id="${state.focusId}"]`); if (f) f.focus(); state.focusId = null; }
  updateTools();
}

function keyOnPage(e, id, i) {
  const move = (to) => { const t = grid.children[to]; if (t) { e.preventDefault(); t.focus(); } };
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); pick(id, { ctrlKey: true }); }
  else if (e.key === "ArrowRight") move(i + 1);
  else if (e.key === "ArrowLeft") move(i - 1);
  else if (e.key === "Home") move(0);
  else if (e.key === "End") move(state.pages.length - 1);
  else if ((e.key === "Delete" || e.key === "Backspace") && state.selected.size) { e.preventDefault(); changeSelected((p) => ({ ...p, deleted: true })); }
}

for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("click", () => {
    state.selected = pickPages(ids(), b.dataset.pick, state.selected);
    refreshPicks();
  });
}

$("pickInput").addEventListener("input", () => {
  const note = $("pickNote");
  const text = $("pickInput").value;
  if (!text.trim()) { state.selected = new Set(); note.textContent = ""; note.classList.remove("is-error"); refreshPicks(); return; }
  const r = parsePageSpec(text, state.pages.length);
  note.textContent = r.error || "";
  note.classList.toggle("is-error", !!r.error);
  $("pickInput").setAttribute("aria-invalid", String(!!r.error));
  if (r.error) return;
  state.selected = new Set(r.pages.map((n) => state.pages[n - 1].id));
  refreshPicks();
});

// ---------------------------------------------------------------- the tools beside the pages

function updateTools() {
  const n = state.selected.size;
  const deleted = state.pages.filter((p) => p.deleted).length;
  const kept = state.pages.length - deleted;
  $("selCount").textContent = state.pages.length ? `${n} of ${state.pages.length} picked${deleted ? `, ${deleted} deleted` : ""}` : "";
  for (const b of document.querySelectorAll("[data-act]")) b.disabled = n === 0;
  document.querySelector('[data-act="restore"]').disabled = !state.pages.some((p) => p.deleted && state.selected.has(p.id));
  $("undoBtn").disabled = !history.canUndo();
  $("redoBtn").disabled = !history.canRedo();
  for (const id of ["addBlank", "reverseBtn", "originalBtn", "clearBtn"]) $(id).disabled = !state.pages.length;
  $("addPdf").disabled = !state.pages.length;
  $("saveBtn").disabled = kept === 0;
  $("summary").textContent = !state.pages.length ? "Add a PDF to begin." : kept === 0 ? "Every page is marked for deletion." : `${kept} page${kept === 1 ? "" : "s"} will be saved${deleted ? `, ${deleted} left out` : ""}.`;
  $("summary").classList.toggle("is-error", state.pages.length > 0 && kept === 0);
  if (document.activeElement !== $("pickInput")) $("pickInput").value = compactPages(state.pages.map((p, i) => (state.selected.has(p.id) ? i + 1 : 0)).filter(Boolean));
}

const ACTIONS = {
  rotl: () => changeSelected((p) => (p.blank ? p : { ...p, rotation: turn(p.rotation, -90) })),
  rotr: () => changeSelected((p) => (p.blank ? p : { ...p, rotation: turn(p.rotation, 90) })),
  del: () => changeSelected((p) => ({ ...p, deleted: true })),
  restore: () => changeSelected((p) => ({ ...p, deleted: false })),
  earlier: () => applyOrder(moveStep(ids(), state.selected, -1)),
  later: () => applyOrder(moveStep(ids(), state.selected, 1)),
  first: () => applyOrder(moveToEdge(ids(), state.selected, false)),
  last: () => applyOrder(moveToEdge(ids(), state.selected, true)),
  dup: () => {
    const { order, copies } = duplicateAfter(ids(), state.selected, makeId);
    const byId = new Map(state.pages.map((p) => [p.id, p]));
    for (const [orig, copy] of copies) byId.set(copy, { ...byId.get(orig), id: copy });
    commit(order.map((id) => byId.get(id)));
    state.selected = new Set(copies.values()); // the copies are what you will want to move next
    refreshPicks();
  },
};
for (const b of document.querySelectorAll("[data-act]")) b.addEventListener("click", () => ACTIONS[b.dataset.act]());

// the size of the page a new blank page should match: the last picked one, or the last page
async function sizeOfPage(p) {
  if (p.blank) return { w: p.w, h: p.h };
  const view = (await (await state.sources[p.src].doc.getPage(p.index + 1)).getViewport({ scale: 1 }));
  return isTurned(p) ? { w: view.height, h: view.width } : { w: view.width, h: view.height };
}

$("addBlank").addEventListener("click", async () => {
  const order = ids();
  const refId = [...order].reverse().find((id) => state.selected.has(id)) ?? order[order.length - 1];
  const { w, h } = await sizeOfPage(state.pages.find((p) => p.id === refId));
  const blank = { id: makeId(), blank: true, w, h, rotation: 0, deleted: false };
  const byId = new Map(state.pages.map((p) => [p.id, p]));
  byId.set(blank.id, blank);
  commit(insertAfterSelection(order, state.selected, [blank.id]).map((id) => byId.get(id)));
  state.selected = new Set([blank.id]);
  state.anchor = blank.id;
  refreshPicks();
});

$("addPdf").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    setStatus(statusEl, `Reading ${file.name}…`, "");
    const source = await openSource(file);
    state.sources.push(source);
    const src = state.sources.length - 1;
    const added = Array.from({ length: source.doc.numPages }, (_, index) => ({ id: makeId(), src, index, rotation: 0, deleted: false, thumb: makeThumb() }));
    const byId = new Map(state.pages.map((p) => [p.id, p]));
    for (const p of added) byId.set(p.id, p);
    commit(insertAfterSelection(ids(), state.selected, added.map((p) => p.id)).map((id) => byId.get(id)));
    state.selected = new Set(added.map((p) => p.id));
    state.anchor = added[0].id;
    refreshPicks();
    setStatus(statusEl, `Added ${added.length} page${added.length === 1 ? "" : "s"} from ${file.name}. They are picked, so you can move them straight away.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}. If it needs a password, remove it with Unlock PDF first.`, "error");
  }
});

$("reverseBtn").addEventListener("click", () => applyOrder(ids().reverse()));
$("originalBtn").addEventListener("click", () => {
  state.selected = new Set();
  commit(state.initial);
});

// ---------------------------------------------------------------- opening, saving

async function openSource(file) {
  const doc = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  const view = (await doc.getPage(1)).getViewport({ scale: 1 });
  return { file, doc, ratio: view.width / view.height };
}

async function loadFile(file) {
  setStatus(statusEl, "Reading the PDF…", "");
  for (const s of state.sources) s.doc.destroy();
  const source = await openSource(file);
  state.sources = [source];
  state.nextId = 1;
  state.pages = Array.from({ length: source.doc.numPages }, (_, index) => ({ id: makeId(), src: 0, index, rotation: 0, deleted: false, thumb: makeThumb() }));
  state.initial = state.pages;
  state.selected = new Set();
  state.anchor = null;
  history.clear();
  $("fileBar").textContent = `${file.name} · ${state.pages.length} page${state.pages.length === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = $("viewBar").hidden = $("gridWrap").hidden = false;
  $("outName").value = safeBaseName(stripExtension(file.name), "organised");
  dropzone.classList.add("compact");
  clearStatus(statusEl);
  renderGrid();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setStatus(statusEl, "Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}. If it needs a password, remove it with Unlock PDF first.`, "error");
  }
}

initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "organise-pdf", dropzone, onFiles: handleFiles });

$("thumbSize").addEventListener("input", () => grid.style.setProperty("--thumb", `${$("thumbSize").value}px`));

$("clearBtn").addEventListener("click", () => {
  for (const s of state.sources) s.doc.destroy();
  Object.assign(state, { sources: [], pages: [], initial: [], selected: new Set(), anchor: null });
  history.clear();
  grid.innerHTML = "";
  $("fileBar").hidden = $("viewBar").hidden = $("gridWrap").hidden = true;
  $("fileInput").value = "";
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  updateTools();
});

$("saveBtn").addEventListener("click", async () => {
  const keep = state.pages.filter((p) => !p.deleted);
  if (!keep.length) return;
  $("saveBtn").disabled = true;
  setStatus(statusEl, "Saving…", "");
  try {
    const libs = new Map(); // each source is opened for copying once, the first time a page from it is needed
    const out = await PDFLib.PDFDocument.create();
    for (const p of keep) {
      if (p.blank) { out.addPage([p.w, p.h]); continue; }
      if (!libs.has(p.src)) libs.set(p.src, await loadEditable(state.sources[p.src].file));
      const [copied] = await out.copyPages(libs.get(p.src), [p.index]);
      if (p.rotation) copied.setRotation(PDFLib.degrees(turn(copied.getRotation().angle, p.rotation)));
      out.addPage(copied);
    }
    const blob = new Blob([await out.save()], { type: "application/pdf" });
    const outName = brandFilename("organise-pdf", safeBaseName($("outName").value, "organised"), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "organise-pdf", blob, filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Sorted, saved ${keep.length} page${keep.length === 1 ? "" : "s"} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    updateTools();
  }
});

updateTools();
