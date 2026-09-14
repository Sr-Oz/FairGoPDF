(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const controls = document.getElementById("controls");
  const actionsRow = document.getElementById("actionsRow");
  const pixelControls = document.getElementById("pixelControls");
  const percentControls = document.getElementById("percentControls");
  const widthInput = document.getElementById("width");
  const heightInput = document.getElementById("height");
  const lockAspect = document.getElementById("lockAspect");
  const percentInput = document.getElementById("percent");
  const percentVal = document.getElementById("percentVal");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const resultItemsEl = document.getElementById("resultItems");

  let files = [];
  let firstImageDims = null; // {w, h} of first added file, used for aspect lock defaults

  function renderFileList() {
    fileListEl.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="name">${escapeHtml(f.name)}</span><span class="meta">${formatBytes(f.size)}</span>`;
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "✕";
      btn.setAttribute("aria-label", `Remove ${f.name}`);
      btn.addEventListener("click", () => {
        files.splice(i, 1);
        renderFileList();
      });
      li.appendChild(btn);
      fileListEl.appendChild(li);
    });
    const hasFiles = files.length > 0;
    controls.style.display = hasFiles ? "block" : "none";
    actionsRow.style.display = hasFiles ? "flex" : "none";
    resultsEl.classList.remove("visible");
    clearStatus(statusEl);
  }

  initDropzone(dropzone, fileInput, async (newFiles) => {
    const images = newFiles.filter((f) => f.type.startsWith("image/"));
    files = files.concat(images);
    renderFileList();
    if (!firstImageDims && images.length) {
      try {
        const dataUrl = await readFileAsDataURL(images[0]);
        const img = await loadImage(dataUrl);
        firstImageDims = { w: img.naturalWidth, h: img.naturalHeight };
        widthInput.placeholder = String(img.naturalWidth);
        heightInput.placeholder = String(img.naturalHeight);
      } catch (e) { /* ignore */ }
    }
  });

  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="mode"]:checked').value;
      pixelControls.style.display = mode === "pixels" ? "flex" : "none";
      percentControls.style.display = mode === "percent" ? "flex" : "none";
    });
  });

  percentInput.addEventListener("input", () => { percentVal.textContent = percentInput.value; });

  widthInput.addEventListener("input", () => {
    if (lockAspect.checked && firstImageDims && widthInput.value) {
      const ratio = firstImageDims.h / firstImageDims.w;
      heightInput.value = Math.round(Number(widthInput.value) * ratio);
    }
  });
  heightInput.addEventListener("input", () => {
    if (lockAspect.checked && firstImageDims && heightInput.value) {
      const ratio = firstImageDims.w / firstImageDims.h;
      widthInput.value = Math.round(Number(heightInput.value) * ratio);
    }
  });

  clearBtn.addEventListener("click", () => {
    files = [];
    firstImageDims = null;
    renderFileList();
    resultsEl.classList.remove("visible");
    resultItemsEl.innerHTML = "";
  });

  async function resizeFile(file, mode) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    let targetW, targetH;

    if (mode === "percent") {
      const scale = Number(percentInput.value) / 100;
      targetW = Math.max(1, Math.round(img.naturalWidth * scale));
      targetH = Math.max(1, Math.round(img.naturalHeight * scale));
    } else {
      targetW = Math.max(1, Math.round(Number(widthInput.value) || img.naturalWidth));
      if (lockAspect.checked) {
        const ratio = img.naturalHeight / img.naturalWidth;
        targetH = Math.max(1, Math.round(targetW * ratio));
      } else {
        targetH = Math.max(1, Math.round(Number(heightInput.value) || img.naturalHeight));
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (file.type === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const blob = await canvasToBlob(canvas, file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/png", 0.92);
    return { blob, targetW, targetH };
  }

  runBtn.addEventListener("click", async () => {
    if (!files.length) return;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === "pixels" && !widthInput.value && !heightInput.value) {
      setStatus(statusEl, "Enter a target width or height.", "error");
      statusEl.classList.add("visible");
      return;
    }

    runBtn.disabled = true;
    resultItemsEl.innerHTML = "";
    resultsEl.classList.add("visible");
    setStatus(statusEl, `Resizing ${files.length} image${files.length > 1 ? "s" : ""}…`, "");
    statusEl.classList.add("visible");

    let successCount = 0;
    for (const file of files) {
      try {
        const { blob, targetW, targetH } = await resizeFile(file, mode);
        successCount++;
        const ext = extForMime(blob.type);
        const outName = `${stripExtension(file.name)}-${targetW}x${targetH}.${ext}`;
        const previewUrl = URL.createObjectURL(blob);

        const item = document.createElement("div");
        item.className = "result-item";
        item.innerHTML = `
          <img class="preview" src="${previewUrl}" alt="Resized preview of ${escapeHtml(file.name)}">
          <div class="info">
            <div>${outName}</div>
            <div class="meta" style="color:var(--text-muted);font-size:0.82rem;">${targetW} × ${targetH}px · ${formatBytes(blob.size)}</div>
          </div>
        `;
        const dlBtn = document.createElement("button");
        dlBtn.className = "btn small";
        dlBtn.textContent = "Download";
        dlBtn.addEventListener("click", () => triggerDownload(blob, outName));
        item.appendChild(dlBtn);
        resultItemsEl.appendChild(item);
      } catch (err) {
        console.error(err);
        const item = document.createElement("div");
        item.className = "result-item";
        item.innerHTML = `<div class="info">${escapeHtml(file.name)}: failed to process (${escapeHtml(err.message || "unknown error")})</div>`;
        resultItemsEl.appendChild(item);
      }
    }

    setStatus(statusEl, `Sorted — ${successCount} of ${files.length} image${files.length > 1 ? "s" : ""} resized.`, "success");
    runBtn.disabled = false;
  });
})();
