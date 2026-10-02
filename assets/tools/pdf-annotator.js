import { PDFLib, loadPdfJsDoc } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pdfPages = document.getElementById("pdfPages");
const highlightBtn = document.getElementById("highlightBtn");
const drawBtn = document.getElementById("drawBtn");
const addNoteBtn = document.getElementById("addNoteBtn");
const toolColor = document.getElementById("toolColor");
const objToolbar = document.getElementById("objToolbar");
const objColorInput = document.getElementById("objColor");
const deleteObjBtn = document.getElementById("deleteObjBtn");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const RENDER_SCALE = 2;
const CLICK_THRESHOLD_PX = 4;
const MIN_STROKE_SPACING = 3; // px, in page-point space, between recorded ink points

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let idCounter = 0;

// pages[i] = { naturalW, naturalH, wrapEl, canvasEl, overlayEl, ratio, objects: [] }
let pages = [];
let selectedPageIndex = -1;
let selectedObj = null;
let mode = null; // null | "highlight" | "draw"

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());

  try {
    setStatus(statusEl, "Rendering pages…", "");
    statusEl.classList.add("visible");
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    await renderAllPages();
    editor.style.display = "block";
    actionsRow.style.display = "flex";
    recalcAllScales();
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "pdf-annotator", dropzone, onFiles: handleFiles });
}

async function renderAllPages() {
  pdfPages.innerHTML = "";
  pages = [];
  selectedPageIndex = -1;
  deselectObject();

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const viewport1 = page.getViewport({ scale: 1 });
    const naturalW = viewport1.width;
    const naturalH = viewport1.height;

    const wrapEl = document.createElement("div");
    wrapEl.className = "pdf-page-wrap";
    wrapEl.dataset.pageIndex = String(i - 1);

    const canvasEl = document.createElement("canvas");
    const renderViewport = page.getViewport({ scale: RENDER_SCALE });
    canvasEl.width = renderViewport.width;
    canvasEl.height = renderViewport.height;

    const overlayEl = document.createElement("div");
    overlayEl.className = "pdf-page-overlay";
    overlayEl.style.width = `${naturalW}px`;
    overlayEl.style.height = `${naturalH}px`;

    wrapEl.appendChild(canvasEl);
    wrapEl.appendChild(overlayEl);
    pdfPages.appendChild(wrapEl);

    const record = { naturalW, naturalH, wrapEl, canvasEl, overlayEl, ratio: 1, objects: [] };
    pages.push(record);

    page.render({ canvasContext: canvasEl.getContext("2d"), viewport: renderViewport }).promise
      .then(() => recalcAllScales())
      .catch((err) => console.error(`Failed to render page ${i}:`, err));

    wireCreationGestures(record, i - 1);

    wrapEl.addEventListener("pointerdown", (e) => {
      selectPage(i - 1);
      if (e.target === wrapEl || e.target === canvasEl || e.target === overlayEl) deselectObject();
    });
  }

  if (pages.length) selectPage(0);
}

function recalcAllScales() {
  for (const p of pages) {
    const ratio = p.wrapEl.clientWidth / p.naturalW || 1;
    p.ratio = ratio;
    p.canvasEl.style.width = `${p.naturalW * ratio}px`;
    p.canvasEl.style.height = `${p.naturalH * ratio}px`;
    p.overlayEl.style.transform = `scale(${ratio})`;
  }
}

let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => { recalcAllScales(); resizeRaf = null; });
});

function selectPage(index) {
  selectedPageIndex = index;
  pages.forEach((p, i) => p.wrapEl.classList.toggle("selected-page", i === index));
}

function genId() { return ++idCounter; }
function pagePoint(pageIndex, e) {
  const p = pages[pageIndex];
  const rect = p.overlayEl.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / p.ratio, y: (e.clientY - rect.top) / p.ratio };
}

// --- Mode toolbar ---

function setMode(next) {
  mode = mode === next ? null : next;
  highlightBtn.classList.toggle("active", mode === "highlight");
  drawBtn.classList.toggle("active", mode === "draw");
}
highlightBtn.addEventListener("click", () => setMode("highlight"));
drawBtn.addEventListener("click", () => setMode("draw"));

addNoteBtn.addEventListener("click", () => {
  if (selectedPageIndex < 0) return;
  const page = pages[selectedPageIndex];
  const obj = {
    id: genId(), type: "note", x: 40, y: 40, width: 160, height: 110,
    text: "Note", color: toolColor.value,
  };
  const el = buildNoteEl(obj);
  page.overlayEl.appendChild(el);
  obj.el = el;
  page.objects.push(obj);
  selectObject(obj, selectedPageIndex);
  enterTextEditMode(obj);
});

// --- Building object elements ---

function buildHandles(container) {
  ["nw", "ne", "sw", "se"].forEach((corner) => {
    const h = document.createElement("span");
    h.className = `crop-handle ${corner}`;
    h.dataset.handle = corner;
    container.appendChild(h);
  });
}

function positionEl(obj) {
  obj.el.style.left = `${obj.x}px`;
  obj.el.style.top = `${obj.y}px`;
  obj.el.style.width = `${obj.width}px`;
  obj.el.style.height = `${obj.height}px`;
}

function attachDeleteButton(obj, el) {
  const del = document.createElement("button");
  del.className = "pdf-obj-delete";
  del.type = "button";
  del.textContent = "×";
  del.addEventListener("pointerdown", (e) => e.stopPropagation());
  del.addEventListener("click", () => deleteObject(obj));
  el.appendChild(del);
}

function buildHighlightEl(obj) {
  const el = document.createElement("div");
  el.className = "pdf-obj pdf-obj-highlight";
  el.style.background = obj.color;
  attachDeleteButton(obj, el);
  buildHandles(el);
  obj.el = el;
  positionEl(obj);
  wireObjectDrag(obj, el);
  wireResizeHandles(obj, el);
  return el;
}

function buildNoteEl(obj) {
  const el = document.createElement("div");
  el.className = "pdf-obj pdf-obj-note";
  el.style.background = obj.color;
  const body = document.createElement("div");
  body.className = "pdf-obj-body";
  body.textContent = obj.text;
  obj.bodyEl = body;
  el.appendChild(body);
  attachDeleteButton(obj, el);
  buildHandles(el);
  obj.el = el;
  positionEl(obj);
  wireObjectDrag(obj, el);
  wireResizeHandles(obj, el);
  body.addEventListener("input", () => { obj.text = body.textContent; });
  return el;
}

function inkPathData(obj) {
  return obj.points.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x - obj.x).toFixed(1)},${(p.y - obj.y).toFixed(1)}`).join(" ");
}

function buildInkEl(obj) {
  const el = document.createElement("div");
  el.className = "pdf-obj pdf-obj-ink";
  el.innerHTML = `<svg viewBox="0 0 ${obj.width} ${obj.height}" preserveAspectRatio="none"><path d="${inkPathData(obj)}" fill="none" stroke="${obj.color}" stroke-width="${obj.thickness}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  attachDeleteButton(obj, el);
  obj.el = el;
  obj.pathEl = el.querySelector("path");
  positionEl(obj);
  wireObjectDrag(obj, el);
  return el;
}

// --- Selection ---

function deselectObject() {
  if (selectedObj) {
    exitTextEditMode(selectedObj);
    selectedObj.el.classList.remove("selected");
  }
  selectedObj = null;
  objToolbar.classList.remove("visible");
}

function selectObject(obj, pageIndex) {
  if (selectedObj && selectedObj !== obj) {
    exitTextEditMode(selectedObj);
    selectedObj.el.classList.remove("selected");
  }
  selectedPageIndex = pageIndex;
  pages.forEach((p, i) => p.wrapEl.classList.toggle("selected-page", i === pageIndex));
  selectedObj = obj;
  obj.el.classList.add("selected");
  objToolbar.classList.add("visible");
  objColorInput.value = obj.color;
}

function enterTextEditMode(obj) {
  if (obj.type !== "note") return;
  obj.bodyEl.setAttribute("contenteditable", "true");
  obj.bodyEl.focus();
  const range = document.createRange();
  range.selectNodeContents(obj.bodyEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function exitTextEditMode(obj) {
  if (obj.type !== "note" || !obj.bodyEl) return;
  obj.bodyEl.removeAttribute("contenteditable");
}

function deleteObject(obj) {
  const page = pages[selectedPageIndex] || pages.find((p) => p.objects.includes(obj));
  if (page) page.objects = page.objects.filter((o) => o !== obj);
  obj.el.remove();
  if (selectedObj === obj) { selectedObj = null; objToolbar.classList.remove("visible"); }
}

objColorInput.addEventListener("input", () => {
  if (!selectedObj) return;
  selectedObj.color = objColorInput.value;
  if (selectedObj.type === "highlight") selectedObj.el.style.background = objColorInput.value;
  else if (selectedObj.type === "note") selectedObj.el.style.background = objColorInput.value;
  else if (selectedObj.type === "ink") selectedObj.pathEl.setAttribute("stroke", objColorInput.value);
});
deleteObjBtn.addEventListener("click", () => { if (selectedObj) deleteObject(selectedObj); });

// --- Drag & resize (shared by all object kinds) ---

function wireObjectDrag(obj, el) {
  let dragState = null;
  let moved = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.target.dataset.handle || e.target.classList.contains("pdf-obj-delete")) return;
    if (obj.bodyEl && obj.bodyEl.getAttribute("contenteditable") === "true") return;
    e.preventDefault();
    const pageIndex = Number(el.closest(".pdf-page-wrap").dataset.pageIndex);
    selectPage(pageIndex);
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer, safe to ignore */ }
    const p = pagePoint(pageIndex, e);
    dragState = { pageIndex, startX: p.x, startY: p.y, objX: obj.x, objY: obj.y };
    moved = false;
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const p = pagePoint(dragState.pageIndex, e);
    const dx = p.x - dragState.startX;
    const dy = p.y - dragState.startY;
    if (Math.abs(dx) > CLICK_THRESHOLD_PX || Math.abs(dy) > CLICK_THRESHOLD_PX) moved = true;
    if (moved) {
      const ddx = dragState.objX + dx - obj.x;
      const ddy = dragState.objY + dy - obj.y;
      obj.x = dragState.objX + dx;
      obj.y = dragState.objY + dy;
      if (obj.type === "ink") obj.points.forEach((pt) => { pt.x += ddx; pt.y += ddy; });
      positionEl(obj);
    }
  });

  el.addEventListener("pointerup", () => {
    if (!dragState) return;
    const pageIndex = dragState.pageIndex;
    dragState = null;
    if (!moved) {
      const alreadySelected = selectedObj === obj;
      selectObject(obj, pageIndex);
      if (alreadySelected && obj.type === "note") enterTextEditMode(obj);
    }
  });
}

function wireResizeHandles(obj, el) {
  el.querySelectorAll(".crop-handle").forEach((handle) => {
    let resizeState = null;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pageIndex = Number(el.closest(".pdf-page-wrap").dataset.pageIndex);
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* safe to ignore */ }
      resizeState = { corner: handle.dataset.handle, pageIndex };
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resizeState) return;
      const p = pagePoint(resizeState.pageIndex, e);
      const corner = resizeState.corner;
      const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.width, y1 = obj.y + obj.height;
      let nx = x0, ny = y0, nw = obj.width, nh = obj.height;
      const MIN = 12;
      if (corner === "se") { nw = Math.max(MIN, p.x - x0); nh = Math.max(MIN, p.y - y0); }
      else if (corner === "nw") { nx = Math.min(p.x, x1 - MIN); ny = Math.min(p.y, y1 - MIN); nw = x1 - nx; nh = y1 - ny; }
      else if (corner === "ne") { ny = Math.min(p.y, y1 - MIN); nw = Math.max(MIN, p.x - x0); nh = y1 - ny; }
      else if (corner === "sw") { nx = Math.min(p.x, x1 - MIN); nw = x1 - nx; nh = Math.max(MIN, p.y - y0); }
      obj.x = nx; obj.y = ny; obj.width = nw; obj.height = nh;
      positionEl(obj);
    });
    handle.addEventListener("pointerup", () => { resizeState = null; });
    handle.addEventListener("pointercancel", () => { resizeState = null; });
  });
}

// --- Creating shapes by dragging on the page itself ---

function wireCreationGestures(record, pageIndex) {
  let drag = null; // { kind, startPage: {x,y} }
  let liveEl = null;

  record.overlayEl.addEventListener("pointerdown", (e) => {
    if (!mode) return;
    if (e.target !== record.overlayEl && e.target !== record.canvasEl && e.target !== record.wrapEl) return;
    e.preventDefault();
    selectPage(pageIndex);
    try { record.overlayEl.setPointerCapture(e.pointerId); } catch (_) { /* safe to ignore */ }
    const p = pagePoint(pageIndex, e);

    if (mode === "highlight") {
      const obj = { id: genId(), type: "highlight", x: p.x, y: p.y, width: 0, height: 0, color: toolColor.value };
      liveEl = buildHighlightEl(obj);
      record.overlayEl.appendChild(liveEl);
      drag = { kind: "highlight", obj, startX: p.x, startY: p.y };
    } else if (mode === "draw") {
      const obj = { id: genId(), type: "ink", points: [{ x: p.x, y: p.y }], color: toolColor.value, thickness: 2.5, x: p.x, y: p.y, width: 1, height: 1 };
      liveEl = buildInkEl(obj);
      record.overlayEl.appendChild(liveEl);
      drag = { kind: "draw", obj };
    }
  });

  record.overlayEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pagePoint(pageIndex, e);
    if (drag.kind === "highlight") {
      const obj = drag.obj;
      obj.x = Math.min(drag.startX, p.x);
      obj.y = Math.min(drag.startY, p.y);
      obj.width = Math.abs(p.x - drag.startX);
      obj.height = Math.abs(p.y - drag.startY);
      positionEl(obj);
    } else if (drag.kind === "draw") {
      const obj = drag.obj;
      const last = obj.points[obj.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STROKE_SPACING) return;
      obj.points.push({ x: p.x, y: p.y });
      const xs = obj.points.map((pt) => pt.x), ys = obj.points.map((pt) => pt.y);
      const pad = obj.thickness;
      obj.x = Math.min(...xs) - pad; obj.y = Math.min(...ys) - pad;
      obj.width = Math.max(...xs) - obj.x + pad; obj.height = Math.max(...ys) - obj.y + pad;
      positionEl(obj);
      obj.pathEl.setAttribute("d", inkPathData(obj));
      obj.el.querySelector("svg").setAttribute("viewBox", `0 0 ${obj.width} ${obj.height}`);
    }
  });

  function finish() {
    if (!drag) return;
    const obj = drag.obj;
    const tooSmall = drag.kind === "highlight" ? (obj.width < 4 || obj.height < 4) : obj.points.length < 2;
    if (tooSmall) {
      obj.el.remove();
    } else {
      // Drag/resize handlers were already wired at creation time
      // (buildHighlightEl / buildInkEl); just keep the finished shape.
      record.objects.push(obj);
      selectObject(obj, pageIndex);
    }
    drag = null;
    liveEl = null;
  }
  record.overlayEl.addEventListener("pointerup", finish);
  record.overlayEl.addEventListener("pointercancel", finish);
}

// --- Save / Clear ---

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pdfJsDoc = null;
  pages = [];
  selectedPageIndex = -1;
  selectedObj = null;
  mode = null;
  highlightBtn.classList.remove("active");
  drawBtn.classList.remove("active");
  pdfPages.innerHTML = "";
  objToolbar.classList.remove("visible");
  editor.style.display = "none";
  actionsRow.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

function hexToRgb01(hex) {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16) / 255,
    g: parseInt(m.slice(2, 4), 16) / 255,
    b: parseInt(m.slice(4, 6), 16) / 255,
  };
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const totalObjects = pages.reduce((sum, p) => sum + p.objects.length, 0);
  if (totalObjects === 0) {
    setStatus(statusEl, "Add a highlight, a note or a drawing first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Saving your annotated PDF…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const pdfPagesArr = doc.getPages();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

    for (let i = 0; i < pages.length; i++) {
      const page = pdfPagesArr[i];
      if (!page) continue;
      const { height: pageHeightPt } = page.getSize();

      for (const obj of pages[i].objects) {
        const { r, g, b } = hexToRgb01(obj.color);
        if (obj.type === "highlight") {
          page.drawRectangle({
            x: obj.x, y: pageHeightPt - obj.y - obj.height, width: obj.width, height: obj.height,
            color: PDFLib.rgb(r, g, b), opacity: 0.4,
          });
        } else if (obj.type === "note") {
          page.drawRectangle({
            x: obj.x, y: pageHeightPt - obj.y - obj.height, width: obj.width, height: obj.height,
            color: PDFLib.rgb(r, g, b), borderColor: PDFLib.rgb(0.2, 0.2, 0.2), borderWidth: 1,
          });
          const size = 11;
          const lineHeight = size * 1.2;
          const maxWidth = obj.width - 16;
          const words = (obj.text || "").split(/\s+/).filter(Boolean);
          const lines = [];
          let line = "";
          for (const w of words) {
            const candidate = line ? `${line} ${w}` : w;
            if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
            else { lines.push(line); line = w; }
          }
          if (line) lines.push(line);
          lines.forEach((l, li) => {
            const ly = pageHeightPt - obj.y - 8 - size * 0.9 - li * lineHeight;
            if (ly > pageHeightPt - obj.y - obj.height) {
              page.drawText(l, { x: obj.x + 8, y: ly, size, font, color: PDFLib.rgb(0.1, 0.1, 0.1) });
            }
          });
        } else if (obj.type === "ink") {
          for (let k = 1; k < obj.points.length; k++) {
            const a = obj.points[k - 1], c = obj.points[k];
            page.drawLine({
              start: { x: a.x, y: pageHeightPt - a.y },
              end: { x: c.x, y: pageHeightPt - c.y },
              thickness: obj.thickness,
              color: PDFLib.rgb(r, g, b),
            });
          }
        }
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("pdf-annotator", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "pdf-annotator",
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
    setStatus(statusEl, `Sorted — ${totalObjects} annotation${totalObjects > 1 ? "s" : ""} added (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
