import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

// Each entry is { file, canvas, pages }: canvas (the first page) and pages arrive once pdf.js has read the file.
let files = [];
let dragFrom = -1;

function move(from, to) {
  const [item] = files.splice(from, 1);
  files.splice(to, 0, item);
  renderFileList();
}

async function loadPreview(entry) {
  let doc;
  try {
    doc = await loadPdfJsDoc(await entry.file.arrayBuffer());
    entry.pages = doc.numPages;
    entry.canvas = await renderPageThumbCanvas(doc, 1, 240);
  } catch (err) {
    entry.failed = true; // password protected or damaged: the card shows a plain icon and the merge reports the problem
  } finally {
    if (doc) doc.loadingTask.destroy();
  }
  if (files.includes(entry)) renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  files.forEach((entry, i) => {
    const f = entry.file;
    const li = document.createElement("li");
    li.draggable = true;
    const meta = [entry.pages ? `${entry.pages} page${entry.pages === 1 ? "" : "s"}` : "", formatBytes(f.size)].filter(Boolean).join(" · ");
    li.innerHTML = `
      <span class="card-num">${i + 1}</span>
      <div class="card-thumb"></div>
      <div class="card-body"><span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><span class="meta">${meta}</span></div>`;
    const thumb = li.querySelector(".card-thumb");
    if (entry.canvas) thumb.appendChild(entry.canvas);
    else thumb.innerHTML = entry.failed
      ? '<span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>'
      : '<span class="card-loading" aria-hidden="true"></span>';

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const button = (label, text, disabled, onClick) => {
      const b = document.createElement("button");
      b.className = "remove";
      b.textContent = text;
      b.setAttribute("aria-label", `${label} ${f.name}`);
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      actions.appendChild(b);
    };
    button("Move earlier:", "←", i === 0, () => move(i, i - 1));
    button("Move later:", "→", i === files.length - 1, () => move(i, i + 1));
    button("Remove", "✕", false, () => {
      files.splice(i, 1);
      renderFileList();
    });
    li.appendChild(actions);

    li.addEventListener("dragstart", (e) => {
      dragFrom = i;
      li.classList.add("dragging");
      e.dataTransfer.setData("text/plain", String(i)); // Firefox will not start a drag without data
      e.dataTransfer.effectAllowed = "move";
    });
    li.addEventListener("dragend", () => {
      dragFrom = -1;
      fileListEl.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-after"));
    });
    li.addEventListener("dragover", (e) => {
      if (dragFrom < 0) return; // a file from the desktop goes to the drop area, not onto a card
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      li.classList.toggle("drop-before", before);
      li.classList.toggle("drop-after", !before);
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
    li.addEventListener("drop", (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      let to = e.clientX - rect.left < rect.width / 2 ? i : i + 1;
      if (dragFrom < to) to--; // removing the dragged card shifts everything after it
      const from = dragFrom;
      dragFrom = -1;
      if (to !== from) move(from, to);
      else renderFileList();
    });

    fileListEl.appendChild(li);
  });
  actionsRow.style.display = files.length >= 1 ? "flex" : "none";
  clearStatus(statusEl);
}

function addFiles(newFiles) {
  const pdfs = newFiles.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length !== newFiles.length) {
    setStatus(statusEl, "Some files were skipped because they weren't PDFs.", "error");
    statusEl.classList.add("visible");
  }
  const entries = pdfs.map((file) => ({ file, canvas: null, pages: 0, failed: false }));
  files = files.concat(entries);
  renderFileList();
  // one at a time, so a big batch doesn't read every file into memory at once
  (async () => {
    for (const entry of entries) if (files.includes(entry)) await loadPreview(entry);
  })();
}

initDropzone(dropzone, fileInput, addFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "merge-pdf", dropzone, onFiles: addFiles });
}

clearBtn.addEventListener("click", () => {
  files = [];
  renderFileList();
});

runBtn.addEventListener("click", async () => {
  if (files.length < 1) return;
  if (files.length < 2) {
    setStatus(statusEl, "Add at least two PDFs to merge.", "error");
    statusEl.classList.add("visible");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, "Merging…", "");
  statusEl.classList.add("visible");

  try {
    const merged = await PDFLib.PDFDocument.create();
    for (const { file } of files) {
      const bytes = await file.arrayBuffer();
      const src = await PDFLib.PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const outBytes = await merged.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const outName = brandFilename("merge-pdf", "merged", "pdf");
    triggerDownload(blob, outName);
    setStatus(statusEl, `Sorted — merged ${files.length} PDFs into one file (${formatBytes(blob.size)}).`, "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "merge-pdf",
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
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "could not merge these PDFs."}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
