import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const addBlankBtn = document.getElementById("addBlankBtn");
const reverseBtn = document.getElementById("reverseBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;
let pages = []; // { origIndex, rotationDelta, deleted, canvas, isBlank }

function blankThumbCanvas() {
  const ref = pages.find((p) => !p.isBlank) || pages[0];
  const canvas = document.createElement("canvas");
  canvas.width = ref ? ref.canvas.width : 155;
  canvas.height = ref ? ref.canvas.height : 200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#cccccc";
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  return canvas;
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
    p.canvas.style.transform = `rotate(${p.rotationDelta}deg)`;
    p.canvas.setAttribute("role", "img");
    p.canvas.setAttribute("aria-label", `Page ${idx + 1} preview${p.deleted ? " (marked for deletion)" : ""}`);
    wrap.appendChild(p.canvas);
    thumb.appendChild(wrap);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";

    if (!p.isBlank) {
      const rotLeft = document.createElement("button");
      rotLeft.textContent = "⟲";
      rotLeft.title = "Rotate left";
      rotLeft.setAttribute("aria-label", `Rotate page ${idx + 1} left`);
      rotLeft.addEventListener("click", (e) => {
        e.stopPropagation();
        p.rotationDelta = (p.rotationDelta + 270) % 360;
        renderGrid();
      });

      const rotRight = document.createElement("button");
      rotRight.textContent = "⟳";
      rotRight.title = "Rotate right";
      rotRight.setAttribute("aria-label", `Rotate page ${idx + 1} right`);
      rotRight.addEventListener("click", (e) => {
        e.stopPropagation();
        p.rotationDelta = (p.rotationDelta + 90) % 360;
        renderGrid();
      });

      actions.appendChild(rotLeft);
      actions.appendChild(rotRight);
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = p.deleted ? "↺" : "✕";
    delBtn.title = p.deleted ? "Restore page" : "Delete page";
    delBtn.setAttribute("aria-label", p.deleted ? `Restore page ${idx + 1}` : `Delete page ${idx + 1}`);
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      p.deleted = !p.deleted;
      renderGrid();
    });

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
      let targetIdx = idx > srcIdx ? idx - 1 : idx;
      const insertIdx = before ? targetIdx : targetIdx + 1;
      pages.splice(insertIdx, 0, moved);
      renderGrid();
    });

    pageGrid.appendChild(thumb);
  });
}

async function loadFile(file) {
  currentFile = file;
  currentBytes = new Uint8Array(await file.arrayBuffer());
  setStatus(statusEl, "Rendering pages…", "");
  statusEl.classList.add("visible");
  editor.style.display = "block";

  const pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
  pages = [];
  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 200);
    pages.push({ origIndex: i - 1, rotationDelta: 0, deleted: false, canvas, isBlank: false });
  }
  renderGrid();
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

addBlankBtn.addEventListener("click", () => {
  if (!currentFile) return;
  pages.push({ origIndex: -1, rotationDelta: 0, deleted: false, canvas: blankThumbCanvas(), isBlank: true });
  renderGrid();
});

reverseBtn.addEventListener("click", () => {
  pages.reverse();
  renderGrid();
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pages = [];
  editor.style.display = "none";
  pageGrid.innerHTML = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

saveBtn.addEventListener("click", async () => {
  const remaining = pages.filter((p) => !p.deleted);
  if (!currentFile || remaining.length === 0) {
    setStatus(statusEl, "Nothing to save — add a PDF and keep at least one page.", "error");
    statusEl.classList.add("visible");
    return;
  }
  saveBtn.disabled = true;
  setStatus(statusEl, "Saving…", "");
  statusEl.classList.add("visible");

  try {
    const src = await PDFLib.PDFDocument.load(currentBytes.slice());
    const out = await PDFLib.PDFDocument.create();
    const blankSize = src.getPage(0).getSize();

    for (const p of remaining) {
      if (p.isBlank) {
        out.addPage([blankSize.width, blankSize.height]);
        continue;
      }
      const [copied] = await out.copyPages(src, [p.origIndex]);
      if (p.rotationDelta) {
        const current = copied.getRotation().angle;
        copied.setRotation(PDFLib.degrees((current + p.rotationDelta) % 360));
      }
      out.addPage(copied);
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-organized.pdf`);
    setStatus(statusEl, `Sorted — saved ${remaining.length} page(s) (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    saveBtn.disabled = false;
  }
});
