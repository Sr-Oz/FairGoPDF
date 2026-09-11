(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const editor = document.getElementById("editor");
  const canvas = document.getElementById("displayCanvas");
  const ctx = canvas.getContext("2d");
  const grayscaleInput = document.getElementById("grayscale");
  const sepiaInput = document.getElementById("sepia");
  const brightnessInput = document.getElementById("brightness");
  const contrastInput = document.getElementById("contrast");
  const saturateInput = document.getElementById("saturate");
  const grayscaleVal = document.getElementById("grayscaleVal");
  const sepiaVal = document.getElementById("sepiaVal");
  const brightnessVal = document.getElementById("brightnessVal");
  const contrastVal = document.getElementById("contrastVal");
  const saturateVal = document.getElementById("saturateVal");
  const resetBtn = document.getElementById("resetFilters");
  const formatSelect = document.getElementById("format");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");

  let currentFile = null;
  let currentImg = null;

  const sliders = [
    [grayscaleInput, grayscaleVal],
    [sepiaInput, sepiaVal],
    [brightnessInput, brightnessVal],
    [contrastInput, contrastVal],
    [saturateInput, saturateVal],
  ];

  function currentFilterString() {
    return [
      `grayscale(${grayscaleInput.value}%)`,
      `sepia(${sepiaInput.value}%)`,
      `brightness(${brightnessInput.value}%)`,
      `contrast(${contrastInput.value}%)`,
      `saturate(${saturateInput.value}%)`,
    ].join(" ");
  }

  function render() {
    if (!currentImg) return;
    ctx.save();
    ctx.filter = currentFilterString();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(currentImg, 0, 0);
    ctx.restore();
  }

  sliders.forEach(([input, out]) => {
    input.addEventListener("input", () => {
      out.textContent = input.value;
      render();
    });
  });

  resetBtn.addEventListener("click", () => {
    grayscaleInput.value = 0;
    sepiaInput.value = 0;
    brightnessInput.value = 100;
    contrastInput.value = 100;
    saturateInput.value = 100;
    sliders.forEach(([input, out]) => { out.textContent = input.value; });
    render();
  });

  initDropzone(dropzone, fileInput, async (files) => {
    const image = files.find((f) => f.type.startsWith("image/"));
    if (!image) return;
    currentFile = image;
    try {
      const dataUrl = await readFileAsDataURL(image);
      const img = await loadImage(dataUrl);
      currentImg = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      resetBtn.click();
      editor.style.display = "block";
      clearStatus(statusEl);
    } catch (err) {
      setStatus(statusEl, "Could not load that image.", "error");
      statusEl.classList.add("visible");
    }
  });

  clearBtn.addEventListener("click", () => {
    currentFile = null;
    currentImg = null;
    editor.style.display = "none";
    fileInput.value = "";
    clearStatus(statusEl);
  });

  runBtn.addEventListener("click", async () => {
    if (!currentFile || !currentImg) return;
    runBtn.disabled = true;
    setStatus(statusEl, "Applying filters…", "");
    statusEl.classList.add("visible");

    try {
      const out = document.createElement("canvas");
      out.width = currentImg.naturalWidth;
      out.height = currentImg.naturalHeight;
      const outCtx = out.getContext("2d");

      const targetType = formatSelect.value === "keep" ? (currentFile.type || "image/png") : formatSelect.value;
      if (targetType === "image/jpeg") {
        outCtx.fillStyle = "#ffffff";
        outCtx.fillRect(0, 0, out.width, out.height);
      }
      outCtx.filter = currentFilterString();
      outCtx.drawImage(currentImg, 0, 0);

      const blob = await canvasToBlob(out, targetType, 0.92);
      const ext = extForMime(blob.type);
      const outName = `${stripExtension(currentFile.name)}-filtered.${ext}`;
      triggerDownload(blob, outName);
      setStatus(statusEl, `Sorted — downloaded ${outName} (${formatBytes(blob.size)}).`, "success");
    } catch (err) {
      console.error(err);
      setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
    } finally {
      runBtn.disabled = false;
    }
  });
})();
