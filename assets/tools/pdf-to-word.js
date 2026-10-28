// PDF to Word page. Reading the PDF is pdf-extract.js, working out paragraphs, headings and lists is pdf-layout.js, and writing
// the .docx is docx-writer.js; this file is the page around them. Everything happens in the browser.
import { loadPdfJsDoc } from "/assets/tools/pdf-common.js";
import { extractPages } from "/assets/tools/pdf-extract.js";
import { buildDocument } from "/assets/tools/pdf-layout.js";
import { buildDocx } from "/assets/tools/docx-writer.js";
import { parsePageSpec, safeBaseName } from "/assets/tools/page-tools.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const runBtn = $("runBtn");

const state = { file: null, doc: null, count: 0, blob: null, name: "", stop: false };

// ---------------------------------------------------------------- the settings

const checked = (id) => $(id).checked;
const options = () => ({
  pageBreaks: $("pageMode").value === "keep", usePdfPage: checked("usePdfPage"), columns: checked("columns"), dropRunning: checked("dropRunning"),
  joinHyphens: checked("joinHyphens"), styling: checked("styling"), lists: checked("lists"), links: checked("links"), images: checked("images"),
});

// -> { pages } or { error }; an empty box means every page
function chosenPages() {
  const r = parsePageSpec($("pageRange").value, state.count);
  return r.error ? { error: r.error } : { pages: r.pages || [] };
}

function refresh() {
  const note = $("rangeNote");
  const r = state.count ? parsePageSpec($("pageRange").value, state.count) : {};
  note.textContent = r.error || (r.pages && $("pageRange").value.trim() ? `${r.pages.length} of ${state.count} pages` : "");
  note.classList.toggle("is-error", !!r.error);
  $("pageRange").setAttribute("aria-invalid", String(!!r.error));
  const ok = state.count > 0 && !r.error;
  runBtn.disabled = !ok || !!state.busy;
  $("clearBtn").disabled = !state.file || !!state.busy;
  const summary = $("summary");
  summary.classList.toggle("is-error", !!r.error);
  summary.textContent = !state.count ? "Add a PDF to begin." : r.error ? r.error : `${r.pages ? r.pages.length : state.count} page${(r.pages ? r.pages.length : state.count) === 1 ? "" : "s"} will be converted.`;
}

$("pageRange").addEventListener("input", refresh);
// a changed setting makes the preview out of date, so it is dimmed until the document is made again
for (const el of document.querySelectorAll(".side-settings input, .side-settings select")) {
  el.addEventListener("change", () => { const shown = $("results").classList.contains("visible"); $("results").classList.toggle("is-stale", shown); $("staleNote").hidden = !shown; });
}

// ---------------------------------------------------------------- opening a PDF

function resetOutput() {
  state.blob = null;
  $("results").classList.remove("visible", "is-stale");
  $("staleNote").hidden = true;
  $("noText").hidden = true;
  $("preview").innerHTML = "";
}

async function loadFile(file) {
  setStatus(statusEl, "Reading the PDF…", "");
  if (state.doc) state.doc.destroy();
  const doc = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  Object.assign(state, { file, doc, count: doc.numPages });
  resetOutput();
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("outName").value = safeBaseName(stripExtension(file.name), "document");
  $("pageRange").value = "";
  dropzone.classList.add("compact");
  clearStatus(statusEl);
  refresh();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setStatus(statusEl, "Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}. If it needs a password, remove it with Unlock PDF first.`, "error");
  }
}

initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "pdf-to-word", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  if (state.doc) state.doc.destroy();
  Object.assign(state, { file: null, doc: null, count: 0 });
  resetOutput();
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  refresh();
});

// ---------------------------------------------------------------- making the document

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(stats, extra) {
  const bits = [
    [stats.paragraphs, "paragraph"], [stats.headings, "heading"], [stats.listItems, "list item"], [stats.images, "picture"], [stats.links, "link"],
  ].filter(([n]) => n > 0).map(([n, w]) => plural(n, w));
  const notes = [`Found ${bits.length ? bits.join(", ") : "no text"}.`];
  if (stats.removed) notes.push(`Left out ${plural(stats.removed, "header, footer or page number line")}.`);
  notes.push(...extra);
  return notes;
}

// the pages are drawn at their real width, so on a narrow screen they are shrunk to fit rather than scrolled sideways
function fitPreview() {
  const host = $("preview");
  const page = host.querySelector("section.docx");
  if (!page) return;
  host.style.setProperty("--fit", "1");
  const natural = page.offsetWidth + 24;
  host.style.setProperty("--fit", String(Math.min(1, host.clientWidth / natural)));
}
window.addEventListener("resize", fitPreview);

async function showPreview(blob) {
  const host = $("preview");
  host.innerHTML = "";
  if (!window.docx) return;
  try {
    await window.docx.renderAsync(blob, host, null, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true, ignoreFonts: true });
  } catch (err) {
    console.error(err);
    host.textContent = "The preview could not be drawn, but the Word document is ready to download.";
  }
  fitPreview();
}

runBtn.addEventListener("click", async () => {
  const chosen = chosenPages();
  if (!state.doc || chosen.error) return;
  state.busy = true;
  state.stop = false;
  runBtn.disabled = true;
  $("stopBtn").hidden = false;
  resetOutput();
  const opts = options();
  try {
    const numbers = chosen.pages.length ? chosen.pages : Array.from({ length: state.count }, (_, i) => i + 1);
    const { pages, images, title, author } = await extractPages(state.doc, numbers, {
      images: opts.images, links: opts.links,
      onProgress: (i, total) => setStatus(statusEl, `Reading page ${i} of ${total}…`, ""),
      isCancelled: () => state.stop,
    });
    if (state.stop) { setStatus(statusEl, "Stopped.", ""); return; }

    const chars = pages.reduce((n, p) => n + p.items.reduce((m, i) => m + i.str.trim().length, 0) + p.rotated.length, 0);
    const blank = pages.filter((p) => !p.items.length && !p.rotated).length;
    if (chars < 20) {
      clearStatus(statusEl);
      $("noText").hidden = false;
      if (window.matchMedia("(max-width: 899px)").matches) $("noText").scrollIntoView({ block: "start" });
      return;
    }

    setStatus(statusEl, "Building the Word document…", "");
    const model = buildDocument(pages, opts);
    const language = $("language").value;
    const bytes = buildDocx(model, { images, title: title || stripExtension(state.file.name), author, language });
    state.blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    state.name = brandFilename("pdf-to-word", safeBaseName($("outName").value, "document"), "docx");

    const extra = [];
    if (blank) extra.push(`${plural(blank, "page")} had no text${opts.images ? " (any pictures on them are included)" : ""}.`);
    $("wordNotes").innerHTML = describe(model.stats, extra).map((n) => `<li>${escapeHtml(n)}</li>`).join("");
    $("resultTotal").textContent = `${formatBytes(state.blob.size)}, ${plural(model.stats.pages, "PDF page")}`;
    $("results").classList.add("visible");
    setStatus(statusEl, "Sorted, your Word document is ready. Check the preview, then download it.", "success");
    await showPreview(state.blob);
    if (window.matchMedia("(max-width: 899px)").matches) $("results").scrollIntoView({ block: "start" }); // on a phone the result is below the settings
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    state.busy = false;
    $("stopBtn").hidden = true;
    refresh();
  }
});

$("stopBtn").addEventListener("click", () => { state.stop = true; });
$("downloadBtn").addEventListener("click", () => { if (state.blob) triggerDownload(state.blob, state.name); });

// a scan has no text, so the way forward is OCR PDF, which takes this very file
$("ocrBtn").addEventListener("click", async () => {
  if (!window.KeepSorted || !state.file) { window.location.href = "/ocr-pdf/"; return; }
  await KeepSorted.stashFile(state.file, state.file.name, "pdf", "pdf-to-word");
  window.location.href = "/ocr-pdf/";
});

refresh();
