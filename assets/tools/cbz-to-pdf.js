import * as fflate from "/assets/vendor/fflate.min.js";
import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const pageSizeSelect = document.getElementById("pageSize");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;

let currentFile = null;
let pages = []; // { path, bytes, kind: "jpg"|"png", canvas (thumb), deleted }

// Numeric-aware filename comparison, so "page2.jpg" sorts before "page10.jpg".
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const ax = a.match(re) || [], bx = b.match(re) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const av = ax[i], bv = bx[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = Number(av), bn = Number(bv);
    if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function makeThumbCanvas(img, maxWidth = 200) {
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function loadArchive(file) {
  currentFile = file;
  setStatus(statusEl, "Reading archive…", "");
  statusEl.classList.add("visible");
  editor.style.display = "block";

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  const zipFiles = fflate.unzipSync(zipBytes, {
    filter: (entry) => !entry.name.startsWith("__MACOSX/") && !entry.name.split("/").pop().startsWith("."),
  });
  const paths = Object.keys(zipFiles).filter((p) => IMAGE_RE.test(p)).sort(naturalCompare);
  if (!paths.length) throw new Error("no images found in that archive");

  pages = [];
  for (let i = 0; i < paths.length; i++) {
    setStatus(statusEl, `Reading page ${i + 1} of ${paths.length}…`, "");
    const path = paths[i];
    const bytes = zipFiles[path];
    const ext = path.toLowerCase().match(IMAGE_RE)[1];
    const isJpg = ext === "jpg" || ext === "jpeg";
    const isPng = ext === "png";
    const blobType = isJpg ? "image/jpeg" : isPng ? "image/png" : `image/${ext}`;
    const url = URL.createObjectURL(new Blob([bytes], { type: blobType }));
    let img;
    try {
      img = await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    // Formats pdf-lib can't embed directly (gif/webp/bmp) get re-encoded to PNG
    // via canvas; jpg/png keep their original bytes untouched.
    const kind = isJpg ? "jpg" : "png";
    const embedBytes = isJpg || isPng ? bytes : new Uint8Array(await (await (await fetch(await canvasDataUrl(img))).blob()).arrayBuffer());
    pages.push({ path, bytes: embedBytes, kind, canvas: makeThumbCanvas(img), deleted: false });
  }
  renderGrid();
  clearStatus(statusEl);
}

async function canvasDataUrl(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return c.toDataURL("image/png");
}

function renderGrid() {
  pageGrid.innerHTML = "";
  pages.forEach((p, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "page-thumb" + (p.deleted ? " marked-delete" : "");
    thumb.draggable = true;
    thumb.dataset.idx = String(idx);

    const num = document.createElement("span");
    num.className = "page-num";
    num.textContent = String(idx + 1);
    thumb.appendChild(num);

    const wrap = document.createElement("div");
    wrap.className = "thumb-img-wrap";
    p.canvas.setAttribute("role", "img");
    p.canvas.setAttribute("aria-label", `Page ${idx + 1} preview${p.deleted ? " (marked for deletion)" : ""}`);
    wrap.appendChild(p.canvas);
    thumb.appendChild(wrap);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";
    const delBtn = document.createElement("button");
    delBtn.textContent = p.deleted ? "↺" : "✕";
    delBtn.title = p.deleted ? "Restore page" : "Drop page";
    delBtn.setAttribute("aria-label", p.deleted ? `Restore page ${idx + 1}` : `Drop page ${idx + 1}`);
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); p.deleted = !p.deleted; renderGrid(); });
    actions.appendChild(delBtn);
    thumb.appendChild(actions);

    thumb.addEventListener("dragstart", (e) => {
      thumb.classList.add("dragging");
      e.dataTransfer.setData("text/plain", String(idx));
      e.dataTransfer.effectAllowed = "move";
    });
    thumb.addEventListener("dragend", () => thumb.classList.remove("dragging"));
    thumb.addEventListener("dragover", (e) => e.preventDefault());
    thumb.addEventListener("drop", (e) => {
      e.preventDefault();
      const srcIdx = Number(e.dataTransfer.getData("text/plain"));
      if (Number.isNaN(srcIdx) || srcIdx === idx) return;
      const rect = thumb.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      const [moved] = pages.splice(srcIdx, 1);
      const targetIdx = idx > srcIdx ? idx - 1 : idx;
      pages.splice(before ? targetIdx : targetIdx + 1, 0, moved);
      renderGrid();
    });

    pageGrid.appendChild(thumb);
  });
}

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".cbz") || f.name.toLowerCase().endsWith(".zip"));
  if (!file) {
    setStatus(statusEl, "Please choose a .cbz file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  try {
    await loadArchive(file);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that archive: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  pages = [];
  editor.style.display = "none";
  pageGrid.innerHTML = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  const remaining = pages.filter((p) => !p.deleted);
  if (!remaining.length) {
    setStatus(statusEl, "Keep at least one page.", "error");
    statusEl.classList.add("visible");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, `Building PDF from ${remaining.length} page${remaining.length > 1 ? "s" : ""}…`, "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.create();
    const mode = pageSizeSelect.value;

    for (const p of remaining) {
      const image = p.kind === "jpg" ? await doc.embedJpg(p.bytes) : await doc.embedPng(p.bytes);
      const { width: imgW, height: imgH } = image;

      if (mode === "fit") {
        const pw = imgW * 0.75, ph = imgH * 0.75;
        const page = doc.addPage([pw, ph]);
        page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      } else {
        const [pw, ph] = PAGE_SIZES[mode];
        const page = doc.addPage([pw, ph]);
        const scale = Math.min(pw / imgW, ph / imgH);
        const drawW = imgW * scale, drawH = imgH * scale;
        page.drawImage(image, { x: (pw - drawW) / 2, y: (ph - drawH) / 2, width: drawW, height: drawH });
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}.pdf`);
    setStatus(statusEl, `Sorted — created a ${formatBytes(blob.size)} PDF with ${remaining.length} page${remaining.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
