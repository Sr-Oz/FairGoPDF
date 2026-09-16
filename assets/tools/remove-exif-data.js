(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const actionsRow = document.getElementById("actionsRow");
  const runBtn = document.getElementById("runBtn");
  const clearBtn = document.getElementById("clearBtn");
  const resultItemsEl = document.getElementById("resultItems");
  const statusEl = document.getElementById("status");

  let queue = [];

  // Reads the EXIF/GPS tags out of a JPEG's APP1 segment. Returns null for
  // PNG/WebP or a JPEG with no EXIF, since neither carries this data the
  // same way.
  function parseExif(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) break;
      const segLength = view.getUint16(offset + 2, false);
      if (marker === 0xe1 && segLength >= 8) {
        const segStart = offset + 4;
        if (
          view.getUint32(segStart, false) === 0x45786966 &&
          view.getUint16(segStart + 4, false) === 0x0000
        ) {
          try {
            return parseTiff(view, segStart + 6);
          } catch (e) {
            return null;
          }
        }
      }
      offset += 2 + segLength;
    }
    return null;
  }

  function parseTiff(view, tiffStart) {
    const byteOrder = view.getUint16(tiffStart, false);
    if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
    const little = byteOrder === 0x4949;
    const get16 = (o) => view.getUint16(o, little);
    const get32 = (o) => view.getUint32(o, little);
    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

    function readValue(type, count, valueOffsetPos) {
      const size = (typeSizes[type] || 1) * count;
      const dataPos = size <= 4 ? valueOffsetPos : tiffStart + get32(valueOffsetPos);
      if (type === 2) {
        let str = "";
        for (let i = 0; i < count - 1; i++) {
          const c = view.getUint8(dataPos + i);
          if (c === 0) break;
          str += String.fromCharCode(c);
        }
        return str.trim();
      }
      if (type === 5 || type === 10) {
        const rationals = [];
        for (let i = 0; i < count; i++) {
          const num = type === 5 ? get32(dataPos + i * 8) : view.getInt32(dataPos + i * 8, little);
          const den = type === 5 ? get32(dataPos + i * 8 + 4) : view.getInt32(dataPos + i * 8 + 4, little);
          rationals.push(den === 0 ? 0 : num / den);
        }
        return count === 1 ? rationals[0] : rationals;
      }
      if (type === 3) return count === 1 ? get16(dataPos) : Array.from({ length: count }, (_, i) => get16(dataPos + i * 2));
      if (type === 4) return count === 1 ? get32(dataPos) : Array.from({ length: count }, (_, i) => get32(dataPos + i * 4));
      return get16(dataPos);
    }

    function readIFD(ifdOffset) {
      const entries = {};
      if (ifdOffset <= 0 || ifdOffset + 2 > view.byteLength) return entries;
      const numEntries = get16(ifdOffset);
      for (let i = 0; i < numEntries; i++) {
        const entryOffset = ifdOffset + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tag = get16(entryOffset);
        const type = get16(entryOffset + 2);
        const count = get32(entryOffset + 4);
        try {
          entries[tag] = readValue(type, count, entryOffset + 8);
        } catch (e) {
          // Skip malformed entries rather than aborting the whole read.
        }
      }
      return entries;
    }

    const firstIFDOffset = get32(tiffStart + 4);
    const ifd0 = readIFD(tiffStart + firstIFDOffset);
    const result = {};
    if (ifd0[0x010f]) result.make = ifd0[0x010f];
    if (ifd0[0x0110]) result.model = ifd0[0x0110];
    if (ifd0[0x0131]) result.software = ifd0[0x0131];
    if (ifd0[0x0132]) result.dateTime = ifd0[0x0132];

    if (ifd0[0x8769]) {
      const exifIFD = readIFD(tiffStart + ifd0[0x8769]);
      if (exifIFD[0x9003]) result.dateTimeOriginal = exifIFD[0x9003];
    }

    if (ifd0[0x8825]) {
      const gpsIFD = readIFD(tiffStart + ifd0[0x8825]);
      if (Array.isArray(gpsIFD[0x0002]) && Array.isArray(gpsIFD[0x0004])) {
        const [d1, m1, s1] = gpsIFD[0x0002];
        const [d2, m2, s2] = gpsIFD[0x0004];
        let lat = d1 + m1 / 60 + s1 / 3600;
        let lon = d2 + m2 / 60 + s2 / 3600;
        if (gpsIFD[0x0001] === "S") lat = -lat;
        if (gpsIFD[0x0003] === "W") lon = -lon;
        result.gps = { lat, lon };
        if (typeof gpsIFD[0x0006] === "number") result.gps.altitude = gpsIFD[0x0006];
      }
    }

    return Object.keys(result).length ? result : null;
  }

  function summarise(exif) {
    if (!exif) return "No EXIF metadata found.";
    const bits = [];
    if (exif.make || exif.model) bits.push(`Camera: ${[exif.make, exif.model].filter(Boolean).join(" ")}`);
    const date = exif.dateTimeOriginal || exif.dateTime;
    if (date) bits.push(`Taken: ${date}`);
    if (exif.gps) bits.push(`GPS: ${exif.gps.lat.toFixed(5)}, ${exif.gps.lon.toFixed(5)}`);
    if (exif.software) bits.push(`Software: ${exif.software}`);
    return bits.length ? bits.join(" · ") : "EXIF data found, no readable tags.";
  }

  function renderQueue() {
    fileListEl.innerHTML = "";
    queue.forEach((entry, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="name">${escapeHtml(entry.file.name)}</span><span class="meta">${formatBytes(entry.file.size)}</span>`;
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "✕";
      btn.setAttribute("aria-label", `Remove ${entry.file.name}`);
      btn.addEventListener("click", () => {
        queue.splice(i, 1);
        renderQueue();
      });
      li.appendChild(btn);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.style.cssText = "color:var(--text-muted);font-size:0.82rem;margin:-4px 0 8px;";
      meta.textContent = entry.exif === undefined ? "Scanning for metadata…" : summarise(entry.exif);
      fileListEl.appendChild(li);
      fileListEl.appendChild(meta);
    });
    actionsRow.style.display = queue.length ? "flex" : "none";
  }

  async function addFiles(files) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    for (const file of images) {
      const entry = { file, exif: undefined };
      queue.push(entry);
      renderQueue();
      try {
        const buffer = await file.arrayBuffer();
        entry.exif = parseExif(buffer);
      } catch (e) {
        entry.exif = null;
      }
      renderQueue();
    }
  }

  initDropzone(dropzone, fileInput, (files) => addFiles(files));

  clearBtn.addEventListener("click", () => {
    queue = [];
    renderQueue();
    resultItemsEl.innerHTML = "";
    fileInput.value = "";
    clearStatus(statusEl);
  });

  runBtn.addEventListener("click", async () => {
    if (!queue.length) return;
    runBtn.disabled = true;
    resultItemsEl.innerHTML = "";
    setStatus(statusEl, "Removing metadata…", "");
    statusEl.classList.add("visible");

    let successCount = 0;
    for (const entry of queue) {
      const file = entry.file;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const img = await loadImage(dataUrl);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const outType = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? file.type : "image/jpeg";
        const blob = await canvasToBlob(canvas, outType, outType === "image/jpeg" ? 0.95 : undefined);
        const ext = extForMime(outType);
        const outName = `${stripExtension(file.name)}-clean.${ext}`;
        successCount++;

        const item = document.createElement("div");
        item.className = "result-item";
        item.innerHTML = `<div class="info"><div>${escapeHtml(outName)}</div><div class="meta" style="color:var(--text-muted);font-size:0.82rem;">${formatBytes(blob.size)} · metadata removed</div></div>`;
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

    setStatus(statusEl, `Sorted — cleaned ${successCount} of ${queue.length} file${queue.length === 1 ? "" : "s"}.`, "success");
    runBtn.disabled = false;
  });
})();
