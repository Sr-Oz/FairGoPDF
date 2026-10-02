(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const editor = document.getElementById("editor");
  const cropStage = document.getElementById("cropStage");
  const canvas = document.getElementById("displayCanvas");
  const cropBox = document.getElementById("cropBox");
  const dimsReadout = document.getElementById("dimsReadout");
  const presetSelect = document.getElementById("preset");
  const formatSelect = document.getElementById("format");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const ctx = canvas.getContext("2d");

  // ratio = target width / target height. exportW/exportH: fixed output pixel size, or null to use the native crop resolution.
  const PRESETS = {
    "free": { ratio: null, exportW: null, exportH: null },
    "ig-square": { ratio: 1 / 1, exportW: 1080, exportH: 1080 },
    "ig-portrait": { ratio: 4 / 5, exportW: 1080, exportH: 1350 },
    "ig-story": { ratio: 9 / 16, exportW: 1080, exportH: 1920 },
    "fb-cover": { ratio: 820 / 312, exportW: 820, exportH: 312 },
    "x-post": { ratio: 16 / 9, exportW: 1200, exportH: 675 },
    "yt-thumb": { ratio: 16 / 9, exportW: 1280, exportH: 720 },
    "li-banner": { ratio: 4 / 1, exportW: 1584, exportH: 396 },
  };

  let currentFile = null;
  let box = { x: 0, y: 0, w: 1, h: 1 }; // fractions of the canvas
  const MIN_FRAC = 0.03;

  function currentPreset() {
    return PRESETS[presetSelect.value] || PRESETS.free;
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function updateBoxDom() {
    cropBox.style.left = box.x * 100 + "%";
    cropBox.style.top = box.y * 100 + "%";
    cropBox.style.width = box.w * 100 + "%";
    cropBox.style.height = box.h * 100 + "%";
    const px = Math.round(box.w * canvas.width);
    const py = Math.round(box.h * canvas.height);
    const preset = currentPreset();
    const outNote = preset.exportW ? ` — downloads at ${preset.exportW} × ${preset.exportH}px` : "";
    dimsReadout.textContent = `Selection: ${px} × ${py}px (of ${canvas.width} × ${canvas.height}px)${outNote}`;
  }

  // Largest box matching `ratio` (target px width / height) that fits centered in the canvas.
  function centeredBoxForRatio(ratio) {
    if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
    const canvasRatio = canvas.width / canvas.height;
    let w, h;
    if (ratio > canvasRatio) {
      w = 1;
      h = (canvas.width / ratio) / canvas.height;
    } else {
      h = 1;
      w = (canvas.height * ratio) / canvas.width;
    }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  function resetCropBox() {
    box = centeredBoxForRatio(currentPreset().ratio);
    updateBoxDom();
  }

  function loadImageToCanvas(img) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
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
  KeepSorted.init({ currentTool: "social-media-cropper", dropzone, onFiles: handleFiles });
}

  presetSelect.addEventListener("change", resetCropBox);

  clearBtn.addEventListener("click", () => {
    currentFile = null;
    editor.style.display = "none";
    fileInput.value = "";
    clearStatus(statusEl);
  });

  function pointerFrac(e) {
    const rect = cropStage.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    return { x, y };
  }

  // Move the whole crop box
  let moveState = null;
  cropBox.addEventListener("pointerdown", (e) => {
    if (e.target.dataset.handle) return;
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

  // Resize via corner handles — free (independent) or ratio-locked
  function resizeFree(corner, p) {
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
  }

  // pxRatio = target width / height in PIXELS. Box fractions must be converted
  // through the canvas's own pixel dimensions to match that ratio visually.
  function sizeAtRatio(rawW, pxRatio, growW, growH) {
    let w = Math.max(MIN_FRAC, rawW);
    let h = (w * canvas.width) / (pxRatio * canvas.height);
    if (h > growH) {
      h = growH;
      w = (h * pxRatio * canvas.height) / canvas.width;
    }
    if (w > growW) {
      w = growW;
      h = (w * canvas.width) / (pxRatio * canvas.height);
    }
    return { w, h };
  }

  function resizeLocked(corner, p, pxRatio) {
    const { x: x0, y: y0, w: w0, h: h0 } = box;
    const x1 = x0 + w0, y1 = y0 + h0;

    if (corner === "se") {
      const { w, h } = sizeAtRatio(p.x - x0, pxRatio, 1 - x0, 1 - y0);
      box = { x: x0, y: y0, w, h };
    } else if (corner === "nw") {
      const { w, h } = sizeAtRatio(x1 - p.x, pxRatio, x1, y1);
      box = { x: x1 - w, y: y1 - h, w, h };
    } else if (corner === "ne") {
      const { w, h } = sizeAtRatio(p.x - x0, pxRatio, 1 - x0, y1);
      box = { x: x0, y: y1 - h, w, h };
    } else if (corner === "sw") {
      const { w, h } = sizeAtRatio(x1 - p.x, pxRatio, x1, 1 - y0);
      box = { x: x1 - w, y: y0, w, h };
    }
  }

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
      const ratio = currentPreset().ratio;
      if (ratio) {
        resizeLocked(resizeState.corner, p, ratio);
      } else {
        resizeFree(resizeState.corner, p);
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

    const preset = currentPreset();
    const outW = preset.exportW || sw;
    const outH = preset.exportH || sh;

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const outCtx = out.getContext("2d");

    const targetType = formatSelect.value === "keep" ? (currentFile.type || "image/png") : formatSelect.value;
    if (targetType === "image/jpeg") {
      outCtx.fillStyle = "#ffffff";
      outCtx.fillRect(0, 0, outW, outH);
    }
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH);

    try {
      const blob = await canvasToBlob(out, targetType, 0.92);
      const ext = extForMime(blob.type);
      const outName = brandFilename("social-media-cropper", stripExtension(currentFile.name), ext);
      triggerDownload(blob, outName);
      if (window.KeepSorted) {
        KeepSorted.offer({
          currentTool: "social-media-cropper",
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
      setStatus(statusEl, `Sorted — downloaded ${outName} (${outW} × ${outH}px, ${formatBytes(blob.size)}).`, "success");
      statusEl.classList.add("visible");
    } catch (err) {
      console.error(err);
      setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
      statusEl.classList.add("visible");
    }
  });
})();
