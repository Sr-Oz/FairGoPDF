(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const editor = document.getElementById("editor");
  const cropStage = document.getElementById("cropStage");
  const canvas = document.getElementById("displayCanvas");
  const cropBox = document.getElementById("cropBox");
  const dimsReadout = document.getElementById("dimsReadout");
  const formatSelect = document.getElementById("format");
  const qualityInput = document.getElementById("quality");
  const qualityVal = document.getElementById("qualityVal");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const ctx = canvas.getContext("2d");

  let currentFile = null;
  let box = { x: 0, y: 0, w: 1, h: 1 }; // crop box as fractions of the canvas
  const MIN_FRAC = 0.03;

  function updateBoxDom() {
    cropBox.style.left = box.x * 100 + "%";
    cropBox.style.top = box.y * 100 + "%";
    cropBox.style.width = box.w * 100 + "%";
    cropBox.style.height = box.h * 100 + "%";
    const px = Math.round(box.w * canvas.width);
    const py = Math.round(box.h * canvas.height);
    dimsReadout.textContent = `Selection: ${px} × ${py}px (of ${canvas.width} × ${canvas.height}px)`;
  }

  function resetCropBox() {
    box = { x: 0, y: 0, w: 1, h: 1 };
    updateBoxDom();
  }

  function loadImageToCanvas(img) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    resetCropBox();
  }

  function snapshotCanvas() {
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext("2d").drawImage(canvas, 0, 0);
    return tmp;
  }

  function rotate(deg) {
    const old = snapshotCanvas();
    const swap = Math.abs(deg) === 90 || Math.abs(deg) === 270;
    const newW = swap ? old.height : old.width;
    const newH = swap ? old.width : old.height;
    canvas.width = newW;
    canvas.height = newH;
    ctx.save();
    ctx.translate(newW / 2, newH / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(old, -old.width / 2, -old.height / 2);
    ctx.restore();
    resetCropBox();
  }

  function flip(axis) {
    const old = snapshotCanvas();
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (axis === "h") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(old, 0, 0);
    ctx.restore();
    resetCropBox();
  }

  async function handleFiles(files) {
    const image = files.find((f) => f.type.startsWith("image/"));
    if (!image) return;
    currentFile = image;
    try {
      const dataUrl = await readFileAsDataURL(image);
      const img = await loadImage(dataUrl);
      loadImageToCanvas(img);
      editor.style.display = "block";
      clearStatus(statusEl);
    } catch (err) {
      setStatus(statusEl, "Could not load that image.", "error");
      statusEl.classList.add("visible");
    }
  }

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "crop-rotate-image", dropzone, onFiles: handleFiles });
}

  document.getElementById("rotateLeft").addEventListener("click", () => rotate(-90));
  document.getElementById("rotateRight").addEventListener("click", () => rotate(90));
  document.getElementById("flipH").addEventListener("click", () => flip("h"));
  document.getElementById("flipV").addEventListener("click", () => flip("v"));
  document.getElementById("resetCrop").addEventListener("click", resetCropBox);
  qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; });

  clearBtn.addEventListener("click", () => {
    currentFile = null;
    editor.style.display = "none";
    fileInput.value = "";
    clearStatus(statusEl);
  });

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function pointerFrac(e) {
    const rect = cropStage.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    return { x, y };
  }

  // Move the whole crop box
  let moveState = null;
  cropBox.addEventListener("pointerdown", (e) => {
    if (e.target.dataset.handle) return; // handled separately
    e.preventDefault();
    cropBox.setPointerCapture(e.pointerId);
    const p = pointerFrac(e);
    moveState = { startX: p.x, startY: p.y, boxX: box.x, boxY: box.y };
  });
  cropBox.addEventListener("pointermove", (e) => {
    if (!moveState) return;
    const p = pointerFrac(e);
    const dx = p.x - moveState.startX;
    const dy = p.y - moveState.startY;
    box.x = clamp(moveState.boxX + dx, 0, 1 - box.w);
    box.y = clamp(moveState.boxY + dy, 0, 1 - box.h);
    updateBoxDom();
  });
  cropBox.addEventListener("pointerup", () => { moveState = null; });
  cropBox.addEventListener("pointercancel", () => { moveState = null; });

  // Resize via corner handles
  let resizeState = null;
  cropBox.querySelectorAll(".crop-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      resizeState = { corner: handle.dataset.handle };
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resizeState) return;
      const p = pointerFrac(e);
      const corner = resizeState.corner;
      let { x, y, w, h } = box;
      const x0 = x, y0 = y, x1 = x + w, y1 = y + h;

      if (corner === "se") {
        const nx1 = clamp(p.x, x0 + MIN_FRAC, 1);
        const ny1 = clamp(p.y, y0 + MIN_FRAC, 1);
        box = { x: x0, y: y0, w: nx1 - x0, h: ny1 - y0 };
      } else if (corner === "nw") {
        const nx0 = clamp(p.x, 0, x1 - MIN_FRAC);
        const ny0 = clamp(p.y, 0, y1 - MIN_FRAC);
        box = { x: nx0, y: ny0, w: x1 - nx0, h: y1 - ny0 };
      } else if (corner === "ne") {
        const nx1 = clamp(p.x, x0 + MIN_FRAC, 1);
        const ny0 = clamp(p.y, 0, y1 - MIN_FRAC);
        box = { x: x0, y: ny0, w: nx1 - x0, h: y1 - ny0 };
      } else if (corner === "sw") {
        const nx0 = clamp(p.x, 0, x1 - MIN_FRAC);
        const ny1 = clamp(p.y, y0 + MIN_FRAC, 1);
        box = { x: nx0, y: y0, w: x1 - nx0, h: ny1 - y0 };
      }
      updateBoxDom();
    });
    handle.addEventListener("pointerup", () => { resizeState = null; });
    handle.addEventListener("pointercancel", () => { resizeState = null; });
  });

  runBtn.addEventListener("click", async () => {
    if (!currentFile) return;
    const sx = Math.round(box.x * canvas.width);
    const sy = Math.round(box.y * canvas.height);
    const sw = Math.max(1, Math.round(box.w * canvas.width));
    const sh = Math.max(1, Math.round(box.h * canvas.height));

    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const outCtx = out.getContext("2d");

    const targetType = formatSelect.value === "keep" ? (currentFile.type || "image/png") : formatSelect.value;
    if (targetType === "image/jpeg") {
      outCtx.fillStyle = "#ffffff";
      outCtx.fillRect(0, 0, sw, sh);
    }
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const quality = Number(qualityInput.value) / 100;
    const blob = await canvasToBlob(out, targetType, quality);
    const ext = extForMime(blob.type);
    const outName = `${stripExtension(currentFile.name)}-edited.${ext}`;
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "crop-rotate-image",
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
    setStatus(statusEl, `Downloaded ${outName} (${sw} × ${sh}px, ${formatBytes(blob.size)}).`, "success");
    statusEl.classList.add("visible");
  });
})();
