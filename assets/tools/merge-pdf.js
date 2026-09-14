import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let files = [];

function renderFileList() {
  fileListEl.innerHTML = "";
  files.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name">${i + 1}. ${escapeHtml(f.name)}</span><span class="meta">${formatBytes(f.size)}</span>`;

    const upBtn = document.createElement("button");
    upBtn.className = "remove";
    upBtn.textContent = "↑";
    upBtn.setAttribute("aria-label", `Move ${f.name} up`);
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", () => {
      [files[i - 1], files[i]] = [files[i], files[i - 1]];
      renderFileList();
    });

    const downBtn = document.createElement("button");
    downBtn.className = "remove";
    downBtn.textContent = "↓";
    downBtn.setAttribute("aria-label", `Move ${f.name} down`);
    downBtn.disabled = i === files.length - 1;
    downBtn.addEventListener("click", () => {
      [files[i + 1], files[i]] = [files[i], files[i + 1]];
      renderFileList();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove ${f.name}`);
    removeBtn.addEventListener("click", () => {
      files.splice(i, 1);
      renderFileList();
    });

    li.appendChild(upBtn);
    li.appendChild(downBtn);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  });
  actionsRow.style.display = files.length >= 1 ? "flex" : "none";
  clearStatus(statusEl);
}

initDropzone(dropzone, fileInput, (newFiles) => {
  const pdfs = newFiles.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length !== newFiles.length) {
    setStatus(statusEl, "Some files were skipped because they weren't PDFs.", "error");
    statusEl.classList.add("visible");
  }
  files = files.concat(pdfs);
  renderFileList();
});

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
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const src = await PDFLib.PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const outBytes = await merged.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    triggerDownload(blob, "merged.pdf");
    setStatus(statusEl, `Sorted — merged ${files.length} PDFs into one file (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "could not merge these PDFs."}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
