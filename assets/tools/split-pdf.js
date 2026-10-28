// Split PDF page. The rules (which pages go in which file, names, sizes) are in split-core.js; this file is the page around them.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, breathe } from "/assets/tools/pdf-common.js";
import * as fflate from "/assets/vendor/fflate.min.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { parsePageSpec, compactPages, safeBaseName } from "/assets/tools/page-tools.js";
import { planSplit, partitionBySize, fileNameFor } from "/assets/tools/split-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const pageGrid = $("pageGrid");
const statusEl = $("status");
const splitBtn = $("splitBtn");
const summaryEl = $("splitSummary");

const SELECTION_MODES = ["selected-one", "selected-each"];
const MODE_HELP = {
  "selected-one": "Takes the pages you pick and puts them together in one new PDF.",
  "selected-each": "Each page you pick becomes its own PDF.",
  ranges: "Each line becomes one PDF. Use commas inside a line for several ranges in one file, such as 4-7, 9. The words last and except work too.",
  every: "Cuts the PDF into files of the same number of pages. The last one is shorter if the pages do not divide evenly.",
  equal: "Cuts the PDF into the number of files you ask for, as even as the page count allows.",
  bookmarks: "Starts a new file at every top-level bookmark, named after it. Pages before the first bookmark become a file of front pages.",
  size: "Fills each file with as many pages as fit under the size you set, which suits email limits. A single page bigger than the limit still gets a file of its own.",
};

// sizeParts: the files the size mode worked out last time, shown on the thumbnails until a setting changes
const state = { file: null, doc: null, count: 0, selected: new Set(), bookmarks: [], results: [], sizeParts: null, generation: 0 };

// ---------------------------------------------------------------- reading the PDF

// The top-level bookmarks and the page each one points at
async function readBookmarks(doc) {
  const marks = [];
  try {
    for (const item of (await doc.getOutline()) || []) {
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        if (!Array.isArray(dest)) continue;
        const index = typeof dest[0] === "object" ? await doc.getPageIndex(dest[0]) : dest[0];
        marks.push({ title: item.title || "Untitled", page: index + 1 });
      } catch (err) {
        // a bookmark that points nowhere is skipped
      }
    }
  } catch (err) {
    // no readable bookmarks
  }
  return marks;
}

let renderChain = Promise.resolve();
let observer = null;

function renderThumb(thumb, generation) {
  if (thumb.dataset.rendered) return;
  thumb.dataset.rendered = "1";
  renderChain = renderChain.then(async () => {
    if (generation !== state.generation) return;
    try {
      const n = Number(thumb.dataset.page);
      const canvas = await renderPageThumbCanvas(state.doc, n, 200);
      if (generation !== state.generation) return;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${n} preview`);
      thumb.querySelector(".thumb-ph").replaceWith(canvas);
    } catch (err) {
      // the placeholder stays; the page still splits
    }
  });
}

// Thumbnails are drawn as they scroll into view, so a 400-page PDF does not make the browser draw 400 pictures up front
function buildGrid(ratio) {
  if (observer) observer.disconnect();
  const generation = state.generation;
  pageGrid.innerHTML = "";
  observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); renderThumb(e.target, generation); } }), { rootMargin: "600px" })
    : null;
  for (let i = 1; i <= state.count; i++) {
    const thumb = document.createElement("div");
    thumb.className = "page-thumb";
    thumb.dataset.page = String(i);
    thumb.innerHTML = `<span class="page-num">${i}</span><div class="thumb-ph" style="aspect-ratio:${ratio}"></div><span class="part-tag"></span>`;
    thumb.addEventListener("click", () => {
      if (!SELECTION_MODES.includes($("mode").value)) return;
      if (state.selected.has(i)) state.selected.delete(i); else state.selected.add(i);
      selectionChanged(true);
    });
    pageGrid.appendChild(thumb);
    if (observer) observer.observe(thumb); else renderThumb(thumb, generation);
  }
}

async function loadFile(file) {
  const generation = ++state.generation;
  setStatus(statusEl, "Reading the PDF…", "");
  if (state.doc) state.doc.destroy();
  const doc = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { doc.destroy(); return; }
  Object.assign(state, { file, doc, count: doc.numPages, selected: new Set(Array.from({ length: doc.numPages }, (_, i) => i + 1)), results: [], sizeParts: null });
  state.bookmarks = await readBookmarks(doc);
  const first = await doc.getPage(1);
  const view = first.getViewport({ scale: 1 });
  buildGrid((view.width / view.height).toFixed(4));
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("gridWrap").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "split");
  $("results").classList.remove("visible");
  dropzone.classList.add("compact");
  clearStatus(statusEl);
  syncRangeInput();
  syncMode();
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
if (window.KeepSorted) KeepSorted.init({ currentTool: "split-pdf", dropzone, onFiles: handleFiles });

// ---------------------------------------------------------------- choosing pages

function syncRangeInput() {
  $("rangeInput").value = compactPages([...state.selected]);
  $("rangeNote").textContent = "";
  $("rangeNote").classList.remove("is-error");
  $("rangeInput").setAttribute("aria-invalid", "false");
}

// fromThumbs: the change came from a click or button, so the pages box is rewritten to match
function selectionChanged(fromThumbs) {
  if (fromThumbs) syncRangeInput();
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => el.classList.toggle("selected", state.selected.has(Number(el.dataset.page))));
  updatePlan();
}

$("rangeInput").addEventListener("input", () => {
  const text = $("rangeInput").value;
  const note = $("rangeNote");
  if (!text.trim()) {
    state.selected = new Set();
  } else {
    const r = parsePageSpec(text, state.count);
    note.textContent = r.error || "";
    note.classList.toggle("is-error", !!r.error);
    $("rangeInput").setAttribute("aria-invalid", String(!!r.error));
    if (r.error) return; // keep the last good selection while the box is mid-typing
    state.selected = new Set(r.pages);
    note.textContent = `${r.pages.length} of ${state.count} pages`;
  }
  selectionChanged(false);
});

for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("click", () => {
    const all = Array.from({ length: state.count }, (_, i) => i + 1);
    const pick = b.dataset.pick;
    state.selected = new Set(
      pick === "all" ? all : pick === "none" ? [] : pick === "odd" ? all.filter((n) => n % 2) : pick === "even" ? all.filter((n) => n % 2 === 0) : all.filter((n) => !state.selected.has(n)),
    );
    selectionChanged(true);
  });
}

// ---------------------------------------------------------------- the plan, shown before anything is made

const num = (id) => parseFloat($(id).value);
const limitBytes = () => num("maxSize") * Number($("sizeUnit").value);

function currentPlan() {
  return planSplit({
    mode: $("mode").value, count: state.count, selected: [...state.selected], ranges: $("rangesInput").value,
    every: num("everyN"), parts: num("equalN"), bookmarks: state.bookmarks,
  });
}

// colours the pages by the file they will go into
function annotate(parts) {
  const tags = new Map();
  (parts || []).forEach((p, i) => p.pages.forEach((n) => tags.set(n, i)));
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    const i = tags.get(Number(el.dataset.page));
    el.classList.toggle("has-part", i !== undefined);
    el.style.setProperty("--hue", i === undefined ? "" : String((i * 53) % 360));
    el.querySelector(".part-tag").textContent = i === undefined ? "" : `File ${i + 1}`;
  });
}

function say(text, isError = false) {
  summaryEl.textContent = text;
  summaryEl.classList.toggle("is-error", isError);
}

function updatePlan() {
  const mode = $("mode").value;
  if (!state.count) { splitBtn.disabled = true; say("Add a PDF to begin."); return; }
  const selection = SELECTION_MODES.includes(mode);
  const plan = currentPlan();
  if (plan.bySize && !state.sizeParts) {
    const ok = limitBytes() > 0;
    annotate(null);
    splitBtn.disabled = !ok;
    say(ok ? `The files are worked out when you press Split, so none is over ${formatBytes(limitBytes())}.` : "Enter the largest size a file may be.", !ok);
    return;
  }
  if (plan.error) { annotate(null); splitBtn.disabled = true; say(plan.error, true); return; }
  const parts = plan.bySize ? state.sizeParts : plan.parts;
  annotate(selection ? null : parts);
  splitBtn.disabled = false;
  const n = parts.length;
  const list = parts.slice(0, 6).map((p) => compactPages(p.pages)).join(" · ") + (n > 6 ? ` · and ${n - 6} more` : "");
  say(n === 1 ? `1 file with ${parts[0].pages.length} page${parts[0].pages.length === 1 ? "" : "s"}: ${list}` : `${n} files: ${list}`);
}

function syncMode() {
  state.sizeParts = null;
  const mode = $("mode").value;
  const show = { selected: SELECTION_MODES.includes(mode), ranges: mode === "ranges", every: mode === "every", equal: mode === "equal", size: mode === "size" };
  for (const [key, on] of Object.entries(show)) $(`block-${key}`).hidden = !on;
  const marks = state.bookmarks.length;
  $("modeHelp").textContent = MODE_HELP[mode] + (mode === "bookmarks" && state.count ? (marks ? ` This PDF has ${marks} top-level bookmark${marks === 1 ? "" : "s"}.` : " This PDF has no bookmarks.") : "");
  pageGrid.classList.toggle("readonly", !show.selected);
  $("gridHelp").textContent = show.selected
    ? "Click pages to pick them, or type in the Pages box. Picked pages have a green border."
    : mode === "size" ? "Pages are shared out when you press Split." : "The coloured labels show which file each page goes into.";
  updatePlan();
}

$("mode").addEventListener("change", syncMode);
for (const id of ["rangesInput", "everyN", "equalN", "maxSize", "sizeUnit"]) $(id).addEventListener("input", () => { state.sizeParts = null; updatePlan(); });

// ---------------------------------------------------------------- making the files

async function makePdf(src, pages) {
  const out = await PDFLib.PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

const download = (bytes, name) => triggerDownload(new Blob([bytes], { type: "application/pdf" }), name);

function showResults(base) {
  const total = state.results.reduce((n, r) => n + r.bytes.length, 0);
  $("resultTotal").textContent = `${state.results.length} file${state.results.length === 1 ? "" : "s"}, ${formatBytes(total)} together`;
  $("zipBtn").hidden = state.results.length < 2;
  const box = $("resultItems");
  box.innerHTML = "";
  for (const r of state.results) {
    const row = document.createElement("div");
    row.className = "result-item";
    row.innerHTML = `<div class="info"><div class="ci-name">${escapeHtml(r.name)}</div><div class="ci-line ci-muted">${r.pages} page${r.pages === 1 ? "" : "s"} · ${formatBytes(r.bytes.length)}</div>${r.oversize ? '<div class="ci-note">This page is bigger than the limit on its own.</div>' : ""}</div>`;
    const dl = document.createElement("button");
    dl.className = "btn small";
    dl.type = "button";
    dl.textContent = "Download";
    dl.addEventListener("click", () => download(r.bytes, brandFilename("split-pdf", stripExtension(r.name), "pdf")));
    row.appendChild(dl);
    box.appendChild(row);
  }
  $("results").classList.add("visible");
  $("results").dataset.base = base;
}

function downloadZip() {
  const entries = {};
  for (const r of state.results) entries[r.name] = r.bytes;
  // the pages are already compressed inside, so storing the files is as small as deflating them and much quicker
  const zip = fflate.zipSync(entries, { level: 0 });
  triggerDownload(new Blob([zip], { type: "application/zip" }), brandFilename("split-pdf", `${$("results").dataset.base}-split`, "zip"));
}
$("zipBtn").addEventListener("click", downloadZip);

splitBtn.addEventListener("click", async () => {
  let plan = currentPlan();
  if (plan.error) { setStatus(statusEl, plan.error, "error"); return; }
  splitBtn.disabled = true;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none"; // an offer from an earlier run no longer matches
  document.querySelector(".related-tools-section").style.display = "";
  try {
    setStatus(statusEl, "Splitting…", "");
    const src = await loadEditable(state.file);
    if (plan.bySize) {
      const limit = limitBytes();
      const seen = new Map(); // the same run can be asked about twice while narrowing down
      let tries = 0;
      const parts = await partitionBySize(state.count, limit, async (from, to) => {
        const key = `${from}-${to}`;
        if (!seen.has(key)) {
          setStatus(statusEl, `Working out the files… (${++tries})`, "");
          await breathe();
          seen.set(key, (await makePdf(src, Array.from({ length: to - from + 1 }, (_, i) => from + i))).length);
        }
        return seen.get(key);
      });
      plan = { parts };
      state.sizeParts = parts;
    }
    const base = safeBaseName($("prefix").value, "split");
    const total = plan.parts.length;
    state.results = [];
    for (const [i, part] of plan.parts.entries()) {
      setStatus(statusEl, `Making file ${i + 1} of ${total}…`, "");
      await breathe();
      state.results.push({ name: fileNameFor(base, i, total, part.label), pages: part.pages.length, bytes: await makePdf(src, part.pages), oversize: !!part.oversize });
    }
    annotate(SELECTION_MODES.includes($("mode").value) ? null : plan.parts);
    showResults(base);
    if (total === 1) download(state.results[0].bytes, brandFilename("split-pdf", stripExtension(state.results[0].name), "pdf"));
    else downloadZip();
    // with several files there is no single "it" to carry on with, so Keep it sorted is only offered for one
    if (window.KeepSorted && total === 1) {
      KeepSorted.offer({
        currentTool: "split-pdf",
        blob: new Blob([state.results[0].bytes], { type: "application/pdf" }),
        filename: brandFilename("split-pdf", stripExtension(state.results[0].name), "pdf"),
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    const note = plan.parts.some((p) => p.oversize) ? " One page was bigger than the limit on its own." : "";
    setStatus(statusEl, `Sorted, ${total} file${total === 1 ? "" : "s"} made${total === 1 ? "" : ", downloaded as a ZIP"}.${note}`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    splitBtn.disabled = false;
    updatePlan();
  }
});

syncMode();
