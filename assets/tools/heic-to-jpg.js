(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const controls = document.getElementById("controls");
  const actionsRow = document.getElementById("actionsRow");
  const qualityInput = document.getElementById("quality");
  const qualityVal = document.getElementById("qualityVal");
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
    const heics = newFiles.filter((f) => /\.(heic|heif)$/i.test(f.name));
    if (heics.length !== newFiles.length) {
      setStatus(statusEl, "Only HEIC and HEIF photos are supported for this tool.", "error");
      statusEl.classList.add("visible");
    }
    files = files.concat(heics);
    renderFileList();
  });

  qualityInput.addEventListener("input", () => { qualityVal.textContent = qualityInput.value; });

  clearBtn.addEventListener("click", () => {
    files = [];
    renderFileList();
    resultsEl.classList.remove("visible");
    resultItemsEl.innerHTML = "";
  });

  // heic2any (self-hosted, see /assets/vendor/heic2any.min.js) sometimes returns an
  // array if the HEIC container holds a burst, only the first frame is kept, this
  // tool is one JPG per photo, not a burst unpacker.
  async function convertFile(file, quality) {
    const result = await window.heic2any({ blob: file, toType: "image/jpeg", quality });
    return Array.isArray(result) ? result[0] : result;
  }

  runBtn.addEventListener("click", async () => {
    if (!files.length) return;
    runBtn.disabled = true;
    resultItemsEl.innerHTML = "";
    resultsEl.classList.add("visible");
    setStatus(statusEl, `Converting ${files.length} photo${files.length > 1 ? "s" : ""}…`, "");
    statusEl.classList.add("visible");

    const quality = Number(qualityInput.value) / 100;
    let successCount = 0;

    for (const file of files) {
      try {
        const blob = await convertFile(file, quality);
        successCount++;
        const outName = `${stripExtension(file.name)}.jpg`;
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

    setStatus(statusEl, `Sorted — ${successCount} of ${files.length} photo${files.length > 1 ? "s" : ""} converted.`, "success");
    runBtn.disabled = false;
  });
})();
