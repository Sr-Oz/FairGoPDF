// Images to PDF page. The rules (page placement, shrinking, turning, naming) are in images-pdf-core.js; this file is the page around them.
import { PDFLib } from "/assets/tools/pdf-common.js";
import { renderFileCards } from "/assets/tools/file-cards.js";
import { sortEntries, jpegOrientation } from "/assets/tools/merge-core.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { pagePlacement, shrinkPlan, turned, rotatedSize, suggestName, describePlan, LEVELS } from "/assets/tools/images-pdf-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileListEl = $("fileList");
const statusEl = $("status");
const progressEl = $("progress");
const progressFill = $("progressFill");
const runBtn = $("runBtn");
const stopBtn = $("stopBtn");
const clearBtn = $("clearBtn");
const summaryEl = $("summary");

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);
const typeOf = (f) => f.type || { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" }[f.name.split(".").pop().toLowerCase()] || "";

// Each entry is { file, canvas, base, failed, turn }: the picture on its card arrives once the browser has read the image;
// base is that picture upright, canvas is what the card shows (base turned by `turn` degrees).
let files = [];
let run = null;
let result = null;
let nameTouched = false;

const LEVEL_HELP = {
  original: "Pictures go in exactly as they are, so the PDF is as sharp as they are, and as big.",
  balanced: `A picture wider than ${LEVELS.balanced.maxSide} pixels (A4 at 300 dpi) is reduced, and JPGs are saved again at 85% quality. Smaller ones are left alone. PNGs stay PNG, so this helps most with photos.`,
  small: `A picture wider than ${LEVELS.small.maxSide} pixels (A4 at 200 dpi) is reduced, and JPGs are saved again at 70% quality. Smaller ones are left alone. PNGs stay PNG.`,
};
const FIT_HELP = {
  inside: "The whole picture shows, with blank page around it if the shapes differ.",
  fill: "The picture covers the page area, and the edges that do not fit are cropped.",
};

function setProgress(fraction) { setProgressBar(progressEl, progressFill, fraction); }

function turnCanvas(base, deg) {
  if (!deg) return base;
  const { w, h } = rotatedSize(base.width, base.height, deg);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.translate(w / 2, h / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(base, -base.width / 2, -base.height / 2);
  return c;
}

// A small copy for the card, so a folder of 12-megapixel photos doesn't sit in memory at full size. Upright, as the page will show it.
async function loadPreview(entry) {
  try {
    const bitmap = await createImageBitmap(entry.file, { resizeWidth: 240, resizeQuality: "medium" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    entry.base = canvas;
    entry.canvas = turnCanvas(canvas, entry.turn);
  } catch (err) {
    entry.failed = true; // the browser couldn't read it; Create PDF will say so
  }
  if (files.includes(entry)) renderFileList();
}

function renderFileList() {
  renderFileCards(fileListEl, files, {
    detail: (e) => formatBytes(e.file.size) + (e.turn ? ` · turned ${e.turn}°` : ""),
    icon: "image",
    onChange: renderFileList,
    buttons: (e) => [
      { label: "Turn left:", text: "↺", onClick: () => turn(e, -1) },
      { label: "Turn right:", text: "↻", onClick: () => turn(e, 1) },
    ],
  });
  const has = files.length > 0;
  $("sortRow").hidden = files.length < 2;
  dropzone.classList.toggle("compact", has);
  clearBtn.disabled = !has;
  if (!nameTouched) $("prefix").value = suggestName(files.map((e) => e.file.name));
  updatePlan();
}

function turn(entry, direction) {
  entry.turn = turned(entry.turn, direction);
  if (entry.base) entry.canvas = turnCanvas(entry.base, entry.turn);
  renderFileList();
}

function addFiles(newFiles) {
  const images = newFiles.filter((f) => TYPES.has(typeOf(f)));
  if (images.length !== newFiles.length) {
    setStatus(statusEl, "Only JPG, PNG, WebP, GIF and BMP pictures work here. For iPhone HEIC photos, use HEIC to PDF.", "error");
    statusEl.classList.add("visible");
  } else {
    clearStatus(statusEl);
  }
  const entries = images.map((file) => ({ file, canvas: null, base: null, failed: false, turn: 0 }));
  files = files.concat(entries);
  result = null;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none"; // an offer from an earlier run no longer matches
  document.querySelector(".related-tools-section").style.display = "";
  renderFileList();
  // one at a time, so a big batch doesn't decode every photo at once
  (async () => {
    for (const entry of entries) if (files.includes(entry)) await loadPreview(entry);
  })();
}

initDropzone(dropzone, $("fileInput"), addFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "images-to-pdf", dropzone, onFiles: addFiles });

for (const b of document.querySelectorAll("[data-sort]")) {
  b.addEventListener("click", () => {
    files = sortEntries(files, b.dataset.sort);
    renderFileList();
  });
}

clearBtn.addEventListener("click", () => {
  files = [];
  result = null;
  nameTouched = false;
  $("results").classList.remove("visible");
  clearStatus(statusEl);
  renderFileList();
});

// ---------------------------------------------------------------- settings

function settings() {
  return {
    size: $("pageSize").value,
    orientation: $("orientation").value,
    fit: $("fit").value,
    marginMm: Number($("margin").value) || 0,
    paper: $("paper").value,
    level: $("level").value,
  };
}

function updatePlan() {
  const s = settings();
  $("block-page").hidden = s.size === "image";
  $("fitHelp").textContent = FIT_HELP[s.fit];
  $("levelHelp").textContent = LEVEL_HELP[s.level];
  runBtn.disabled = !files.length || !!run;
  summaryEl.textContent = files.length ? describePlan({ count: files.length, ...s }) : "Add pictures to begin.";
  summaryEl.classList.remove("is-error");
}

for (const id of ["pageSize", "orientation", "fit", "margin", "paper", "level"]) {
  $(id).addEventListener("change", updatePlan);
}
$("prefix").addEventListener("input", () => { nameTouched = true; });

// ---------------------------------------------------------------- building the PDF

class PictureProblem extends Error {}

const toBytes = async (canvas, type, quality) => {
  const blob = await canvasToBlob(canvas, type, quality);
  if (!blob) throw new Error("the browser could not save the picture");
  return new Uint8Array(await blob.arrayBuffer());
};

// One picture ready for the page: embedded as it is when nothing needs doing to it, otherwise drawn through a canvas first
// (to turn it upright or by hand, to shrink it, or because pdf-lib reads only JPG and PNG).
async function embedPicture(doc, entry, s, tally) {
  const { file } = entry;
  const type = typeOf(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bitmap;
  try {
    bitmap = await createImageBitmap(file); // upright: the camera's rotation is applied
  } catch (err) {
    throw new PictureProblem(`${file.name} couldn't be read as a picture.`);
  }
  try {
    const camera = type === "image/jpeg" && jpegOrientation(bytes) > 1;
    const plan = shrinkPlan(bitmap.width, bitmap.height, s.level);
    const direct = (type === "image/jpeg" || type === "image/png") && !camera && !entry.turn && !plan.shrink;
    if (direct) {
      const image = type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      return { image, w: image.width, h: image.height };
    }
    const { w, h } = rotatedSize(plan.width, plan.height, entry.turn);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: type !== "image/jpeg" });
    if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
    ctx.translate(w / 2, h / 2);
    ctx.rotate((entry.turn * Math.PI) / 180);
    ctx.drawImage(bitmap, -plan.width / 2, -plan.height / 2, plan.width, plan.height);
    if (camera) tally.upright++;
    if (plan.shrink) tally.shrunk++;
    let out;
    if (type === "image/jpeg") {
      out = await doc.embedJpg(await toBytes(canvas, "image/jpeg", plan.quality));
    } else {
      // a photo with no see-through parts is far smaller as a JPG than as a PNG, once the person has asked for smaller files
      const opaque = s.level !== "original" && type !== "image/gif" && type !== "image/png" && isOpaque(ctx, w, h);
      out = opaque ? await doc.embedJpg(await toBytes(canvas, "image/jpeg", plan.quality)) : await doc.embedPng(await toBytes(canvas, "image/png"));
    }
    return { image: out, w, h };
  } finally {
    bitmap.close();
  }
}

function isOpaque(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
  return true;
}

function list(title, items) {
  if (!items.length) return null;
  const box = document.createElement("div");
  const h = document.createElement("h3");
  h.className = "note-title";
  h.textContent = title;
  const ul = document.createElement("ul");
  ul.className = "note-list";
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text.charAt(0).toUpperCase() + text.slice(1) + ".";
    ul.appendChild(li);
  }
  box.append(h, ul);
  return box;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function showResult(pages, size, tally) {
  $("resultTotal").textContent = `${pages} page${pages === 1 ? "" : "s"}, ${formatBytes(size)}`;
  const box = $("noteLists");
  box.innerHTML = "";
  const changes = [];
  if (tally.upright) changes.push(`${plural(tally.upright, "photo was", "photos were")} turned upright using the rotation the camera saved`);
  if (tally.shrunk) changes.push(`${plural(tally.shrunk, "picture was", "pictures were")} reduced in size`);
  const sec = list("Changed on the way in", changes);
  if (sec) box.appendChild(sec);
  $("results").classList.add("visible");
}

runBtn.addEventListener("click", async () => {
  if (!files.length || run) return;
  if (files.some((e) => e.failed)) {
    setStatus(statusEl, "One of the pictures couldn't be read. Remove the card with the picture symbol and try again.", "error");
    statusEl.classList.add("visible");
    return;
  }
  const job = { stopped: false };
  run = job;
  runBtn.disabled = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  const s = settings();
  const list_ = [...files];
  const tally = { upright: 0, shrunk: 0 };
  setProgress(0);

  try {
    const doc = await PDFLib.PDFDocument.create();
    for (const [i, entry] of list_.entries()) {
      if (job.stopped) break;
      setStatus(statusEl, `Adding picture ${i + 1} of ${list_.length}…`, "");
      statusEl.classList.add("visible");
      setProgress(i / list_.length);
      await new Promise((r) => setTimeout(r)); // lets the screen and the Stop button catch up between pictures
      const { image, w, h } = await embedPicture(doc, entry, s, tally);
      const at = pagePlacement({ w, h, size: s.size, orientation: s.orientation, marginMm: s.marginMm, fit: s.fit });
      const page = doc.addPage([at.pw, at.ph]);
      if (s.paper === "black") page.drawRectangle({ x: 0, y: 0, width: at.pw, height: at.ph, color: PDFLib.rgb(0, 0, 0) });
      if (at.clip) page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(at.clip.x, at.clip.y, at.clip.width, at.clip.height), PDFLib.clip(), PDFLib.endPath());
      page.drawImage(image, { x: at.x, y: at.y, width: at.width, height: at.height });
      if (at.clip) page.pushOperators(PDFLib.popGraphicsState());
    }
    if (job.stopped) {
      setStatus(statusEl, "Stopped. No PDF was made.", "");
      return;
    }
    const title = $("pdfTitle").value.trim();
    const author = $("pdfAuthor").value.trim();
    if (title) doc.setTitle(title);
    if (author) doc.setAuthor(author);
    doc.setCreator("Fair Go PDF");
    doc.setProducer("Fair Go PDF");
    setStatus(statusEl, "Saving…", "");
    await new Promise((r) => setTimeout(r));
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("images-to-pdf", safeBaseName($("prefix").value, "images"), "pdf");
    result = { blob, outName };
    triggerDownload(blob, outName);
    showResult(list_.length, blob.size, tally);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "images-to-pdf",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Sorted, a ${list_.length}-page PDF (${formatBytes(blob.size)}) is ready.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err instanceof PictureProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    setProgress(null);
    stopBtn.hidden = true;
    if (run === job) run = null;
    updatePlan();
  }
});

stopBtn.addEventListener("click", () => {
  if (!run) return;
  run.stopped = true;
  stopBtn.disabled = true;
  setStatus(statusEl, "Stopping…", "");
});

$("downloadBtn").addEventListener("click", () => {
  if (result) triggerDownload(result.blob, result.outName);
});

// what the closed rows of the settings card say
if (window.FGPAcc) {
  const text = (id) => $(id).options[$(id).selectedIndex].text;
  FGPAcc.set("page", () => {
    const s = settings();
    const size = s.size === "image" ? "Fit to picture" : `${text("pageSize")}${s.fit === "fill" ? ", filled" : ""}`;
    return size + (s.marginMm ? `, ${s.marginMm} mm margin` : "") + (s.paper === "black" ? ", black" : "");
  });
  FGPAcc.set("pictures", () => ({ original: "As they are", balanced: "Balanced", small: "Small" }[$("level").value]));
  FGPAcc.set("pdf-details", () => $("prefix").value.trim() || "images");
}

updatePlan();
