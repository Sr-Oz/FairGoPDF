(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const controls = document.getElementById("controls");
  const actionsRow = document.getElementById("actionsRow");
  const qualityInput = document.getElementById("quality");
  const qualityVal = document.getElementById("qualityVal");
  const formatSelect = document.getElementById("format");
  const pngNote = document.getElementById("pngNote");
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
    pngNote.style.display = hasFiles && files.some((f) => f.type === "image/png") && formatSelect.value !== "image/jpeg" && formatSelect.value !== "image/webp" ? "block" : "none";
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

  qualityInput.addEventListener("input", () => {
    qualityVal.textContent = qualityInput.value;
  });

  formatSelect.addEventListener("change", renderFileList);

  clearBtn.addEventListener("click", () => {
    files = [];
    renderFileList();
    resultsEl.classList.remove("visible");
    resultItemsEl.innerHTML = "";
  });

  async function compressFile(file, quality, outputFormat) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");

    const targetType = outputFormat === "keep" ? file.type : outputFormat;

    if (targetType === "image/jpeg") {
      // JPEG has no alpha channel — flatten onto white first.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);

    const blob = await canvasToBlob(canvas, targetType, quality);
    return blob;
  }

  runBtn.addEventListener("click", async () => {
    if (!files.length) return;
    runBtn.disabled = true;
    resultItemsEl.innerHTML = "";
    resultsEl.classList.add("visible");
    setStatus(statusEl, `Compressing ${files.length} image${files.length > 1 ? "s" : ""}…`, "");
    statusEl.classList.add("visible");

    const quality = Number(qualityInput.value) / 100;
    const outputFormat = formatSelect.value;

    let successCount = 0;

    for (const file of files) {
      try {
        const blob = await compressFile(file, quality, outputFormat);
        successCount++;
        const savings = file.size > 0 ? Math.round((1 - blob.size / file.size) * 100) : 0;
        const ext = extForMime(blob.type);
        const outName = `${stripExtension(file.name)}-compressed.${ext}`;

        const item = document.createElement("div");
        item.className = "result-item";
        const previewUrl = URL.createObjectURL(blob);
        item.innerHTML = `
          <img class="preview" src="${previewUrl}" alt="Compressed preview of ${escapeHtml(file.name)}">
          <div class="info">
            <div>${outName}</div>
            <div class="meta" style="color:var(--text-muted);font-size:0.82rem;">
              ${formatBytes(file.size)} → ${formatBytes(blob.size)}
              ${savings > 0 ? `<span class="savings">(&minus;${savings}%)</span>` : ""}
            </div>
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

    setStatus(statusEl, `Sorted — ${successCount} of ${files.length} image${files.length > 1 ? "s" : ""} compressed.`, "success");
    runBtn.disabled = false;
  });
})();
