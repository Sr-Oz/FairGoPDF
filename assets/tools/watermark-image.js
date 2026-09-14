(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const controls = document.getElementById("controls");
  const actionsRow = document.getElementById("actionsRow");
  const textInput = document.getElementById("wmText");
  const sizeInput = document.getElementById("wmSize");
  const opacityInput = document.getElementById("wmOpacity");
  const opacityVal = document.getElementById("wmOpacityVal");
  const rotationInput = document.getElementById("wmRotation");
  const colorInput = document.getElementById("wmColor");
  const formatSelect = document.getElementById("format");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const resultItemsEl = document.getElementById("resultItems");

  let files = [];

  function renderFileList() {
    fileListEl.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="name">${escapeHtml(f.name)}</span><span class="meta">${formatBytes(f.size)}</span>`;
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.setAttribute("aria-label", `Remove ${f.name}`);
      btn.textContent = "✕";
      btn.addEventListener("click", () => {
        files.splice(i, 1);
        renderFileList();
      });
      li.appendChild(btn);
      fileListEl.appendChild(li);
    });
    const hasFiles = files.length > 0;
    controls.style.display = hasFiles ? "flex" : "none";
    actionsRow.style.display = hasFiles ? "flex" : "none";
    resultsEl.classList.remove("visible");
    clearStatus(statusEl);
  }

  initDropzone(dropzone, fileInput, (newFiles) => {
    const images = newFiles.filter((f) => f.type.startsWith("image/"));
    if (images.length !== newFiles.length) {
      setStatus(statusEl, "Some files were skipped because they weren't images.", "error");
    }
    files = files.concat(images);
    renderFileList();
  });

  opacityInput.addEventListener("input", () => { opacityVal.textContent = opacityInput.value; });

  clearBtn.addEventListener("click", () => {
    files = [];
    renderFileList();
    resultsEl.classList.remove("visible");
    resultItemsEl.innerHTML = "";
  });

  async function watermarkFile(file, text, size, opacity, rotationDeg, color, outputFormat) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");

    const targetType = outputFormat === "keep" ? (file.type || "image/png") : outputFormat;
    if (targetType === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px Arial, sans-serif`;
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(text).width;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.fillText(text, -textWidth / 2, 0);
    ctx.restore();

    return canvasToBlob(canvas, targetType, 0.92);
  }

  runBtn.addEventListener("click", async () => {
    if (!files.length) return;
    const text = textInput.value.trim();
    if (!text) {
      setStatus(statusEl, "Enter some watermark text first.", "error");
      statusEl.classList.add("visible");
      return;
    }

    runBtn.disabled = true;
    resultItemsEl.innerHTML = "";
    resultsEl.classList.add("visible");
    setStatus(statusEl, `Adding watermark to ${files.length} image${files.length > 1 ? "s" : ""}…`, "");
    statusEl.classList.add("visible");

    const size = Number(sizeInput.value) || 64;
    const opacity = Number(opacityInput.value) / 100;
    const rotationDeg = Number(rotationInput.value) || 0;
    const color = colorInput.value;
    const outputFormat = formatSelect.value;
    let successCount = 0;

    for (const file of files) {
      try {
        const blob = await watermarkFile(file, text, size, opacity, rotationDeg, color, outputFormat);
        successCount++;
        const ext = extForMime(blob.type);
        const outName = `${stripExtension(file.name)}-watermarked.${ext}`;
        const previewUrl = URL.createObjectURL(blob);

        const item = document.createElement("div");
        item.className = "result-item";
        item.innerHTML = `
          <img class="preview" src="${previewUrl}" alt="Watermarked preview of ${escapeHtml(file.name)}">
          <div class="info">
            <div>${outName}</div>
            <div class="meta" style="color:var(--text-muted);font-size:0.82rem;">${formatBytes(blob.size)}</div>
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

    setStatus(statusEl, `Sorted — ${successCount} of ${files.length} image${files.length > 1 ? "s" : ""} watermarked.`, "success");
    runBtn.disabled = false;
  });
})();
