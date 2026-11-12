// Extract PDF Text page. Reading the positioned text out of the PDF is pdf-extract.js, working out paragraphs, headings, lists and
// tables is pdf-layout.js (the same code PDF to Word uses), and writing it as text or Markdown, laying it out by position, counting and
// searching is text-core.js; this file is the page around them. The PDF is read once, then every change of setting is instant.
import { loadPdfJsDoc } from "/assets/tools/pdf-common.js";
import { extractPages } from "/assets/tools/pdf-extract.js";
import { buildDocument } from "/assets/tools/pdf-layout.js";
import { parsePageSpec, safeBaseName } from "/assets/tools/page-tools.js";
import { blocksToText, layoutPage, countWords, findAll, stepMatch, emptyPages, describeEmpty } from "/assets/tools/text-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const out = $("out");

// pages: what was read from each page, by page number order; text: what is shown now
const state = { file: null, doc: null, count: 0, pages: [], text: "", ext: "txt", matches: [], at: -1, generation: 0, timer: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
}
function setProgress(f) { setProgressBar($("progress"), $("progressFill"), f); }

const MODE_HELP = {
  flow: "Joins lines into paragraphs, reads columns one at a time, and finds headings, lists and tables.",
  layout: "Keeps the text where it sits on the page, using spaces to line up columns, forms and tables. Best for statements and forms.",
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- making the text

// -> { pages } the page numbers to read, in the order asked, or { error }
function chosen() {
  const r = parsePageSpec($("pageRange").value, state.count);
  return r.error ? { error: r.error } : { pages: r.pages || [] };
}

function build() {
  const sel = chosen();
  const note = $("rangeNote");
  note.textContent = sel.error || ($("pageRange").value.trim() && sel.pages ? `${plural(sel.pages.length, "page", "pages")} of ${state.count}.` : "");
  note.classList.toggle("is-error", !!sel.error);
  if (sel.error || !state.pages.length) return null;
  const byNumber = new Map(state.pages.map((p) => [p.number, p]));
  const list = sel.pages.map((n) => byNumber.get(n)).filter(Boolean);
  const layout = $("mode").value === "layout";
  const markers = $("markers").checked;
  const format = layout ? "txt" : $("format").value;
  let text;
  if (layout) {
    text = list.map((p) => (markers ? `--- Page ${p.number} ---\n\n` : "") + layoutPage(p.items)).join(markers ? "\n\n" : "\n\n\n");
  } else {
    const doc = buildDocument(list, {
      pageBreaks: true, usePdfPage: false, styling: true, lists: true, images: false,
      columns: $("columns").checked, dropRunning: $("dropRunning").checked, joinHyphens: $("joinHyphens").checked, tables: $("tables").checked, links: format === "md" && $("links").checked,
    });
    text = blocksToText(doc.sections.flatMap((s) => s.blocks), { format, markers, pageNumbers: list.map((p) => p.number) });
  }
  return { text, ext: format, list };
}

function render() {
  const made = build();
  const has = !!state.file;
  $("downloadBtn").disabled = $("copyBtn").disabled = !made || !made.text.trim();
  $("clearBtn").disabled = !has;
  const sum = $("summary");
  sum.classList.remove("is-error");
  if (!made) {
    out.value = "";
    state.text = "";
    $("resultTotal").textContent = "";
    $("emptyBox").hidden = true;
    sum.textContent = !has ? "Add a PDF to begin." : chosen().error || "Reading the file…";
    if (has && chosen().error) sum.classList.add("is-error");
    updateFind();
    return;
  }
  state.text = made.text;
  state.ext = made.ext;
  out.value = made.text;
  const words = countWords(made.text);
  $("resultTotal").textContent = `${words.toLocaleString("en-AU")} word${words === 1 ? "" : "s"}, ${made.text.length.toLocaleString("en-AU")} characters`;
  $("downloadBtn").textContent = `Save .${made.ext}`;
  const empty = emptyPages(made.list);
  $("emptyText").textContent = describeEmpty(empty, made.list.length);
  $("emptyBox").hidden = !empty.length;
  sum.textContent = made.text.trim() ? `${words.toLocaleString("en-AU")} words from ${plural(made.list.length, "page", "pages")}.` : empty.length ? "There is no text to read here." : "No text came out.";
  updateFind();
}

// a burst of changes (typing a page range) makes the text once
function later() {
  clearTimeout(state.timer);
  state.timer = setTimeout(render, 120);
}

// ---------------------------------------------------------------- opening a PDF

async function loadFile(file) {
  const generation = ++state.generation;
  const cancelled = () => generation !== state.generation;
  setMsg("Reading your PDF…");
  setProgress(0);
  if (state.doc && state.doc.loadingTask) state.doc.loadingTask.destroy();
  const doc = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (cancelled()) { doc.loadingTask.destroy(); return; }
  Object.assign(state, { file, doc, count: doc.numPages, pages: [] });
  $("fileBar").textContent = `${file.name} · ${plural(doc.numPages, "page", "pages")} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "text");
  $("pageRange").value = "";
  dropzone.classList.add("compact");
  $("results").classList.add("visible");
  out.value = "";
  render();
  try {
    const numbers = Array.from({ length: doc.numPages }, (_, i) => i + 1);
    const read = await extractPages(doc, numbers, {
      images: false, links: true, tables: true, isCancelled: cancelled,
      onProgress: (i, total) => { setMsg(`Reading page ${i} of ${total}…`); setProgress(i / total); },
    });
    if (cancelled()) return;
    state.pages = read.pages;
  } finally {
    setProgress(null);
  }
  clearStatus(statusEl);
  render();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setMsg("Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setProgress(null);
    setMsg(err && err.name === "PasswordException" ? "This PDF is password protected. Remove the password with Unlock PDF first, then bring it back here." : `Could not read that PDF: ${String(err.message || "unknown error").replace(/[.\s]+$/, "")}.`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "extract-pdf-text", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  if (state.doc && state.doc.loadingTask) state.doc.loadingTask.destroy();
  Object.assign(state, { file: null, doc: null, count: 0, pages: [], text: "" });
  out.value = "";
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  $("emptyBox").hidden = true;
  dropzone.classList.remove("compact");
  setProgress(null);
  clearStatus(statusEl);
  render();
});

// ---------------------------------------------------------------- the settings

function refreshSettings() {
  const layout = $("mode").value === "layout";
  $("modeHelp").textContent = MODE_HELP[$("mode").value];
  $("formatField").hidden = layout;
  $("tidyGroup").hidden = layout;
  $("linksField").hidden = $("format").value !== "md";
  later();
}
for (const el of document.querySelectorAll(".side-settings input, .side-settings select")) {
  el.addEventListener("change", refreshSettings);
}
$("pageRange").addEventListener("input", later);
refreshSettings();

if (window.FGPAcc) {
  FGPAcc.set("mode", () => ($("mode").value === "layout" ? "As laid out" : $("format").value === "md" ? "Paragraphs, Markdown" : "Paragraphs"));
  FGPAcc.set("tidy", () => `${["columns", "dropRunning", "joinHyphens", "tables"].filter((id) => $(id).checked).length} of 4 on`);
  FGPAcc.set("pages", () => $("pageRange").value.trim() || "Every page");
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

// ---------------------------------------------------------------- searching the text

function updateFind() {
  const q = $("findInput").value;
  state.matches = findAll(out.value, q);
  state.at = -1;
  const n = state.matches.length;
  $("findCount").textContent = !q ? "" : n ? plural(n, "match", "matches") : "No matches";
  $("findPrev").disabled = $("findNext").disabled = !n;
}

function goTo(direction) {
  const n = state.matches.length;
  if (!n) return;
  // the first or last match to begin with, then on round the text
  const i = state.at < 0 ? stepMatch(state.matches, direction > 0 ? 0 : out.value.length, direction) : (state.at + direction + n) % n;
  state.at = i;
  const start = state.matches[i];
  const len = $("findInput").value.length;
  out.focus({ preventScroll: true });
  out.setSelectionRange(start, start + len);
  // bring the match into view: the lines above it, at the textarea's line height
  const style = getComputedStyle(out);
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const wrapChars = Math.max(20, Math.floor(out.clientWidth / (parseFloat(style.fontSize) * 0.6)));
  const before = out.value.slice(0, start).split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / wrapChars)), 0);
  out.scrollTop = Math.max(0, (before - 3) * line);
  $("findCount").textContent = `${i + 1} of ${state.matches.length}`;
}
$("findInput").addEventListener("input", updateFind);
$("findInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); goTo(e.shiftKey ? -1 : 1); } });
$("findNext").addEventListener("click", () => goTo(1));
$("findPrev").addEventListener("click", () => goTo(-1));

// ---------------------------------------------------------------- copy and download

$("copyBtn").addEventListener("click", async () => {
  if (!state.text) return;
  try {
    await navigator.clipboard.writeText(state.text);
    $("copyBtn").textContent = "Copied";
    setMsg("Copied to the clipboard.", "success");
  } catch (err) {
    out.focus();
    out.select();
    setMsg("The browser would not copy it for you. The text is selected: press Ctrl+C (Cmd+C on a Mac).", "error");
  }
  setTimeout(() => { $("copyBtn").textContent = "Copy text"; }, 2500);
});

$("downloadBtn").addEventListener("click", () => {
  if (!state.text || !state.file) return;
  const type = state.ext === "md" ? "text/markdown" : "text/plain";
  triggerDownload(new Blob([state.text], { type: `${type};charset=utf-8` }), brandFilename("extract-pdf-text", safeBaseName($("prefix").value, "text"), state.ext));
});
