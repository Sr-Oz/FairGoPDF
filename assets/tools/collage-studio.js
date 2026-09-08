const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const board = document.getElementById("board");
const boardWrap = document.getElementById("boardWrap");
const addPhotosBtn = document.getElementById("addPhotosBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const bgColorInput = document.getElementById("bgColor");
const spacingInput = document.getElementById("spacing");
const spacingVal = document.getElementById("spacingVal");
const cornerInput = document.getElementById("corner");
const cornerVal = document.getElementById("cornerVal");
const customSizeFields = document.getElementById("customSizeFields");
const customWidthInput = document.getElementById("customWidth");
const customHeightInput = document.getElementById("customHeight");
const filterPanel = document.getElementById("filterPanel");
const filterHint = document.getElementById("filterHint");
const applyAllBtn = document.getElementById("applyAllBtn");
const adjBrightness = document.getElementById("adjBrightness");
const adjBrightnessVal = document.getElementById("adjBrightnessVal");
const adjContrast = document.getElementById("adjContrast");
const adjContrastVal = document.getElementById("adjContrastVal");
const adjSaturation = document.getElementById("adjSaturation");
const adjSaturationVal = document.getElementById("adjSaturationVal");
const collageHint = document.getElementById("collageHint");
const captionText = document.getElementById("captionText");
const captionFont = document.getElementById("captionFont");
const captionSize = document.getElementById("captionSize");
const captionSizeVal = document.getElementById("captionSizeVal");
const captionColor = document.getElementById("captionColor");
const captionBar = document.getElementById("captionBar");
const formatSelect = document.getElementById("format");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const SHAPES = {
  square: { w: 1200, h: 1200 },
  story: { w: 1080, h: 1920 },
  a4: { w: 1240, h: 1754 },
};

const FILTERS = [
  { key: "none", label: "No filter", category: "Basic", css: "" },

  { key: "classicBw", label: "Classic B&W", category: "Black & white", css: "grayscale(100%)" },
  { key: "highContrastBw", label: "High-contrast B&W", category: "Black & white", css: "grayscale(100%) contrast(135%)" },
  { key: "softBw", label: "Soft B&W", category: "Black & white", css: "grayscale(100%) contrast(85%) brightness(108%)" },

  { key: "sepia", label: "Sepia", category: "Vintage / film", css: "sepia(75%)" },
  { key: "vintage", label: "Vintage", category: "Vintage / film", css: "sepia(35%) saturate(85%) contrast(95%)" },
  { key: "retro", label: "Retro", category: "Vintage / film", css: "sepia(45%) saturate(140%) hue-rotate(-8deg) contrast(105%)" },
  { key: "fadedFilm", label: "Faded film", category: "Vintage / film", css: "sepia(15%) contrast(80%) brightness(112%) saturate(75%)" },
  { key: "oldPhoto", label: "Old photo", category: "Vintage / film", css: "sepia(55%) contrast(90%) brightness(95%) saturate(70%)" },
  { key: "kodachrome", label: "Kodachrome", category: "Vintage / film", css: "saturate(160%) contrast(115%) hue-rotate(-5deg) brightness(102%)" },
  { key: "crossProcess", label: "Cross-process", category: "Vintage / film", css: "hue-rotate(15deg) saturate(140%) contrast(110%) brightness(98%)" },

  { key: "warm", label: "Warm", category: "Warm / cool", css: "sepia(15%) saturate(130%) brightness(105%)" },
  { key: "cool", label: "Cool", category: "Warm / cool", css: "hue-rotate(180deg) saturate(105%)" },
  { key: "goldenHour", label: "Golden hour", category: "Warm / cool", css: "sepia(25%) saturate(140%) brightness(108%) hue-rotate(-8deg)" },
  { key: "blueHour", label: "Blue hour", category: "Warm / cool", css: "hue-rotate(200deg) saturate(120%) brightness(95%) contrast(105%)" },
  { key: "amber", label: "Amber", category: "Warm / cool", css: "sepia(30%) saturate(150%) brightness(103%)" },
  { key: "winter", label: "Winter", category: "Warm / cool", css: "hue-rotate(190deg) saturate(80%) brightness(103%) contrast(105%)" },

  { key: "vivid", label: "Vivid", category: "Vivid / dramatic", css: "saturate(160%) contrast(115%)" },
  { key: "vibrant", label: "Vibrant", category: "Vivid / dramatic", css: "saturate(180%) brightness(103%)" },
  { key: "dramatic", label: "Dramatic", category: "Vivid / dramatic", css: "contrast(140%) brightness(92%) saturate(110%)" },
  { key: "punch", label: "Punch", category: "Vivid / dramatic", css: "contrast(125%) saturate(140%)" },
  { key: "highDynamic", label: "High dynamic", category: "Vivid / dramatic", css: "contrast(120%) brightness(105%) saturate(115%)" },

  { key: "muted", label: "Muted", category: "Soft / muted", css: "saturate(60%) contrast(92%)" },
  { key: "pastel", label: "Pastel", category: "Soft / muted", css: "saturate(70%) brightness(110%) contrast(88%)" },
  { key: "softGlow", label: "Soft glow", category: "Soft / muted", css: "brightness(112%) contrast(85%) saturate(90%)" },
  { key: "dreamy", label: "Dreamy", category: "Soft / muted", css: "brightness(115%) contrast(80%) saturate(85%)" },
  { key: "matte", label: "Matte", category: "Soft / muted", css: "contrast(85%) brightness(105%) saturate(85%)" },

  { key: "cinematic", label: "Cinematic", category: "Mood", css: "contrast(115%) saturate(90%) brightness(95%) hue-rotate(-3deg)" },
  { key: "nostalgia", label: "Nostalgia", category: "Mood", css: "sepia(20%) saturate(85%) contrast(95%) brightness(102%)" },
  { key: "moody", label: "Moody", category: "Mood", css: "contrast(120%) brightness(88%) saturate(75%) hue-rotate(-5deg)" },
  { key: "editorial", label: "Editorial", category: "Mood", css: "contrast(110%) saturate(95%) brightness(98%)" },
];

const FALLBACK_CONTAINER_WIDTH = 900;
const STACK_ANGLES = [-8, 6, -4, 10, -10, 4, -6, 8, -3];

let photos = []; // { id, img, filterKey, brightness, contrast, saturation }
let idCounter = 0;
let selectedPhotoId = null;
let layoutMode = "grid"; // grid | rows | columns | feature | mosaic | frame | stack
let shapeKey = "square";
let naturalW = SHAPES.square.w;
let naturalH = SHAPES.square.h;
let ratio = 1;
let hasStarted = false;
let dragFromIndex = null;

let caption = { position: "bottom", offsetX: 0, offsetY: 0 };

function genId() { return ++idCounter; }

// --- Filter helpers ---

function filterCssFor(photo) {
  const preset = (FILTERS.find((f) => f.key === photo.filterKey) || FILTERS[0]).css;
  const parts = [];
  if (preset) parts.push(preset);
  if (photo.brightness) parts.push(`brightness(${100 + photo.brightness}%)`);
  if (photo.contrast) parts.push(`contrast(${100 + photo.contrast}%)`);
  if (photo.saturation) parts.push(`saturate(${100 + photo.saturation}%)`);
  return parts.join(" ");
}

function selectedPhoto() { return photos.find((p) => p.id === selectedPhotoId) || null; }

// --- Unified layout engine: every mode returns an array of rects in NATURAL
// pixel space, {x, y, w, h, rotation, empty?}. Grid-family modes may return
// more rects than photos (trailing ones marked empty); the creative modes
// (feature/mosaic/frame/stack) always return exactly one rect per photo.
// Both the live preview and the canvas export read from this one function,
// so they can never drift apart the way two separately-maintained layout
// calculations could.

function gridCellRects(cols, rows, w, h, gap) {
  const cellW = (w - (cols + 1) * gap) / cols;
  const cellH = (h - (rows + 1) * gap) / rows;
  const rects = [];
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    rects.push({ x: gap + col * (cellW + gap), y: gap + row * (cellH + gap), w: cellW, h: cellH, rotation: 0 });
  }
  return rects;
}

function computeLayout(mode, count, w, h, gap) {
  if (count === 0) return [];

  if (mode === "grid" || mode === "rows" || mode === "columns") {
    let cols, rows;
    if (mode === "rows") { cols = 1; rows = count; }
    else if (mode === "columns") { cols = count; rows = 1; }
    else { cols = Math.max(1, Math.ceil(Math.sqrt(count))); rows = Math.max(1, Math.ceil(count / cols)); }
    return gridCellRects(cols, rows, w, h, gap).map((r, i) => ({ ...r, empty: i >= count }));
  }

  if (mode === "feature") {
    if (count === 1) return [{ x: gap, y: gap, w: w - 2 * gap, h: h - 2 * gap, rotation: 0 }];
    const bigW = (w - 3 * gap) * 0.62;
    const stripW = w - 3 * gap - bigW;
    const rects = [{ x: gap, y: gap, w: bigW, h: h - 2 * gap, rotation: 0 }];
    const n2 = count - 1;
    const cellH = (h - (n2 + 1) * gap) / n2;
    for (let i = 0; i < n2; i++) {
      rects.push({ x: gap + bigW + gap, y: gap + i * (cellH + gap), w: stripW, h: cellH, rotation: 0 });
    }
    return rects;
  }

  if (mode === "mosaic") {
    if (count === 1) return [{ x: gap, y: gap, w: w - 2 * gap, h: h - 2 * gap, rotation: 0 }];
    if (count === 2) {
      const bigW = (w - 3 * gap) / 2;
      return [
        { x: gap, y: gap, w: bigW, h: h - 2 * gap, rotation: 0 },
        { x: gap + bigW + gap, y: gap, w: bigW, h: h - 2 * gap, rotation: 0 },
      ];
    }
    const topH = (h - 3 * gap) * 0.58;
    const bigW = (w - 3 * gap) / 2;
    const rects = [
      { x: gap, y: gap, w: bigW, h: topH, rotation: 0 },
      { x: gap + bigW + gap, y: gap, w: bigW, h: topH, rotation: 0 },
    ];
    const rest = count - 2;
    const bottomY = gap + topH + gap;
    const bottomH = h - bottomY - gap;
    const cellW = (w - (rest + 1) * gap) / rest;
    for (let i = 0; i < rest; i++) {
      rects.push({ x: gap + i * (cellW + gap), y: bottomY, w: cellW, h: bottomH, rotation: 0 });
    }
    return rects;
  }

  if (mode === "frame") {
    if (count === 1) return [{ x: gap, y: gap, w: w - 2 * gap, h: h - 2 * gap, rotation: 0 }];
    const rest = count - 1;
    const stripH = (h - 3 * gap) * 0.22;
    const heroH = h - stripH - 3 * gap;
    const heroW = w - 2 * gap;
    const rects = [{ x: gap, y: gap, w: heroW, h: heroH, rotation: 0 }];
    const cellW = (w - (rest + 1) * gap) / rest;
    const stripY = gap + heroH + gap;
    for (let i = 0; i < rest; i++) {
      rects.push({ x: gap + i * (cellW + gap), y: stripY, w: cellW, h: stripH, rotation: 0 });
    }
    return rects;
  }

  if (mode === "stack") {
    const baseSize = Math.min(w, h) * 0.5;
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rowsCount = Math.max(1, Math.ceil(count / cols));
    const spreadX = cols > 1 ? (w - baseSize) / (cols - 1) : 0;
    const spreadY = rowsCount > 1 ? (h - baseSize) / (rowsCount - 1) : 0;
    const rects = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = cols > 1 ? col * spreadX : (w - baseSize) / 2;
      const y = rowsCount > 1 ? row * spreadY : (h - baseSize) / 2;
      rects.push({ x, y, w: baseSize, h: baseSize, rotation: STACK_ANGLES[i % STACK_ANGLES.length] });
    }
    return rects;
  }

  return [];
}

function spacingPxNatural() { return (Number(spacingInput.value) / 100) * naturalW; }
function cornerPctValue() { return Number(cornerInput.value); }
function isPolaroidLayout() { return layoutMode === "stack"; }

// --- Setup ---

function startEditorIfNeeded() {
  if (hasStarted) return;
  hasStarted = true;
  editor.style.display = "block";
  dropzone.classList.add("compact");
  dropzone.querySelector(".dz-title").textContent = "+ Add more photos";
  buildFilterPanel();
  recalcScale();
}

initDropzone(dropzone, fileInput, async (newFiles) => {
  const images = newFiles.filter((f) => f.type.startsWith("image/"));
  if (images.length !== newFiles.length) {
    setStatus(statusEl, "Only image files are supported.", "error");
    statusEl.classList.add("visible");
  }
  if (!images.length) return;
  startEditorIfNeeded();
  for (const file of images) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      photos.push({ id: genId(), img, filterKey: "none", brightness: 0, contrast: 0, saturation: 0 });
    } catch (err) {
      console.error(err);
      setStatus(statusEl, `Could not load an image: ${err.message || "unknown error"}`, "error");
      statusEl.classList.add("visible");
    }
  }
  renderBoard();
  clearStatus(statusEl);
});

addPhotosBtn.addEventListener("click", () => fileInput.click());

shuffleBtn.addEventListener("click", () => {
  for (let i = photos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [photos[i], photos[j]] = [photos[j], photos[i]];
  }
  renderBoard();
});

// --- Layout / shape / spacing controls ---

document.querySelectorAll(".layout-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".layout-opt").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    layoutMode = btn.dataset.layout;
    renderBoard();
  });
});

document.querySelectorAll(".option-btn[data-shape]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".option-btn[data-shape]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    shapeKey = btn.dataset.shape;
    customSizeFields.style.display = shapeKey === "custom" ? "flex" : "none";
    applyShape();
  });
});

function applyShape() {
  if (shapeKey === "custom") {
    naturalW = Number(customWidthInput.value) || 1200;
    naturalH = Number(customHeightInput.value) || 1200;
  } else {
    naturalW = SHAPES[shapeKey].w;
    naturalH = SHAPES[shapeKey].h;
  }
  recalcScale();
  renderBoard();
}

customWidthInput.addEventListener("input", () => { if (shapeKey === "custom") applyShape(); });
customHeightInput.addEventListener("input", () => { if (shapeKey === "custom") applyShape(); });

spacingInput.addEventListener("input", () => { spacingVal.textContent = spacingInput.value; renderBoard(); });
cornerInput.addEventListener("input", () => { cornerVal.textContent = cornerInput.value; renderBoard(); });
bgColorInput.addEventListener("input", () => { board.style.background = bgColorInput.value; });

function recalcScale() {
  const availableWidth = boardWrap.clientWidth || FALLBACK_CONTAINER_WIDTH;
  ratio = Math.min(1, availableWidth / naturalW) || (FALLBACK_CONTAINER_WIDTH / naturalW);
  board.style.width = `${naturalW * ratio}px`;
  board.style.height = `${naturalH * ratio}px`;
  renderBoard();
}

let resizeRaf = null;
function scheduleRecalc() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => { recalcScale(); resizeRaf = null; });
}
window.addEventListener("resize", scheduleRecalc);
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(scheduleRecalc).observe(boardWrap);
}

// --- Board rendering ---

function renderBoard() {
  const count = photos.length;
  const gapPxNatural = spacingPxNatural();
  const gapPx = gapPxNatural * ratio;
  const cornerPct = cornerPctValue();
  const polaroid = isPolaroidLayout();
  const rects = computeLayout(layoutMode, count, naturalW, naturalH, gapPxNatural);

  board.style.display = "block";
  board.style.background = bgColorInput.value;
  board.innerHTML = "";

  rects.forEach((rect, i) => {
    const cell = document.createElement("div");
    cell.className = "collage-cell";
    cell.style.position = "absolute";
    cell.style.left = `${rect.x * ratio}px`;
    cell.style.top = `${rect.y * ratio}px`;
    cell.style.width = `${rect.w * ratio}px`;
    cell.style.height = `${rect.h * ratio}px`;
    if (rect.rotation) cell.style.transform = `rotate(${rect.rotation}deg)`;
    if (polaroid) {
      cell.classList.add("polaroid");
      const pad = Math.max(4, rect.w * ratio * 0.04);
      cell.style.padding = `${pad}px`;
      cell.style.zIndex = String(i);
    } else {
      const radiusPct = cornerPct * 2;
      cell.style.borderRadius = `${radiusPct}%`;
    }

    const photo = photos[i];
    if (photo && !rect.empty) {
      if (photo.id === selectedPhotoId) cell.classList.add("selected");
      cell.draggable = true;
      cell.dataset.index = String(i);

      const img = document.createElement("img");
      img.src = photo.img.src;
      img.style.filter = filterCssFor(photo);
      if (polaroid) img.style.borderRadius = "0";
      img.addEventListener("click", () => selectPhoto(photo.id));
      cell.appendChild(img);

      const del = document.createElement("button");
      del.className = "pdf-obj-delete collage-cell-delete";
      del.type = "button";
      del.textContent = "×";
      del.addEventListener("pointerdown", (e) => e.stopPropagation());
      del.addEventListener("click", (e) => { e.stopPropagation(); deletePhoto(photo.id); });
      cell.appendChild(del);

      wireCellDrag(cell, i);
    } else {
      cell.classList.add("empty");
      cell.textContent = "Empty";
    }
    board.appendChild(cell);
  });

  renderCaption();

  collageHint.textContent = count
    ? "Click a photo to select it, drag one photo onto another to swap them."
    : "Add photos to fill this layout.";

  syncFilterSwatchThumbnails();
}

function wireCellDrag(cell, index) {
  cell.addEventListener("dragstart", (e) => {
    dragFromIndex = index;
    cell.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("dragging");
    dragFromIndex = null;
  });
  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    cell.classList.add("drag-over");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("drag-over");
    if (dragFromIndex === null || dragFromIndex === index) return;
    [photos[dragFromIndex], photos[index]] = [photos[index], photos[dragFromIndex]];
    renderBoard();
  });
}

function selectPhoto(id) {
  selectedPhotoId = id;
  const photo = selectedPhoto();
  adjBrightness.value = photo ? photo.brightness : 0;
  adjContrast.value = photo ? photo.contrast : 0;
  adjSaturation.value = photo ? photo.saturation : 0;
  adjBrightnessVal.textContent = adjBrightness.value;
  adjContrastVal.textContent = adjContrast.value;
  adjSaturationVal.textContent = adjSaturation.value;
  renderBoard();
  syncFilterPanelSelection();
  filterHint.textContent = "Pick a filter for the selected photo.";
  applyAllBtn.style.display = "inline-flex";
}

function deletePhoto(id) {
  photos = photos.filter((p) => p.id !== id);
  if (selectedPhotoId === id) selectedPhotoId = null;
  renderBoard();
  syncFilterPanelSelection();
}

// --- Filter panel ---

function buildFilterPanel() {
  filterPanel.innerHTML = "";
  const categories = [];
  FILTERS.forEach((f) => { if (!categories.includes(f.category)) categories.push(f.category); });

  categories.forEach((cat) => {
    const label = document.createElement("p");
    label.className = "filter-category-label";
    label.textContent = cat;
    filterPanel.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "filter-grid";
    FILTERS.filter((f) => f.category === cat).forEach((f) => {
      const btn = document.createElement("button");
      btn.className = "filter-swatch";
      btn.type = "button";
      btn.dataset.filterKey = f.key;
      const img = document.createElement("img");
      img.style.filter = f.css;
      const span = document.createElement("span");
      span.textContent = f.label;
      btn.appendChild(img);
      btn.appendChild(span);
      btn.addEventListener("click", () => applyFilterToSelected(f.key));
      grid.appendChild(btn);
    });
    filterPanel.appendChild(grid);
  });

  syncFilterSwatchThumbnails();
}

function syncFilterSwatchThumbnails() {
  const sourceImg = (photos[0] && photos[0].img.src) || null;
  filterPanel.querySelectorAll(".filter-swatch img").forEach((img) => {
    if (sourceImg) img.src = sourceImg;
  });
}

function syncFilterPanelSelection() {
  const photo = selectedPhoto();
  filterPanel.querySelectorAll(".filter-swatch").forEach((btn) => {
    btn.classList.toggle("active", !!photo && btn.dataset.filterKey === photo.filterKey);
  });
  if (!photo) {
    filterHint.textContent = "Click a photo first, then a filter below.";
    applyAllBtn.style.display = "none";
  }
}

function applyFilterToSelected(filterKey) {
  const photo = selectedPhoto();
  if (!photo) {
    setStatus(statusEl, "Click a photo first, then choose a filter for it.", "error");
    statusEl.classList.add("visible");
    return;
  }
  photo.filterKey = filterKey;
  renderBoard();
  syncFilterPanelSelection();
}

applyAllBtn.addEventListener("click", () => {
  const photo = selectedPhoto();
  if (!photo) return;
  photos.forEach((p) => {
    p.filterKey = photo.filterKey;
    p.brightness = photo.brightness;
    p.contrast = photo.contrast;
    p.saturation = photo.saturation;
  });
  renderBoard();
});

// --- Fine-tune sliders ---

function wireAdjustSlider(input, valEl, prop) {
  input.addEventListener("input", () => {
    valEl.textContent = input.value;
    const photo = selectedPhoto();
    if (!photo) {
      setStatus(statusEl, "Click a photo first, then adjust it.", "error");
      statusEl.classList.add("visible");
      return;
    }
    photo[prop] = Number(input.value);
    renderBoard();
  });
}
wireAdjustSlider(adjBrightness, adjBrightnessVal, "brightness");
wireAdjustSlider(adjContrast, adjContrastVal, "contrast");
wireAdjustSlider(adjSaturation, adjSaturationVal, "saturation");

// --- Text overlay ---

function renderCaption() {
  const existing = board.querySelector(".collage-caption");
  if (existing) existing.remove();
  const text = captionText.value.trim();
  if (!text) return;

  const sizePx = (Number(captionSize.value) / 100) * naturalW * ratio;
  const cap = document.createElement("div");
  cap.className = "collage-caption";
  cap.textContent = text;
  cap.style.fontFamily = captionFont.value;
  cap.style.fontSize = `${sizePx}px`;
  cap.style.color = captionColor.value;
  if (captionBar.checked) {
    cap.style.background = "rgba(0,0,0,0.45)";
  }

  const basePos = caption.position;
  if (basePos === "top") cap.style.top = "0";
  else if (basePos === "bottom") cap.style.bottom = "0";
  else { cap.style.top = "50%"; cap.style.transform = "translateY(-50%)"; }

  cap.style.transform = `${cap.style.transform || ""} translate(${caption.offsetX * ratio}px, ${caption.offsetY * ratio}px)`.trim();
  cap.style.pointerEvents = "auto";
  cap.style.cursor = "grab";
  wireCaptionDrag(cap);

  board.appendChild(cap);
}

function wireCaptionDrag(cap) {
  let dragState = null;
  cap.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { cap.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer, safe to ignore */ }
    dragState = { startX: e.clientX, startY: e.clientY, offX: caption.offsetX, offY: caption.offsetY };
  });
  cap.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const dx = (e.clientX - dragState.startX) / ratio;
    const dy = (e.clientY - dragState.startY) / ratio;
    caption.offsetX = dragState.offX + dx;
    caption.offsetY = dragState.offY + dy;
    renderCaption();
  });
  cap.addEventListener("pointerup", () => { dragState = null; });
  cap.addEventListener("pointercancel", () => { dragState = null; });
}

[captionText, captionFont, captionSize, captionColor, captionBar].forEach((el) => {
  el.addEventListener("input", () => {
    if (el === captionSize) captionSizeVal.textContent = captionSize.value;
    renderCaption();
  });
});

document.querySelectorAll("[data-caption-pos]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-caption-pos]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    caption.position = btn.dataset.captionPos;
    caption.offsetX = 0;
    caption.offsetY = 0;
    renderCaption();
  });
});

// --- Clear ---

clearBtn.addEventListener("click", () => {
  photos = [];
  selectedPhotoId = null;
  hasStarted = false;
  caption = { position: "bottom", offsetX: 0, offsetY: 0 };
  captionText.value = "";
  board.innerHTML = "";
  editor.style.display = "none";
  dropzone.classList.remove("compact");
  dropzone.querySelector(".dz-title").textContent = "Drop your photos here, easy as.";
  fileInput.value = "";
  clearStatus(statusEl);
});

// --- Save (canvas export, using the exact same computeLayout() as the preview) ---

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCoverCropped(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const srcCropW = w / scale;
  const srcCropH = h / scale;
  const srcX = (img.width - srcCropW) / 2;
  const srcY = (img.height - srcCropH) / 2;
  ctx.drawImage(img, srcX, srcY, srcCropW, srcCropH, x, y, w, h);
}

runBtn.addEventListener("click", async () => {
  if (!photos.length) {
    setStatus(statusEl, "Add at least one photo first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building your collage…", "");
  statusEl.classList.add("visible");

  try {
    const gapPx = spacingPxNatural();
    const cornerPct = cornerPctValue();
    const polaroid = isPolaroidLayout();
    const rects = computeLayout(layoutMode, photos.length, naturalW, naturalH, gapPx);

    const canvas = document.createElement("canvas");
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bgColorInput.value;
    ctx.fillRect(0, 0, naturalW, naturalH);

    rects.forEach((rect, i) => {
      const photo = photos[i];
      if (!photo || rect.empty) return;
      const img = photo.img;

      ctx.save();
      ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
      if (rect.rotation) ctx.rotate((rect.rotation * Math.PI) / 180);

      if (polaroid) {
        const pad = Math.max(4, rect.w * 0.04);
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = rect.w * 0.05;
        ctx.fillRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
        ctx.shadowColor = "transparent";
        const innerW = rect.w - pad * 2;
        const innerH = rect.h - pad * 2;
        ctx.filter = filterCssFor(photo) || "none";
        drawCoverCropped(ctx, img, -innerW / 2, -innerH / 2, innerW, innerH);
      } else {
        const radiusPx = (cornerPct / 100) * Math.min(rect.w, rect.h) * 2;
        roundedRectPath(ctx, -rect.w / 2, -rect.h / 2, rect.w, rect.h, radiusPx);
        ctx.clip();
        ctx.filter = filterCssFor(photo) || "none";
        drawCoverCropped(ctx, img, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
      }
      ctx.restore();
    });

    const text = captionText.value.trim();
    if (text) {
      const sizePx = (Number(captionSize.value) / 100) * naturalW;
      ctx.save();
      ctx.font = `700 ${sizePx}px ${captionFont.value}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textW = ctx.measureText(text).width;
      let cy;
      if (caption.position === "top") cy = sizePx * 0.9;
      else if (caption.position === "bottom") cy = naturalH - sizePx * 0.9;
      else cy = naturalH / 2;
      const cx = naturalW / 2 + caption.offsetX;
      cy += caption.offsetY;

      if (captionBar.checked) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(cx - textW / 2 - sizePx * 0.4, cy - sizePx * 0.7, textW + sizePx * 0.8, sizePx * 1.4);
      }
      ctx.fillStyle = captionColor.value;
      ctx.fillText(text, cx, cy);
      ctx.restore();
    }

    const format = formatSelect.value;
    const blob = await canvasToBlob(canvas, format, format === "image/jpeg" ? 0.92 : undefined);
    triggerDownload(blob, `collage.${extForMime(format)}`);
    setStatus(statusEl, `Sorted — created a ${canvas.width}×${canvas.height} collage (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
