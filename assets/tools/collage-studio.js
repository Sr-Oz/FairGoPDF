const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const board = document.getElementById("board");
const boardWrap = document.getElementById("boardWrap");
const addPhotosBtn = document.getElementById("addPhotosBtn");
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
const collageHint = document.getElementById("collageHint");
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
  { key: "noir", label: "Noir", category: "Vintage / film", css: "grayscale(100%) contrast(140%) brightness(85%)" },
  { key: "vintage", label: "Vintage", category: "Vintage / film", css: "sepia(35%) saturate(85%) contrast(95%)" },
  { key: "faded", label: "Faded", category: "Vintage / film", css: "contrast(88%) brightness(108%) saturate(70%)" },
];

const FALLBACK_CONTAINER_WIDTH = 900;

let photos = []; // { id, img, filterKey }
let idCounter = 0;
let selectedPhotoId = null;
let layoutMode = "grid"; // 'grid' | 'rows' | 'columns'
let shapeKey = "square"; // 'square' | 'story' | 'a4' | 'custom'
let naturalW = SHAPES.square.w;
let naturalH = SHAPES.square.h;
let ratio = 1;
let hasStarted = false;

function genId() { return ++idCounter; }

function gridDims(count, mode) {
  if (count === 0) return { cols: 1, rows: 1 };
  if (mode === "rows") return { cols: 1, rows: count };
  if (mode === "columns") return { cols: count, rows: 1 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cols, rows };
}

function spacingPxNatural() { return (Number(spacingInput.value) / 100) * naturalW; }
function cornerPctValue() { return Number(cornerInput.value); }

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
      photos.push({ id: genId(), img, filterKey: "none" });
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

// --- Board rendering (real CSS grid, cells auto-size to the container) ---

function renderBoard() {
  const count = photos.length;
  const { cols, rows } = gridDims(count, layoutMode);
  const gapPx = spacingPxNatural() * ratio;
  const cornerPct = cornerPctValue();

  board.style.display = "grid";
  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  board.style.gap = `${gapPx}px`;
  board.style.padding = `${gapPx}px`;
  board.style.boxSizing = "border-box";
  board.style.background = bgColorInput.value;

  board.innerHTML = "";
  const totalCells = cols * rows;
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "collage-cell";
    const radiusPct = cornerPct * 2; // matches the export's min(cellW,cellH)-relative math closely enough
    cell.style.borderRadius = `${radiusPct}%`;

    const photo = photos[i];
    if (photo) {
      if (photo.id === selectedPhotoId) cell.classList.add("selected");
      const img = document.createElement("img");
      img.src = photo.img.src;
      img.style.filter = (FILTERS.find((f) => f.key === photo.filterKey) || FILTERS[0]).css;
      img.addEventListener("click", () => selectPhoto(photo.id));
      cell.appendChild(img);

      const del = document.createElement("button");
      del.className = "pdf-obj-delete collage-cell-delete";
      del.type = "button";
      del.textContent = "×";
      del.addEventListener("click", (e) => { e.stopPropagation(); deletePhoto(photo.id); });
      cell.appendChild(del);
    } else {
      cell.classList.add("empty");
      cell.textContent = "Empty";
    }
    board.appendChild(cell);
  }

  collageHint.textContent = count
    ? "Click a photo to select it, use the × to remove one."
    : "Add photos to fill this layout.";

  syncFilterSwatchThumbnails();
}

function selectPhoto(id) {
  selectedPhotoId = id;
  renderBoard();
  syncFilterPanelSelection();
  filterHint.textContent = "Pick a filter for the selected photo.";
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
  const photo = photos.find((p) => p.id === selectedPhotoId);
  filterPanel.querySelectorAll(".filter-swatch").forEach((btn) => {
    btn.classList.toggle("active", !!photo && btn.dataset.filterKey === photo.filterKey);
  });
  if (!photo) filterHint.textContent = "Click a photo first, then a filter below.";
}

function applyFilterToSelected(filterKey) {
  const photo = photos.find((p) => p.id === selectedPhotoId);
  if (!photo) {
    setStatus(statusEl, "Click a photo first, then choose a filter for it.", "error");
    statusEl.classList.add("visible");
    return;
  }
  photo.filterKey = filterKey;
  renderBoard();
  syncFilterPanelSelection();
}

// --- Clear ---

clearBtn.addEventListener("click", () => {
  photos = [];
  selectedPhotoId = null;
  hasStarted = false;
  board.innerHTML = "";
  editor.style.display = "none";
  dropzone.classList.remove("compact");
  dropzone.querySelector(".dz-title").textContent = "Drop your photos here, easy as.";
  fileInput.value = "";
  clearStatus(statusEl);
});

// --- Save (canvas export matching the CSS grid preview) ---

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
    const { cols, rows } = gridDims(photos.length, layoutMode);
    const gapPx = spacingPxNatural();
    const cornerPct = cornerPctValue();

    const canvas = document.createElement("canvas");
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bgColorInput.value;
    ctx.fillRect(0, 0, naturalW, naturalH);

    const cellW = (naturalW - (cols + 1) * gapPx) / cols;
    const cellH = (naturalH - (rows + 1) * gapPx) / rows;
    const radiusPx = (cornerPct / 100) * Math.min(cellW, cellH) * 2;

    photos.forEach((photo, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gapPx + col * (cellW + gapPx);
      const y = gapPx + row * (cellH + gapPx);
      const img = photo.img;

      ctx.save();
      roundedRectPath(ctx, x, y, cellW, cellH, radiusPx);
      ctx.clip();

      const filter = (FILTERS.find((f) => f.key === photo.filterKey) || FILTERS[0]).css;
      if (filter) ctx.filter = filter;

      const scale = Math.max(cellW / img.width, cellH / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const srcCropW = cellW / scale;
      const srcCropH = cellH / scale;
      const srcX = (img.width - srcCropW) / 2;
      const srcY = (img.height - srcCropH) / 2;
      ctx.drawImage(img, srcX, srcY, srcCropW, srcCropH, x, y, cellW, cellH);
      ctx.restore();
    });

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
