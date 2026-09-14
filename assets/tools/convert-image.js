(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const controls = document.getElementById("controls");
  const actionsRow = document.getElementById("actionsRow");
  const formatSelect = document.getElementById("format");
  const qualityField = document.getElementById("qualityField");
  const qualityInput = document.getElementById("quality");
  const qualityVal = document.getElementById("qualityVal");
  const alphaNote = document.getElementById("alphaNote");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const resultItemsEl = document.getElementById("resultItems");

  let files = [];

  function updateFormatUI() {
    const isLossy = formatSelect.value === "image/jpeg" || formatSelect.value === "image/webp";
    qualityField.style.display = isLossy ? "flex" : "none";
    alphaNote.style.display = formatSelect.value === "image/jpeg" ? "block" : "none";
  }

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
    files = files.concat(images);
    renderFileList();
  });

  formatSelect.addEventListener("change", updateFormatUI);
  qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; });
  updateFormatUI();

  clearBtn.addEventListener("click", () => {
    files = [];
    renderFileList();
    resultsEl.classList.remove("visible");
    resultItemsEl.innerHTML = "";
  });

  async function convertFile(file, targetType, quality) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (targetType === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    return canvasToBlob(canvas, targetType, quality);
  }

  runBtn.addEventListener("click", async () => {
    if (!files.length) return;
    runBtn.disabled = true;
    resultItemsEl.innerHTML = "";
    resultsEl.classList.add("visible");
    setStatus(statusEl, `Converting ${files.length} image${files.length > 1 ? "s" : ""}…`, "");
    statusEl.classList.add("visible");

    const targetType = formatSelect.value;
    const quality = Number(qualityInput.value) / 100;
    let successCount = 0;

    for (const file of files) {
      try {
        const blob = await convertFile(file, targetType, quality);
        successCount++;
        const ext = extForMime(blob.type);
        const outName = `${stripExtension(file.name)}.${ext}`;
        const previewUrl = URL.createObjectURL(blob);

        const item = document.createElement("div");
        item.className = "result-item";
        item.innerHTML = `
          <img class="preview" src="${previewUrl}" alt="Converted preview of ${escapeHtml(file.name)}">
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

    setStatus(statusEl, `Sorted — ${successCount} of ${files.length} image${files.length > 1 ? "s" : ""} converted.`, "success");
    runBtn.disabled = false;
  });
})();
