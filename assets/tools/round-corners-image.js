(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const editor = document.getElementById("editor");
  const canvas = document.getElementById("displayCanvas");
  const ctx = canvas.getContext("2d");
  const radiusField = document.getElementById("radiusField");
  const radiusInput = document.getElementById("radius");
  const radiusVal = document.getElementById("radiusVal");
  const shapeInputs = document.querySelectorAll('input[name="shape"]');
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");

  let currentFile = null;
  let currentImg = null;

  function currentShape() {
    return [...shapeInputs].find((r) => r.checked).value;
  }

  function roundedRectPath(c, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.arcTo(x + w, y, x + w, y + h, radius);
    c.arcTo(x + w, y + h, x, y + h, radius);
    c.arcTo(x, y + h, x, y, radius);
    c.arcTo(x, y, x + w, y, radius);
    c.closePath();
  }

  function render() {
    if (!currentImg) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    if (currentShape() === "circle") {
      const r = Math.min(w, h) / 2;
      ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    } else {
      roundedRectPath(ctx, 0, 0, w, h, Number(radiusInput.value));
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(currentImg, 0, 0);
    ctx.restore();
  }

  radiusInput.addEventListener("input", () => {
    radiusVal.textContent = radiusInput.value;
    render();
  });

  shapeInputs.forEach((r) => {
    r.addEventListener("change", () => {
      radiusField.style.display = currentShape() === "circle" ? "none" : "flex";
      render();
    });
  });

  async function handleFiles(files) {
    const image = files.find((f) => f.type.startsWith("image/"));
    if (!image) return;
    currentFile = image;
    try {
      const dataUrl = await readFileAsDataURL(image);
      const img = await loadImage(dataUrl);
      currentImg = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      radiusInput.value = Math.round(Math.min(img.naturalWidth, img.naturalHeight) * 0.08);
      radiusVal.textContent = radiusInput.value;
      render();
      editor.style.display = "block";
      clearStatus(statusEl);
    } catch (err) {
      setStatus(statusEl, "Could not load that image.", "error");
      statusEl.classList.add("visible");
    }
  }

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "round-corners-image", dropzone, onFiles: handleFiles });
}

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
    setStatus(statusEl, "Applying shape…", "");
    statusEl.classList.add("visible");

    try {
      const blob = await canvasToBlob(canvas, "image/png");
      const outName = brandFilename("round-corners-image", stripExtension(currentFile.name), "png");
      triggerDownload(blob, outName);
      if (window.KeepSorted) {
        KeepSorted.offer({
          currentTool: "round-corners-image",
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
      setStatus(statusEl, `Sorted — downloaded ${outName} (${formatBytes(blob.size)}).`, "success");
    } catch (err) {
      console.error(err);
      setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
    } finally {
      runBtn.disabled = false;
    }
  });
})();
