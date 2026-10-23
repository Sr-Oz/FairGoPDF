// Shared helpers used by every tool page. Loaded as a plain <script> (not a module)
// so it can be reused with simple <script src> includes across tool pages.

// File names come from the user's own file system and can contain HTML-significant
// characters; anything interpolated into innerHTML must go through this first.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = "status-box visible" + (type ? ` ${type}` : "");
}

function clearStatus(el) {
  el.textContent = "";
  el.className = "status-box";
}

// Wires a dropzone element + hidden file input to accept clicks, drag/drop, and paste.
// onFiles receives a FileList-like array of File objects.
function initDropzone(dropzoneEl, inputEl, onFiles) {
  dropzoneEl.addEventListener("click", () => inputEl.click());

  dropzoneEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputEl.click();
    }
  });

  inputEl.addEventListener("change", () => {
    if (inputEl.files && inputEl.files.length) {
      onFiles(Array.from(inputEl.files));
      inputEl.value = "";
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneEl.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneEl.classList.remove("dragover");
    });
  });

  dropzoneEl.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(Array.from(files));
  });

  window.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.files;
    if (items && items.length) onFiles(Array.from(items));
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function stripExtension(filename) {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? filename : filename.slice(0, idx);
}

function extForMime(mime) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime] || "img";
}

// A small picture at the start of a file row, so images can be told apart by sight. Made once per file, one at a time, from a
// reduced copy, so a folder of big photos is never decoded at full size. A plain icon shows when the browser can't read the
// file (HEIC outside Safari, or a damaged image); no HEIC is decoded just for a preview.
const fileThumbs = new WeakMap(); // File -> promise of a data URL (null when it couldn't be made)
const fileThumbUrls = new WeakMap(); // File -> the data URL once it exists, so a redrawn row shows it straight away
let fileThumbQueue = Promise.resolve();

async function makeFileThumb(file) {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 160, resizeQuality: "medium" });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const scale = Math.max(96 / bitmap.width, 96 / bitmap.height); // fill the square, cropping the long side
    canvas.getContext("2d").drawImage(bitmap, (96 - bitmap.width * scale) / 2, (96 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
    return canvas.toDataURL("image/png"); // PNG keeps transparent logos transparent
  } catch (err) {
    return null;
  }
}

function addFileThumb(li, file) {
  const img = document.createElement("img");
  img.className = "thumb";
  img.alt = "";
  li.prepend(img);
  const show = (url) => {
    if (url) {
      img.src = url;
      return;
    }
    const icon = document.createElement("span");
    icon.className = "thumb thumb-none material-symbols-outlined";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "image";
    img.replaceWith(icon);
  };
  if (fileThumbUrls.has(file)) return show(fileThumbUrls.get(file));
  if (!fileThumbs.has(file)) {
    fileThumbs.set(file, (fileThumbQueue = fileThumbQueue.then(() => makeFileThumb(file))));
    fileThumbs.get(file).then((url) => fileThumbUrls.set(file, url));
  }
  fileThumbs.get(file).then(show);
}
