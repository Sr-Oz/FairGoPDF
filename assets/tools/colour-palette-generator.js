(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const editor = document.getElementById("editor");
  const previewImg = document.getElementById("previewImg");
  const swatchesEl = document.getElementById("swatches");
  const colourCountInput = document.getElementById("colourCount");
  const colourCountVal = document.getElementById("colourCountVal");
  const copyAllBtn = document.getElementById("copyAllBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");

  let currentImg = null;
  let currentPalette = [];

  function toHex(rgb) {
    return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  // Simple k-means clustering over a downsampled pixel sample. Good enough
  // for "what are the dominant colours" without pulling in a library.
  function extractPalette(img, k) {
    const maxDim = 150;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // Nearest-neighbour scaling, not smoothed, so downsampling never invents
    // blended colours that aren't actually in the source image.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip near-transparent pixels
      pixels.push(data[i], data[i + 1], data[i + 2]);
    }
    const n = pixels.length / 3;
    if (n === 0) return [];
    const clusterCount = Math.min(k, n);

    // k-means++ seeding: each new centroid is chosen with probability
    // proportional to its squared distance from the nearest existing
    // centroid, so seeds start well-spread instead of clumping together
    // and merging distinct colours into one cluster.
    function sqDist(r, g, b, c) {
      const dr = r - c[0], dg = g - c[1], db = b - c[2];
      return dr * dr + dg * dg + db * db;
    }
    const centroids = [];
    const firstIdx = Math.floor(Math.random() * n);
    centroids.push([pixels[firstIdx * 3], pixels[firstIdx * 3 + 1], pixels[firstIdx * 3 + 2]]);
    const nearestDistSq = new Float64Array(n).fill(Infinity);
    while (centroids.length < clusterCount) {
      const latest = centroids[centroids.length - 1];
      let total = 0;
      for (let i = 0; i < n; i++) {
        const d = sqDist(pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], latest);
        if (d < nearestDistSq[i]) nearestDistSq[i] = d;
        total += nearestDistSq[i];
      }
      if (total === 0) {
        const idx = Math.floor(Math.random() * n);
        centroids.push([pixels[idx * 3], pixels[idx * 3 + 1], pixels[idx * 3 + 2]]);
        continue;
      }
      let r = Math.random() * total;
      let chosen = 0;
      for (let i = 0; i < n; i++) {
        r -= nearestDistSq[i];
        if (r <= 0) {
          chosen = i;
          break;
        }
      }
      centroids.push([pixels[chosen * 3], pixels[chosen * 3 + 1], pixels[chosen * 3 + 2]]);
    }

    const assignments = new Int32Array(n);
    const iterations = 8;
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < n; i++) {
        const r = pixels[i * 3];
        const g = pixels[i * 3 + 1];
        const b = pixels[i * 3 + 2];
        let best = 0;
        let bestDist = Infinity;
        for (let c = 0; c < clusterCount; c++) {
          const dr = r - centroids[c][0];
          const dg = g - centroids[c][1];
          const db = b - centroids[c][2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        }
        assignments[i] = best;
      }
      const sums = Array.from({ length: clusterCount }, () => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const c = assignments[i];
        sums[c][0] += pixels[i * 3];
        sums[c][1] += pixels[i * 3 + 1];
        sums[c][2] += pixels[i * 3 + 2];
        sums[c][3]++;
      }
      for (let c = 0; c < clusterCount; c++) {
        if (sums[c][3] > 0) {
          centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
        }
      }
    }

    const counts = new Array(clusterCount).fill(0);
    for (let i = 0; i < n; i++) counts[assignments[i]]++;

    return centroids
      .map((c, i) => ({ rgb: c.map(Math.round), count: counts[i] }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  function renderPalette() {
    if (!currentImg) return;
    currentPalette = extractPalette(currentImg, Number(colourCountInput.value));
    swatchesEl.innerHTML = "";
    currentPalette.forEach((swatch) => {
      const hex = toHex(swatch.rgb);
      const btn = document.createElement("button");
      btn.className = "swatch";
      btn.type = "button";
      btn.innerHTML = `<span class="chip" style="background:${hex};"></span><span class="code">${hex}</span>`;
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(hex);
          const codeEl = btn.querySelector(".code");
          const original = codeEl.textContent;
          codeEl.textContent = "Copied!";
          codeEl.classList.add("copied");
          setTimeout(() => {
            codeEl.textContent = original;
            codeEl.classList.remove("copied");
          }, 1200);
        } catch (e) {
          setStatus(statusEl, "Couldn't copy to clipboard, your browser may be blocking it.", "error");
          statusEl.classList.add("visible");
        }
      });
      swatchesEl.appendChild(btn);
    });
  }

  colourCountInput.addEventListener("input", () => {
    colourCountVal.textContent = colourCountInput.value;
    renderPalette();
  });

  initDropzone(dropzone, fileInput, async (files) => {
    const image = files.find((f) => f.type.startsWith("image/"));
    if (!image) return;
    try {
      const dataUrl = await readFileAsDataURL(image);
      const img = await loadImage(dataUrl);
      currentImg = img;
      previewImg.src = dataUrl;
      previewImg.alt = `Preview of ${image.name}`;
      renderPalette();
      editor.style.display = "block";
      clearStatus(statusEl);
    } catch (err) {
      setStatus(statusEl, "Could not load that image.", "error");
      statusEl.classList.add("visible");
    }
  });

  copyAllBtn.addEventListener("click", async () => {
    if (!currentPalette.length) return;
    const css = ":root {\n" + currentPalette.map((s, i) => `  --colour-${i + 1}: ${toHex(s.rgb)};`).join("\n") + "\n}";
    try {
      await navigator.clipboard.writeText(css);
      setStatus(statusEl, "Sorted — palette copied as CSS variables.", "success");
      statusEl.classList.add("visible");
    } catch (e) {
      setStatus(statusEl, "Couldn't copy to clipboard, your browser may be blocking it.", "error");
      statusEl.classList.add("visible");
    }
  });

  clearBtn.addEventListener("click", () => {
    currentImg = null;
    currentPalette = [];
    editor.style.display = "none";
    fileInput.value = "";
    clearStatus(statusEl);
  });
})();
