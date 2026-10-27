// Compress Image page. The sizing and format rules live in image-compress-core.js; the encoding is the browser's own canvas.
// Everything happens on this device, nothing is uploaded.
import * as fflate from "/assets/vendor/fflate.min.js";
import { planSize, validateResize, isResized, outputType, targetBytes, uniqueName } from "/assets/tools/image-compress-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileListEl = $("fileList");
const runBtn = $("runBtn");
const clearBtn = $("clearBtn");
const zipBtn = $("zipBtn");
const statusEl = $("status");
const resultsEl = $("results");
const resultItemsEl = $("resultItems");
const settingsEl = $("ciSettings");

const MIN_SCALE = 0.25; // a size target stops shrinking the picture at a quarter of its planned size
const QUALITY_STEPS = 6; // halvings of the quality range, enough to land within about 1%
const savedPct = (before, after) => (before > 0 ? Math.min(99, Math.max(-999, Math.round((1 - after / before) * 100))) : 0); // 99 at most, so a tiny result never reads as "gone"

const state = { files: [], results: [], urls: [], method: "quality", canWebp: true };

// ---------------------------------------------------------------- settings

const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(v);
const number = (id) => { const n = parseFloat($(id).value); return Number.isFinite(n) ? n : NaN; };

function readSettings() {
  return {
    method: state.method,
    quality: Number($("quality").value) / 100,
    targetBytes: targetBytes(number("targetSize"), Number($("targetUnit").value)),
    format: $("format").value,
    convertBig: $("convertBig").checked,
    convertMB: number("convertMB"),
    bg: hexOk($("bgText").value) ? $("bgText").value : "#ffffff",
    keepSmaller: $("keepSmaller").checked,
    resize: {
      mode: $("resizeMode").value,
      maxW: number("maxW"), maxH: number("maxH"), percent: number("percent"),
      width: number("cropW"), height: number("cropH"),
    },
  };
}

function syncSettings() {
  const target = state.method === "target";
  $("methodQuality").setAttribute("aria-pressed", String(!target));
  $("methodTarget").setAttribute("aria-pressed", String(target));
  $("qualityBlock").hidden = target;
  $("targetBlock").hidden = !target;
  // a size target needs a format whose quality can be turned down
  $("pngOption").hidden = $("pngOption").disabled = target;
  if (target && $("format").value === "image/png") $("format").value = "keep";
  const format = $("format").value;
  $("convertBigField").hidden = target || format !== "keep";
  $("bgField").hidden = !(format === "keep" || format === "image/jpeg");
  const mode = $("resizeMode").value;
  $("fitBlock").hidden = mode !== "fit";
  $("percentBlock").hidden = mode !== "percent";
  $("cropBlock").hidden = mode !== "crop";
  $("percentVal").textContent = $("percent").value;
  $("qualityVal").textContent = $("quality").value;
}

$("methodQuality").addEventListener("click", () => { state.method = "quality"; syncSettings(); });
$("methodTarget").addEventListener("click", () => { state.method = "target"; syncSettings(); });
for (const id of ["format", "resizeMode", "quality", "percent"]) $(id).addEventListener("input", syncSettings);
for (const b of document.querySelectorAll("[data-quality]")) {
  b.addEventListener("click", () => { $("quality").value = b.dataset.quality; syncSettings(); markStale(); });
}
$("bgColour").addEventListener("input", () => { $("bgText").value = $("bgColour").value; });
$("bgText").addEventListener("input", () => {
  const ok = hexOk($("bgText").value);
  $("bgText").setAttribute("aria-invalid", String(!ok));
  if (ok) $("bgColour").value = $("bgText").value;
});

// results made with older settings are flagged rather than silently replaced
function markStale() {
  if (resultsEl.classList.contains("visible")) $("ciStale").hidden = false;
}
settingsEl.addEventListener("input", markStale);
settingsEl.addEventListener("change", markStale);

// Safari cannot save WebP: it hands back a PNG when asked, so check once rather than hand out surprise PNGs
(async () => {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/webp", 0.8));
  if (blob && blob.type === "image/webp") return;
  state.canWebp = false;
  $("webpOption").hidden = $("webpOption").disabled = true;
})();

// ---------------------------------------------------------------- files

function renderFileList() {
  fileListEl.innerHTML = "";
  state.files.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name">${escapeHtml(f.name)}</span><span class="meta">${formatBytes(f.size)}</span>`;
    addFileThumb(li, f);
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.setAttribute("aria-label", `Remove ${f.name}`);
    btn.textContent = "✕";
    btn.addEventListener("click", () => { state.files.splice(i, 1); renderFileList(); });
    li.appendChild(btn);
    fileListEl.appendChild(li);
  });
  const has = state.files.length > 0;
  runBtn.disabled = clearBtn.disabled = !has;
  dropzone.classList.toggle("compact", has);
  clearResults();
  clearStatus(statusEl);
}

function addFiles(newFiles) {
  const images = newFiles.filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type));
  state.files = state.files.concat(images);
  renderFileList();
  if (images.length !== newFiles.length) setStatus(statusEl, "Some files were skipped because they weren't JPEG, PNG or WebP images.", "error");
}

initDropzone(dropzone, $("fileInput"), addFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "compress-image", dropzone, onFiles: addFiles });

function clearResults() {
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
  state.results = [];
  resultItemsEl.innerHTML = "";
  resultsEl.classList.remove("visible");
  $("ciStale").hidden = true;
  zipBtn.hidden = true;
  $("ciTotal").textContent = "";
}

clearBtn.addEventListener("click", () => {
  state.files = [];
  renderFileList();
});

// ---------------------------------------------------------------- compressing

function drawn(bitmap, plan, scale, type, bg) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(plan.dw * scale));
  canvas.height = Math.max(1, Math.round(plan.dh * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  if (type === "image/jpeg") {
    // JPEG has no see-through, so flatten onto the chosen colour first
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encode(canvas, type, quality) {
  const blob = await canvasToBlob(canvas, type, quality);
  if (!blob) throw new Error("this browser could not save that format");
  return blob;
}

// The best quality that fits under `limit` bytes. If even the lowest quality does not fit, the picture is scaled down (file size
// follows the picture's area, so the next size is worked out from how far over it was) and tried again.
async function encodeToLimit(bitmap, plan, type, bg, limit) {
  let smallest = null;
  let scale = 1;
  for (;;) {
    const canvas = drawn(bitmap, plan, scale, type, bg);
    const top = await encode(canvas, type, 0.95);
    if (top.size <= limit) return { blob: top, scale, missed: false };
    const floor = await encode(canvas, type, 0.05);
    if (!smallest || floor.size < smallest.blob.size) smallest = { blob: floor, scale };
    if (floor.size <= limit) {
      let lo = 0.05;
      let hi = 0.95;
      let best = floor;
      for (let i = 0; i < QUALITY_STEPS; i++) {
        const mid = (lo + hi) / 2;
        const blob = await encode(canvas, type, mid);
        if (blob.size <= limit) { best = blob; lo = mid; } else { hi = mid; }
      }
      return { blob: best, scale, missed: false };
    }
    if (scale <= MIN_SCALE) return { ...smallest, missed: true };
    scale = Math.max(MIN_SCALE, scale * Math.min(0.85, Math.sqrt(limit / floor.size) * 0.97));
  }
}

async function compressFile(file, s) {
  const bitmap = await createImageBitmap(file); // the browser turns a sideways photo upright here
  try {
    const type = outputType(file.type, file.size, s, state.canWebp);
    const plan = planSize(bitmap.width, bitmap.height, s.resize);
    const resized = isResized(plan, bitmap.width, bitmap.height);
    const result = { file, ow: bitmap.width, oh: bitmap.height, note: "" };

    if (s.method === "target" && file.size <= s.targetBytes && !resized && s.format === "keep") {
      return { ...result, blob: file, type: file.type, w: bitmap.width, h: bitmap.height, kept: true, note: "Already under the size you asked for, so the original is kept." };
    }

    let blob;
    let scale = 1;
    let missed = false;
    if (s.method === "target") {
      ({ blob, scale, missed } = await encodeToLimit(bitmap, plan, type, s.bg, s.targetBytes));
    } else {
      blob = await encode(drawn(bitmap, plan, 1, type, s.bg), type, s.quality);
    }

    if (s.keepSmaller && blob.size >= file.size && !resized && type === file.type) {
      return { ...result, blob: file, type: file.type, w: bitmap.width, h: bitmap.height, kept: true, note: "Already about as small as it gets, so the original is kept." };
    }
    const notes = [];
    if (scale < 1) notes.push(`Scaled down to ${Math.round(scale * 100)}% of the planned size to fit.`);
    if (missed) notes.push(`Could not reach ${formatBytes(s.targetBytes)}, this is the closest it got.`);
    return { ...result, blob, type: blob.type, w: Math.max(1, Math.round(plan.dw * scale)), h: Math.max(1, Math.round(plan.dh * scale)), kept: false, note: notes.join(" ") };
  } finally {
    bitmap.close();
  }
}

const TYPE_NAMES = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

function resultCard(r) {
  const saved = savedPct(r.file.size, r.blob.size);
  const url = URL.createObjectURL(r.blob);
  state.urls.push(url);
  const item = document.createElement("div");
  item.className = "result-item ci-result";
  const sizeLine = r.kept
    ? `${formatBytes(r.file.size)}, unchanged`
    : `${formatBytes(r.file.size)} → ${formatBytes(r.blob.size)}${saved > 0 ? ` <span class="savings">(&minus;${saved}%)</span>` : saved < 0 ? ` <span class="ci-bigger">(+${-saved}%)</span>` : ""}`;
  const dims = r.ow === r.w && r.oh === r.h ? `${r.w} × ${r.h} px` : `${r.ow} × ${r.oh} → ${r.w} × ${r.h} px`;
  item.innerHTML = `
    <img class="preview" src="${url}" alt="Compressed preview of ${escapeHtml(r.file.name)}">
    <div class="info">
      <div class="ci-name">${escapeHtml(r.name)}</div>
      <div class="ci-line">${sizeLine}</div>
      <div class="ci-line ci-muted">${dims} · ${TYPE_NAMES[r.type] || r.type}</div>
      ${r.note ? `<div class="ci-note">${escapeHtml(r.note)}</div>` : ""}
    </div>`;
  const dl = document.createElement("button");
  dl.className = "btn small";
  dl.type = "button";
  dl.textContent = "Download";
  dl.addEventListener("click", () => triggerDownload(r.blob, r.name));
  item.appendChild(dl);
  return item;
}

function showTotals() {
  const before = state.results.reduce((n, r) => n + r.file.size, 0);
  const after = state.results.reduce((n, r) => n + r.blob.size, 0);
  const pct = savedPct(before, after);
  $("ciTotal").textContent = `${formatBytes(before)} → ${formatBytes(after)}${pct > 0 ? ` (−${pct}%)` : ""}`;
  zipBtn.hidden = state.results.length < 2;
}

runBtn.addEventListener("click", async () => {
  if (!state.files.length) return;
  const s = readSettings();
  const problem = s.method === "target" && !(s.targetBytes > 0) ? "Enter the largest size you want each image to be."
    : s.convertBig && !(s.convertMB > 0) ? "Enter a size in megabytes for the PNG conversion."
    : validateResize(s.resize);
  if (problem) { setStatus(statusEl, problem, "error"); return; }

  runBtn.disabled = true;
  clearResults();
  resultsEl.classList.add("visible");
  const taken = new Set();
  let failed = 0;
  for (const [i, file] of state.files.entries()) {
    setStatus(statusEl, `Compressing ${i + 1} of ${state.files.length}…`, "");
    await new Promise((resolve) => setTimeout(resolve)); // let the page repaint between large images
    try {
      const r = await compressFile(file, s);
      r.name = uniqueName(brandFilename("compress-image", stripExtension(file.name), extForMime(r.type)), taken);
      state.results.push(r);
      resultItemsEl.appendChild(resultCard(r));
    } catch (err) {
      console.error(err);
      failed++;
      const item = document.createElement("div");
      item.className = "result-item";
      item.innerHTML = `<div class="info">${escapeHtml(file.name)}: could not be processed (${escapeHtml(err.message || "unknown error")})</div>`;
      resultItemsEl.appendChild(item);
    }
  }
  const done = state.results.length;
  showTotals();
  setStatus(statusEl, failed ? `${done} of ${state.files.length} compressed, ${failed} could not be processed.` : `Sorted, ${done} of ${state.files.length} image${state.files.length > 1 ? "s" : ""} compressed.`, failed ? "error" : "success");
  runBtn.disabled = false;

  // only offered for a single file: with a batch there is no single "it" to carry on with
  if (window.KeepSorted && state.files.length === 1 && done === 1) {
    KeepSorted.offer({
      currentTool: "compress-image",
      blob: state.results[0].blob,
      filename: state.results[0].name,
      els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
      relatedSection: document.querySelector(".related-tools-section"),
    });
  }
});

zipBtn.addEventListener("click", async () => {
  zipBtn.disabled = true;
  try {
    const entries = {};
    for (const r of state.results) entries[r.name] = new Uint8Array(await r.blob.arrayBuffer());
    // the images are already compressed, so storing them is as small as deflating them and much quicker
    const zip = fflate.zipSync(entries, { level: 0 });
    triggerDownload(new Blob([zip], { type: "application/zip" }), brandFilename("compress-image", "images", "zip"));
  } finally {
    zipBtn.disabled = false;
  }
});

syncSettings();
