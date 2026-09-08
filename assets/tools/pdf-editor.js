import { PDFLib, loadPdfJsDoc } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pdfPages = document.getElementById("pdfPages");
const addTextBtn = document.getElementById("addTextBtn");
const addImageBtn = document.getElementById("addImageBtn");
const imageInput = document.getElementById("imageInput");
const objToolbar = document.getElementById("objToolbar");
const fontFamilySelect = document.getElementById("objFontFamily");
const fontSizeInput = document.getElementById("objFontSize");
const colorInput = document.getElementById("objColor");
const boldInput = document.getElementById("objBold");
const italicInput = document.getElementById("objItalic");
const deleteObjBtn = document.getElementById("deleteObjBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const RENDER_SCALE = 2;
const MIN_SIZE = 12;
const CLICK_THRESHOLD_PX = 4;
const LINE_HEIGHT = 1.2;

const CSS_FONT_STACK = {
  Helvetica: "Helvetica, Arial, sans-serif",
  TimesRoman: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let idCounter = 0;

// pages[i] = { naturalW, naturalH, wrapEl, canvasEl, overlayEl, ratio, objects: [] }
let pages = [];
let selectedPageIndex = -1;
let selectedObj = null; // the object record currently selected, or null

initDropzone(dropzone, fileInput, async (files) => {
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
    recalcAllScales(); // now that #editor is visible/laid out, ratios are measurable
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

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

    // Don't block showing the page (and letting people start placing objects on
    // earlier pages) on every page's pixels finishing rendering.
    page.render({ canvasContext: canvasEl.getContext("2d"), viewport: renderViewport }).promise
      .then(() => recalcAllScales())
      .catch((err) => console.error(`Failed to render page ${i}:`, err));

    wrapEl.addEventListener("pointerdown", (e) => {
      selectPage(i - 1);
      if (e.target === wrapEl || e.target === canvasEl || e.target === overlayEl) {
        deselectObject();
      }
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
  resizeRaf = requestAnimationFrame(() => {
    recalcAllScales();
    resizeRaf = null;
  });
});

function selectPage(index) {
  selectedPageIndex = index;
  pages.forEach((p, i) => p.wrapEl.classList.toggle("selected-page", i === index));
}

function genId() { return ++idCounter; }

// --- Object creation ---

addTextBtn.addEventListener("click", () => {
  if (selectedPageIndex < 0) return;
  const page = pages[selectedPageIndex];
  const obj = {
    id: genId(),
    type: "text",
    x: 40,
    y: 40,
    width: 180,
    height: 24,
    text: "New text",
    fontSize: 16,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
    color: "#1a1a1a",
  };
  const el = buildTextEl(obj);
  page.overlayEl.appendChild(el);
  obj.el = el;
  page.objects.push(obj);
  selectObject(obj, selectedPageIndex);
  enterTextEditMode(obj);
});

addImageBtn.addEventListener("click", () => {
  if (selectedPageIndex < 0) return;
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files && imageInput.files[0];
  imageInput.value = "";
  if (!file || selectedPageIndex < 0) return;
  const page = pages[selectedPageIndex];

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = file.type === "image/png";
    const isJpg = file.type === "image/jpeg" || file.type === "image/jpg";
    if (!isPng && !isJpg) {
      setStatus(statusEl, "Please choose a PNG or JPEG image.", "error");
      statusEl.classList.add("visible");
      return;
    }
    const dataUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    URL.revokeObjectURL(dataUrl);

    const maxW = Math.min(200, page.naturalW - 80);
    const aspect = img.naturalWidth / img.naturalHeight;
    const width = Math.min(maxW, img.naturalWidth);
    const height = width / aspect;

    const obj = {
      id: genId(),
      type: "image",
      x: Math.max(0, (page.naturalW - width) / 2),
      y: 40,
      width,
      height,
      aspect,
      imgBytes: bytes,
      isPng,
    };
    const el = buildImageEl(obj, img.src);
    page.overlayEl.appendChild(el);
    obj.el = el;
    page.objects.push(obj);
    selectObject(obj, selectedPageIndex);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not add that image: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

// --- DOM building ---

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

function buildTextEl(obj) {
  const el = document.createElement("div");
  el.className = "pdf-obj";
  const body = document.createElement("div");
  body.className = "pdf-obj-body";
  body.textContent = obj.text;
  obj.bodyEl = body;
  el.appendChild(body);

  const del = document.createElement("button");
  del.className = "pdf-obj-delete";
  del.type = "button";
  del.textContent = "×";
  del.addEventListener("pointerdown", (e) => e.stopPropagation());
  del.addEventListener("click", () => deleteObject(obj));
  el.appendChild(del);

  buildHandles(el);
  obj.el = el;
  positionEl(obj);
  applyTextStyle(obj);
  wireObjectDrag(obj, el);
  wireResizeHandles(obj, el);

  body.addEventListener("input", () => { obj.text = body.textContent; });
  return el;
}

function applyTextStyle(obj) {
  if (!obj.bodyEl) return;
  obj.bodyEl.style.fontFamily = CSS_FONT_STACK[obj.fontFamily] || CSS_FONT_STACK.Helvetica;
  obj.bodyEl.style.fontSize = `${obj.fontSize}px`;
  obj.bodyEl.style.fontWeight = obj.bold ? "700" : "400";
  obj.bodyEl.style.fontStyle = obj.italic ? "italic" : "normal";
  obj.bodyEl.style.color = obj.color;
  obj.bodyEl.style.lineHeight = String(LINE_HEIGHT);
}

function buildImageEl(obj, src) {
  const el = document.createElement("div");
  el.className = "pdf-obj";
  const img = document.createElement("img");
  img.src = src;
  img.draggable = false;
  el.appendChild(img);

  const del = document.createElement("button");
  del.className = "pdf-obj-delete";
  del.type = "button";
  del.textContent = "×";
  del.addEventListener("pointerdown", (e) => e.stopPropagation());
  del.addEventListener("click", () => deleteObject(obj));
  el.appendChild(del);

  buildHandles(el);
  obj.el = el;
  positionEl(obj);
  wireObjectDrag(obj, el);
  wireResizeHandles(obj, el);
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

  if (obj.type === "text") {
    objToolbar.classList.add("visible");
    fontFamilySelect.value = obj.fontFamily;
    fontSizeInput.value = String(obj.fontSize);
    colorInput.value = obj.color;
    boldInput.checked = obj.bold;
    italicInput.checked = obj.italic;
  } else {
    objToolbar.classList.remove("visible");
  }
}

function enterTextEditMode(obj) {
  if (obj.type !== "text") return;
  obj.bodyEl.setAttribute("contenteditable", "true");
  obj.bodyEl.focus();
  const range = document.createRange();
  range.selectNodeContents(obj.bodyEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function exitTextEditMode(obj) {
  if (obj.type !== "text" || !obj.bodyEl) return;
  obj.bodyEl.removeAttribute("contenteditable");
}

function deleteObject(obj) {
  const page = pages[selectedPageIndex] || pages.find((p) => p.objects.includes(obj));
  if (page) page.objects = page.objects.filter((o) => o !== obj);
  obj.el.remove();
  if (selectedObj === obj) {
    selectedObj = null;
    objToolbar.classList.remove("visible");
  }
}

// --- Object toolbar wiring ---

fontFamilySelect.addEventListener("change", () => {
  if (selectedObj && selectedObj.type === "text") {
    selectedObj.fontFamily = fontFamilySelect.value;
    applyTextStyle(selectedObj);
  }
});
fontSizeInput.addEventListener("input", () => {
  if (selectedObj && selectedObj.type === "text") {
    selectedObj.fontSize = Number(fontSizeInput.value) || 16;
    applyTextStyle(selectedObj);
  }
});
colorInput.addEventListener("input", () => {
  if (selectedObj && selectedObj.type === "text") {
    selectedObj.color = colorInput.value;
    applyTextStyle(selectedObj);
  }
});
boldInput.addEventListener("change", () => {
  if (selectedObj && selectedObj.type === "text") {
    selectedObj.bold = boldInput.checked;
    applyTextStyle(selectedObj);
  }
});
italicInput.addEventListener("change", () => {
  if (selectedObj && selectedObj.type === "text") {
    selectedObj.italic = italicInput.checked;
    applyTextStyle(selectedObj);
  }
});
deleteObjBtn.addEventListener("click", () => {
  if (selectedObj) deleteObject(selectedObj);
});

// --- Drag & resize ---

function pagePoint(pageIndex, e) {
  const p = pages[pageIndex];
  const rect = p.overlayEl.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / p.ratio, y: (e.clientY - rect.top) / p.ratio };
}

function wireObjectDrag(obj, el) {
  let dragState = null;
  let moved = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.target.dataset.handle || e.target.classList.contains("pdf-obj-delete")) return;
    if (obj.bodyEl && obj.bodyEl.getAttribute("contenteditable") === "true") return; // let text editing take over
    e.preventDefault();
    const pageIndex = Number(el.closest(".pdf-page-wrap").dataset.pageIndex);
    selectPage(pageIndex);
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer to capture, safe to ignore */ }
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
      obj.x = dragState.objX + dx;
      obj.y = dragState.objY + dy;
      positionEl(obj);
    }
  });

  el.addEventListener("pointerup", (e) => {
    if (!dragState) return;
    const pageIndex = dragState.pageIndex;
    dragState = null;
    if (!moved) {
      const alreadySelected = selectedObj === obj;
      selectObject(obj, pageIndex);
      if (alreadySelected && obj.type === "text") enterTextEditMode(obj);
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
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer to capture, safe to ignore */ }
      resizeState = { corner: handle.dataset.handle, pageIndex };
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resizeState) return;
      const p = pagePoint(resizeState.pageIndex, e);
      const corner = resizeState.corner;
      const x0 = obj.x, y0 = obj.y, x1 = obj.x + obj.width, y1 = obj.y + obj.height;
      let nx = x0, ny = y0, nw = obj.width, nh = obj.height;

      if (corner === "se") { nw = Math.max(MIN_SIZE, p.x - x0); nh = Math.max(MIN_SIZE, p.y - y0); nx = x0; ny = y0; }
      else if (corner === "nw") { nx = Math.min(p.x, x1 - MIN_SIZE); ny = Math.min(p.y, y1 - MIN_SIZE); nw = x1 - nx; nh = y1 - ny; }
      else if (corner === "ne") { ny = Math.min(p.y, y1 - MIN_SIZE); nw = Math.max(MIN_SIZE, p.x - x0); nh = y1 - ny; nx = x0; }
      else if (corner === "sw") { nx = Math.min(p.x, x1 - MIN_SIZE); nw = x1 - nx; nh = Math.max(MIN_SIZE, p.y - y0); ny = y0; }

      if (obj.type === "image" && obj.aspect) {
        nh = nw / obj.aspect;
        if (corner === "nw" || corner === "ne") ny = y1 - nh;
      }
      if (obj.type === "text") {
        const ratioW = nw / obj.width;
        obj.fontSize = Math.max(6, Math.round(obj.fontSize * ratioW));
        applyTextStyle(obj);
        if (selectedObj === obj) fontSizeInput.value = String(obj.fontSize);
      }

      obj.x = nx; obj.y = ny; obj.width = nw; obj.height = nh;
      positionEl(obj);
    });
    handle.addEventListener("pointerup", () => { resizeState = null; });
    handle.addEventListener("pointercancel", () => { resizeState = null; });
  });
}

// --- Save ---

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pdfJsDoc = null;
  pages = [];
  selectedPageIndex = -1;
  selectedObj = null;
  pdfPages.innerHTML = "";
  objToolbar.classList.remove("visible");
  editor.style.display = "none";
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

function standardFontFor(family, bold, italic) {
  const SF = PDFLib.StandardFonts;
  const table = {
    Helvetica: [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique, SF.HelveticaBoldOblique],
    TimesRoman: [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic, SF.TimesRomanBoldItalic],
    Courier: [SF.Courier, SF.CourierBold, SF.CourierOblique, SF.CourierBoldOblique],
  };
  const set = table[family] || table.Helvetica;
  const idx = (bold ? 1 : 0) + (italic ? 2 : 0);
  return set[idx];
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const totalObjects = pages.reduce((sum, p) => sum + p.objects.length, 0);
  if (totalObjects === 0) {
    setStatus(statusEl, "Add some text or an image first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building your PDF…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const pdfPagesArr = doc.getPages();
    const fontCache = new Map();

    for (let i = 0; i < pages.length; i++) {
      const page = pdfPagesArr[i];
      if (!page) continue;
      const { height: pageHeightPt } = page.getSize();

      for (const obj of pages[i].objects) {
        if (obj.type === "text") {
          const text = (obj.text || "").trim();
          if (!text) continue;
          const key = `${obj.fontFamily}|${obj.bold}|${obj.italic}`;
          if (!fontCache.has(key)) {
            fontCache.set(key, await doc.embedFont(standardFontFor(obj.fontFamily, obj.bold, obj.italic)));
          }
          const font = fontCache.get(key);
          const { r, g, b } = hexToRgb01(obj.color);
          const lines = obj.text.split("\n");
          lines.forEach((line, li) => {
            const baselineFromTop = obj.y + li * obj.fontSize * LINE_HEIGHT + obj.fontSize * 0.8;
            page.drawText(line, {
              x: obj.x,
              y: pageHeightPt - baselineFromTop,
              size: obj.fontSize,
              font,
              color: PDFLib.rgb(r, g, b),
            });
          });
        } else if (obj.type === "image") {
          const image = obj.isPng ? await doc.embedPng(obj.imgBytes) : await doc.embedJpg(obj.imgBytes);
          page.drawImage(image, {
            x: obj.x,
            y: pageHeightPt - obj.y - obj.height,
            width: obj.width,
            height: obj.height,
          });
        }
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-edited.pdf`);
    setStatus(statusEl, `Sorted — ${totalObjects} item${totalObjects > 1 ? "s" : ""} added (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
