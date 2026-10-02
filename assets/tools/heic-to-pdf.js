import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const controls = document.getElementById("controls");
const actionsRow = document.getElementById("actionsRow");
const pageSizeSelect = document.getElementById("pageSize");
const marginField = document.getElementById("marginField");
const marginInput = document.getElementById("margin");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

let files = [];

function renderFileList() {
  fileListEl.innerHTML = "";
  files.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name">${i + 1}. ${escapeHtml(f.name)}</span><span class="meta">${formatBytes(f.size)}</span>`;

    const upBtn = document.createElement("button");
    upBtn.className = "remove";
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; renderFileList(); });

    const downBtn = document.createElement("button");
    downBtn.className = "remove";
    downBtn.textContent = "↓";
    downBtn.disabled = i === files.length - 1;
    downBtn.addEventListener("click", () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; renderFileList(); });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => { files.splice(i, 1); renderFileList(); });

    li.appendChild(upBtn);
    li.appendChild(downBtn);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  });
  const hasFiles = files.length > 0;
  controls.style.display = hasFiles ? "flex" : "none";
  actionsRow.style.display = hasFiles ? "flex" : "none";
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

pageSizeSelect.addEventListener("change", () => {
  marginField.style.display = pageSizeSelect.value === "fit" ? "none" : "flex";
});
marginField.style.display = "none";

clearBtn.addEventListener("click", () => { files = []; renderFileList(); });

// heic2any (self-hosted, see /assets/vendor/heic2any.min.js) sometimes returns an
// array if the HEIC container holds a burst, only the first frame is kept, this
// tool is one photo per page, not a burst unpacker.
async function heicToJpegBytes(file) {
  const blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
  return new Uint8Array(await jpegBlob.arrayBuffer());
}

runBtn.addEventListener("click", async () => {
  if (!files.length) return;
  runBtn.disabled = true;
  setStatus(statusEl, `Converting ${files.length} photo${files.length > 1 ? "s" : ""}…`, "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.create();
    const mode = pageSizeSelect.value;
    const margin = Number(marginInput.value) || 0;

    for (const file of files) {
      const bytes = await heicToJpegBytes(file);
      const image = await doc.embedJpg(bytes);
      const { width: imgW, height: imgH } = image;

      if (mode === "fit") {
        // 96 CSS px per inch, 72pt per inch
        const pw = imgW * 0.75;
        const ph = imgH * 0.75;
        const page = doc.addPage([pw, ph]);
        page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      } else {
        const [pw, ph] = PAGE_SIZES[mode];
        const page = doc.addPage([pw, ph]);
        const availW = pw - margin * 2;
        const availH = ph - margin * 2;
        const scale = Math.min(availW / imgW, availH / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const x = (pw - drawW) / 2;
        const y = (ph - drawH) / 2;
        page.drawImage(image, { x, y, width: drawW, height: drawH });
      }
    }

    const outBytes = await doc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    triggerDownload(blob, "photos.pdf");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "heic-to-pdf",
        blob,
        filename: "photos.pdf",
        els: {
          section: document.getElementById("keepSorted"),
          list: document.getElementById("keepSortedList"),
          resetLink: document.getElementById("keepSortedReset"),
        },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Sorted — created a ${formatBytes(blob.size)} PDF with ${files.length} page${files.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
