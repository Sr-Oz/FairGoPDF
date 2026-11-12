// Word to PDF page. The conversion is in docx-to-pdf-engine.js; this file is the page around it.
import { docxToPdf, DocxError } from "/assets/tools/docx-to-pdf-engine.js";
import { safeBaseName } from "/assets/tools/page-tools.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const progressEl = $("progress");
const progressFill = $("progressFill");
const runBtn = $("runBtn");
const cancelBtn = $("cancelBtn");
const summaryEl = $("summary");

const BIG_FILE = 5 * 1024 * 1024; // a Word file this size usually means many pages or pictures

const state = { file: null, buffer: null, abort: null, result: null };

function show(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

function setProgress(fraction) { setProgressBar(progressEl, progressFill, fraction); }

function say(text) {
  summaryEl.textContent = text;
}

async function handleFiles(files) {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".docx"));
  if (!file) {
    const old = files.find((f) => f.name.toLowerCase().endsWith(".doc"));
    show(old ? "That's an older .doc file. Open it in Word, choose Save As, pick .docx, then add that file here." : "Please choose a .docx file.", "error");
    return;
  }
  state.file = file;
  state.buffer = await file.arrayBuffer();
  state.result = null;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none"; // an offer from an earlier file no longer matches
  document.querySelector(".related-tools-section").style.display = "";
  $("fileBar").textContent = `${file.name} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("pdfTitle").value = "";
  $("pdfTitle").placeholder = stripExtension(file.name);
  dropzone.classList.add("compact");
  runBtn.disabled = !!state.abort;
  say("Ready. Click Create PDF.");
  clearStatus(statusEl);
  if (file.size > BIG_FILE) show(`This is a large file (${formatBytes(file.size)}). Converting it can take a minute or more. You can cancel at any time.`);
}

initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "word-to-pdf", dropzone, onFiles: handleFiles });

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

function showResult(name, pageCount, size, adjusted, lost) {
  $("resultTotal").textContent = `${pageCount} page${pageCount === 1 ? "" : "s"}, ${formatBytes(size)}`;
  const box = $("noteLists");
  box.innerHTML = "";
  const sections = [list("Changed to fit", adjusted), list("Not carried over", lost)].filter(Boolean);
  if (!sections.length) {
    const p = document.createElement("p");
    p.className = "help-text";
    p.textContent = `${name} was converted with nothing left out that this tool could detect. Check the pages before sending it.`;
    box.appendChild(p);
  }
  for (const s of sections) box.appendChild(s);
  $("results").classList.add("visible");
}

runBtn.addEventListener("click", async () => {
  if (!state.buffer || state.abort) return;
  runBtn.disabled = true;
  state.abort = new AbortController();
  cancelBtn.hidden = false;
  cancelBtn.disabled = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  setProgress(0);
  show("Reading the document…");
  say("Working…");
  const file = state.file;

  try {
    const { bytes, pageCount, adjusted, lost } = await docxToPdf(state.buffer.slice(0), {
      fileName: file.name,
      signal: state.abort.signal,
      pageSize: $("pageSize").value,
      title: $("pdfTitle").value,
      author: $("pdfAuthor").value,
      onProgress: ({ message, done, total }) => {
        show(message);
        setProgress(total ? done / total : null);
      },
    });
    if (file !== state.file) return; // another file was added while this one was converting
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("word-to-pdf", safeBaseName(stripExtension(file.name), "document"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    showResult(file.name, pageCount, blob.size, adjusted, lost);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "word-to-pdf",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    show(`Sorted, a ${pageCount}-page PDF (${formatBytes(blob.size)}) is ready.`, "success");
    say(`${pageCount} page${pageCount === 1 ? "" : "s"}, ${formatBytes(blob.size)}.`);
  } catch (err) {
    if (err.name === "AbortError") {
      show("Cancelled. Nothing was changed.");
      say("Cancelled.");
      return;
    }
    console.error(err);
    show(err instanceof DocxError ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
    say("Could not convert this file.");
  } finally {
    setProgress(null);
    runBtn.disabled = !state.buffer;
    cancelBtn.hidden = true;
    state.abort = null;
  }
});

cancelBtn.addEventListener("click", () => {
  if (!state.abort) return; // the conversion had already finished
  cancelBtn.disabled = true;
  show("Cancelling…");
  state.abort.abort();
});

$("downloadBtn").addEventListener("click", () => {
  if (state.result) triggerDownload(state.result.blob, state.result.outName);
});
