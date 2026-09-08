const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const boardPresetSelect = document.getElementById("boardPreset");
const customSizeFields = document.getElementById("customSizeFields");
const customWidthInput = document.getElementById("customWidth");
const customHeightInput = document.getElementById("customHeight");
const bgColorInput = document.getElementById("bgColor");
const addPhotosBtn = document.getElementById("addPhotosBtn");
const boardWrap = document.getElementById("boardWrap");
const board = document.getElementById("board");
const itemsLayer = document.getElementById("itemsLayer");
const itemToolbar = document.getElementById("itemToolbar");
const lockAspectInput = document.getElementById("lockAspect");
const bringFrontBtn = document.getElementById("bringFrontBtn");
const sendBackBtn = document.getElementById("sendBackBtn");
const deleteItemBtn = document.getElementById("deleteItemBtn");
const formatSelect = document.getElementById("format");
const qualityField = document.getElementById("qualityField");
const qualityInput = document.getElementById("quality");
const qualityVal = document.getElementById("qualityVal");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const MIN_SIZE = 24;
const CLICK_THRESHOLD_PX = 4;

let naturalW = 1080;
let naturalH = 1080;
let ratio = 1;
let idCounter = 0;
let items = []; // z-order: index 0 = back-most
let selectedItem = null;
let hasStarted = false;

function applyBoardSize(w, h) {
  naturalW = w;
  naturalH = h;
  recalcScale();
}

boardPresetSelect.addEventListener("change", () => {
  const val = boardPresetSelect.value;
  if (val === "custom") {
    customSizeFields.style.display = "flex";
    applyBoardSize(Number(customWidthInput.value) || 1200, Number(customHeightInput.value) || 1200);
  } else {
    customSizeFields.style.display = "none";
    const [w, h] = val.split("x").map(Number);
    applyBoardSize(w, h);
  }
});
customWidthInput.addEventListener("input", () => {
  if (boardPresetSelect.value === "custom") applyBoardSize(Number(customWidthInput.value) || 1200, naturalH);
});
customHeightInput.addEventListener("input", () => {
  if (boardPresetSelect.value === "custom") applyBoardSize(naturalW, Number(customHeightInput.value) || 1200);
});

bgColorInput.addEventListener("input", () => {
  board.style.background = bgColorInput.value;
});

function recalcScale() {
  const availableWidth = boardWrap.clientWidth || naturalW;
  ratio = Math.min(1, availableWidth / naturalW) || 1;
  const cssW = naturalW * ratio;
  const cssH = naturalH * ratio;
  board.style.width = `${cssW}px`;
  board.style.height = `${cssH}px`;
  itemsLayer.style.width = `${naturalW}px`;
  itemsLayer.style.height = `${naturalH}px`;
  itemsLayer.style.transform = `scale(${ratio})`;
}

let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    recalcScale();
    resizeRaf = null;
  });
});

function genId() { return ++idCounter; }

function startEditorIfNeeded() {
  if (hasStarted) return;
  hasStarted = true;
  editor.style.display = "block";
  board.style.background = bgColorInput.value;
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
  await addPhotos(images);
  clearStatus(statusEl);
});

addPhotosBtn.addEventListener("click", () => fileInput.click());

async function addPhotos(files) {
  let stagger = items.length;
  for (const file of files) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      const aspect = img.width / img.height;
      const maxW = naturalW * 0.4;
      const width = Math.min(maxW, img.width);
      const height = width / aspect;
      const offset = (stagger % 6) * 24;
      const obj = {
        id: genId(),
        img,
        x: Math.max(0, (naturalW - width) / 2) + offset - 60,
        y: Math.max(0, (naturalH - height) / 2) + offset - 60,
        width,
        height,
        aspect,
        rotation: 0,
        lockAspect: true,
      };
      buildItemEl(obj);
      items.push(obj);
      itemsLayer.appendChild(obj.el);
      selectItem(obj);
      stagger++;
    } catch (err) {
      console.error(err);
      setStatus(statusEl, `Could not load an image: ${err.message || "unknown error"}`, "error");
      statusEl.classList.add("visible");
    }
  }
}

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
  obj.el.style.transform = `rotate(${obj.rotation}deg)`;
}

function buildItemEl(obj) {
  const el = document.createElement("div");
  el.className = "collage-item";

  const img = document.createElement("img");
  img.src = obj.img.src;
  img.draggable = false;
  el.appendChild(img);

  const rotateHandle = document.createElement("span");
  rotateHandle.className = "rotate-handle";
  el.appendChild(rotateHandle);

  const del = document.createElement("button");
  del.className = "pdf-obj-delete";
  del.type = "button";
  del.textContent = "×";
  del.addEventListener("pointerdown", (e) => e.stopPropagation());
  del.addEventListener("click", () => deleteItem(obj));
  el.appendChild(del);

  buildHandles(el);
  obj.el = el;
  obj.rotateHandleEl = rotateHandle;
  positionEl(obj);
  wireDrag(obj, el);
  wireResize(obj, el);
  wireRotate(obj, rotateHandle);
  return el;
}

// --- Selection ---

function selectItem(obj) {
  if (selectedItem && selectedItem !== obj) selectedItem.el.classList.remove("selected");
  selectedItem = obj;
  obj.el.classList.add("selected");
  itemToolbar.classList.add("visible");
  lockAspectInput.checked = obj.lockAspect;
}

function deselectItem() {
  if (selectedItem) selectedItem.el.classList.remove("selected");
  selectedItem = null;
  itemToolbar.classList.remove("visible");
}

board.addEventListener("pointerdown", (e) => {
  if (e.target === board || e.target === itemsLayer) deselectItem();
});

function deleteItem(obj) {
  items = items.filter((o) => o !== obj);
  obj.el.remove();
  if (selectedItem === obj) deselectItem();
}

lockAspectInput.addEventListener("change", () => {
  if (selectedItem) selectedItem.lockAspect = lockAspectInput.checked;
});
bringFrontBtn.addEventListener("click", () => {
  if (!selectedItem) return;
  items = items.filter((o) => o !== selectedItem);
  items.push(selectedItem);
  itemsLayer.appendChild(selectedItem.el);
});
sendBackBtn.addEventListener("click", () => {
  if (!selectedItem) return;
  items = items.filter((o) => o !== selectedItem);
  items.unshift(selectedItem);
  itemsLayer.insertBefore(selectedItem.el, itemsLayer.firstChild);
});
deleteItemBtn.addEventListener("click", () => {
  if (selectedItem) deleteItem(selectedItem);
});

// --- Pointer helpers ---

function boardPoint(e) {
  const rect = itemsLayer.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / ratio, y: (e.clientY - rect.top) / ratio };
}

function safeCapture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch (_) { /* no active pointer to capture, safe to ignore */ }
}

// --- Drag (move) ---

function wireDrag(obj, el) {
  let dragState = null;
  let moved = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.target.dataset.handle || e.target.classList.contains("pdf-obj-delete") || e.target.classList.contains("rotate-handle")) return;
    e.preventDefault();
    safeCapture(el, e.pointerId);
    const p = boardPoint(e);
    dragState = { startX: p.x, startY: p.y, objX: obj.x, objY: obj.y };
    moved = false;
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const p = boardPoint(e);
    const dx = p.x - dragState.startX;
    const dy = p.y - dragState.startY;
    if (Math.abs(dx) > CLICK_THRESHOLD_PX || Math.abs(dy) > CLICK_THRESHOLD_PX) moved = true;
    if (moved) {
      obj.x = dragState.objX + dx;
      obj.y = dragState.objY + dy;
      positionEl(obj);
    }
  });

  el.addEventListener("pointerup", () => {
    if (!dragState) return;
    dragState = null;
    if (!moved) selectItem(obj);
  });
}

// --- Resize (rotation-aware, corner handles) ---

function wireResize(obj, el) {
  el.querySelectorAll(".crop-handle").forEach((handle) => {
    let resizeState = null;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      safeCapture(handle, e.pointerId);
      resizeState = { corner: handle.dataset.handle };
      selectItem(obj);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resizeState) return;
      const p = boardPoint(e);
      const corner = resizeState.corner;

      // Convert the pointer's board-space position into the item's own
      // unrotated local frame, centered on the item, so corner math works
      // the same regardless of rotation.
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      const rad = (-obj.rotation * Math.PI) / 180;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

      const hx0 = -obj.width / 2, hy0 = -obj.height / 2, hx1 = obj.width / 2, hy1 = obj.height / 2;
      let nx0 = hx0, ny0 = hy0, nx1 = hx1, ny1 = hy1;

      if (corner === "se") { nx1 = Math.max(hx0 + MIN_SIZE, localX); ny1 = Math.max(hy0 + MIN_SIZE, localY); }
      else if (corner === "nw") { nx0 = Math.min(localX, hx1 - MIN_SIZE); ny0 = Math.min(localY, hy1 - MIN_SIZE); }
      else if (corner === "ne") { nx1 = Math.max(localX, hx0 + MIN_SIZE); ny0 = Math.min(localY, hy1 - MIN_SIZE); }
      else if (corner === "sw") { nx0 = Math.min(localX, hx1 - MIN_SIZE); ny1 = Math.max(localY, hy0 + MIN_SIZE); }

      let newW = nx1 - nx0;
      let newH = ny1 - ny0;
      if (obj.lockAspect && obj.aspect) {
        newH = newW / obj.aspect;
        // keep the dragged corner's vertical anchor consistent with the locked height
        if (corner === "nw" || corner === "ne") ny0 = ny1 - newH;
        else ny1 = ny0 + newH;
      }
      const newLocalCx = (nx0 + nx1) / 2;
      const newLocalCy = (ny0 + ny1) / 2;

      // Rotate the new local center back into board space to find the new x/y.
      const fRad = (obj.rotation * Math.PI) / 180;
      const boardOffsetX = newLocalCx * Math.cos(fRad) - newLocalCy * Math.sin(fRad);
      const boardOffsetY = newLocalCx * Math.sin(fRad) + newLocalCy * Math.cos(fRad);
      const newCx = cx + boardOffsetX;
      const newCy = cy + boardOffsetY;

      obj.width = newW;
      obj.height = newH;
      obj.x = newCx - newW / 2;
      obj.y = newCy - newH / 2;
      positionEl(obj);
    });
    handle.addEventListener("pointerup", () => { resizeState = null; });
    handle.addEventListener("pointercancel", () => { resizeState = null; });
  });
}

// --- Rotate ---

function wireRotate(obj, handle) {
  let rotating = false;
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    safeCapture(handle, e.pointerId);
    rotating = true;
    selectItem(obj);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!rotating) return;
    const p = boardPoint(e);
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const angleRad = Math.atan2(p.y - cy, p.x - cx);
    // 0deg = handle pointing straight up (north), matching its resting position above the item.
    let deg = (angleRad * 180) / Math.PI + 90;
    deg = ((deg % 360) + 360) % 360;
    obj.rotation = deg;
    positionEl(obj);
  });
  handle.addEventListener("pointerup", () => { rotating = false; });
  handle.addEventListener("pointercancel", () => { rotating = false; });
}

// --- Toolbar (format/quality) ---

formatSelect.addEventListener("change", () => {
  qualityField.style.display = formatSelect.value === "image/jpeg" ? "flex" : "none";
});
qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; });

clearBtn.addEventListener("click", () => {
  items.forEach((o) => o.el.remove());
  items = [];
  selectedItem = null;
  itemToolbar.classList.remove("visible");
  hasStarted = false;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

// --- Save ---

runBtn.addEventListener("click", async () => {
  if (!items.length) {
    setStatus(statusEl, "Add at least one photo first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building your collage…", "");
  statusEl.classList.add("visible");

  try {
    const canvas = document.createElement("canvas");
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bgColorInput.value;
    ctx.fillRect(0, 0, naturalW, naturalH);

    for (const obj of items) {
      ctx.save();
      ctx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2);
      ctx.rotate((obj.rotation * Math.PI) / 180);
      ctx.drawImage(obj.img, -obj.width / 2, -obj.height / 2, obj.width, obj.height);
      ctx.restore();
    }

    const format = formatSelect.value;
    const quality = format === "image/jpeg" ? Number(qualityInput.value) / 100 : undefined;
    const blob = await canvasToBlob(canvas, format, quality);
    triggerDownload(blob, `collage.${extForMime(format)}`);
    setStatus(statusEl, `Sorted — created a ${canvas.width}×${canvas.height} collage (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
