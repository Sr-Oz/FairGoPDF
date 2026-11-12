// Repair PDF page. Reading a damaged file's bytes, saying what is wrong and cutting it back to what is whole is repair-core.js; this
// file works through the ways of getting a usable PDF out of it (rebuild, then pictures of the pages that can still be drawn) and
// builds the page around that.
import { PDFLib, loadPdfJsDoc, breathe } from "/assets/tools/pdf-common.js";
import { PDFDocument as DecryptingPDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";
import { canvasToBytes } from "/assets/tools/pdf-image-objects.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { analyse, describe, cutBack, withNewCatalog } from "/assets/tools/repair-core.js";

const { PDFName, PDFRef, PDFArray } = PDFLib;
const N = (s) => PDFName.of(s);
const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const progressEl = $("progress");
const runBtn = $("runBtn");

const state = { file: null, bytes: null, info: null, run: null, result: null, generation: 0 };
class Stopped extends Error {}
const check = (job) => { if (job.stopped) throw new Stopped(); };
const say = (text, kind = "") => setStatus(statusEl, text, kind);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function setProgress(f) { setProgressBar(progressEl, $("progressFill"), f); }

// ---------------------------------------------------------------- opening a file as leniently as possible

const LENIENT = { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false, capNumbers: true, parseSpeed: PDFLib.ParseSpeeds.Slow };

// a pdf-lib document from the bytes, or null when they cannot be read at all; a PDF that is locked only against editing is opened
async function open(bytes) {
  try {
    const doc = await PDFLib.PDFDocument.load(bytes.slice(), LENIENT);
    if (doc.getPageCount() >= 1) return doc;
  } catch (err) {
    // tried below
  }
  try {
    const unlocked = await DecryptingPDFDocument.load(bytes.slice(), { password: "" });
    const doc = await PDFLib.PDFDocument.load(await unlocked.save(), LENIENT);
    if (doc.getPageCount() >= 1) return doc;
  } catch (err) {
    // not that either
  }
  return null;
}

// does the page's content survive: "ok", "none" (a page with nothing to draw, which is allowed) or "missing" (it points at data that is gone)
function contentState(doc, page) {
  const raw = page.node.get(N("Contents"));
  if (raw === undefined) return "none";
  const items = raw instanceof PDFArray ? Array.from({ length: raw.size() }, (_, i) => raw.get(i)) : [raw];
  for (const item of items) {
    if (item instanceof PDFRef && !doc.context.lookup(item)) return "missing";
  }
  return items.length ? "ok" : "none";
}

// ---------------------------------------------------------------- the report on the file, straight away

function showFindings(a, size) {
  const lead = { bad: "Damage: ", fix: "Will fix: ", note: "Note: ", ok: "Found: " };
  $("insideList").innerHTML = describe(a, size).map((d) => `<li>${escapeHtml(lead[d.level] || "")}${escapeHtml(d.text)}</li>`).join("");
  $("insideTotal").textContent = formatBytes(size);
  $("inside").hidden = false;
}

async function loadFile(file) {
  const generation = ++state.generation;
  if (state.run) state.run.stopped = true;
  say("Reading the file…");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (generation !== state.generation) return;
  Object.assign(state, { file, bytes, result: null, info: analyse(bytes) });
  $("fileBar").textContent = `${file.name} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "repaired");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  showFindings(state.info, file.size);
  clearStatus(statusEl);
  updatePlan();
}

async function handleFiles(files) {
  // any file is taken, because a damaged PDF may have lost its name or type
  const file = files[0];
  if (!file) return;
  try {
    await loadFile(file);
  } catch (err) {
    console.error(err);
    say(`Could not read that file: ${err.message || "unknown error"}`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "repair-pdf", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  if (state.run) return;
  state.generation++;
  Object.assign(state, { file: null, bytes: null, info: null, result: null });
  $("fileBar").hidden = true;
  $("inside").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  updatePlan();
});

// ---------------------------------------------------------------- settings

const METHOD_HELP = {
  rebuild: "Reads the file part by part, cuts away what is damaged and rebuilds the rest into a clean PDF. Text, fonts, pictures and links that survive stay as they were.",
  pictures: "Draws each page with the browser's own PDF reader and saves a picture of it. Use it when a rebuild fails: it gets back what can be seen, but text can no longer be selected. OCR PDF can make it searchable again.",
};

function updatePlan() {
  $("methodHelp").textContent = METHOD_HELP[$("method").value];
  const a = state.info;
  const has = !!a;
  runBtn.disabled = !has || !a.isPdf || !!state.run;
  $("clearBtn").disabled = !has || !!state.run;
  const sum = $("summary");
  sum.classList.remove("is-error");
  if (!has) sum.textContent = "Add a PDF to begin.";
  else if (!a.isPdf) { sum.textContent = `This is ${a.label}, not a PDF. There is nothing to repair.`; sum.classList.add("is-error"); }
  else if (a.truncated) sum.textContent = "The file is cut short. Repair keeps every page that arrived whole.";
  else if (a.headerAt > 0 || !a.startxrefValid || !a.hasTrailer) sum.textContent = "The structure is damaged. Repair rebuilds it.";
  else sum.textContent = "No structural damage found. Repair still rebuilds a clean copy.";
}
$("method").addEventListener("change", updatePlan);

if (window.FGPAcc) {
  FGPAcc.set("method", () => ($("method").value === "rebuild" ? "Rebuild the file" : "Pictures of pages"));
  FGPAcc.set("damaged-pages", () => ($("damaged").value === "drop" ? "Leave them out" : "Keep as blank"));
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

// ---------------------------------------------------------------- repairing

// A pdf-lib document from the damaged bytes by the first of these ways that works.
//   as it is: only when nothing is obviously broken; the readers cope with a wrong table and a missing trailer themselves
//   cut back: junk and any cut-off object dropped, and a trailer added
//   new catalog: as cut back, with a new page list made from every whole page, for when the catalog or page tree is gone
async function rebuild(bytes, a, notes) {
  const clean = !a.truncated && a.headerAt === 0 && a.catalogs.length > 0;
  if (clean) {
    const doc = await open(bytes);
    // a page tree that lists fewer pages than the file holds has lost some of them
    if (doc && (a.pageNums.length === 0 || doc.getPageCount() >= a.pageNums.length)) {
      if (a.hasEof && !a.startxrefValid) notes.fixed.push("the table of where each part sits was wrong and was rebuilt");
      if (!a.hasTrailer) notes.fixed.push("the missing trailer was rebuilt");
      return { doc, method: "read as it was" };
    }
  }
  const body = cutBack(bytes, a);
  if (a.headerAt > 0) notes.fixed.push(`${a.headerAt} bytes of junk before the PDF were cut off`);
  if (a.cut) notes.fixed.push(`the part-written object ${a.cut.num} at the end was cut away`);
  if (a.trailing > 64) notes.fixed.push("extra bytes after the end of the PDF were cut off");
  const ownPages = a.pageNums;
  for (const [i, attempt] of [() => body, () => withNewCatalog(body, a, ownPages)].entries()) {
    if (i === 1 && !ownPages.length && !a.objStreams) break;
    const doc = await open(attempt());
    if (doc && (i === 1 ? true : a.pageNums.length === 0 || doc.getPageCount() >= a.pageNums.length)) {
      if (i === 1) {
        notes.fixed.push(a.catalogs.length ? "the page list was rebuilt from the pages that survive" : "the catalog, which says where the pages are, was rebuilt from the pages that survive");
        const root = doc.catalog.get(N("Pages"));
        if (root) for (const page of doc.getPages()) page.node.set(N("Parent"), root); // the pages' old parent may be gone
      }
      return { doc, method: i === 1 ? "rebuilt the page list" : "cut back to what was whole" };
    }
  }
  return null;
}

// the browser's own reader draws what it can, each page as a picture
async function asPictures(bytes, job, progress, notes) {
  let pj;
  try {
    pj = await loadPdfJsDoc(bytes.slice());
  } catch (err) {
    return null;
  }
  const out = await PDFLib.PDFDocument.create();
  let made = 0;
  const failed = [];
  for (let n = 1; n <= pj.numPages; n++) {
    check(job);
    progress((n - 1) / pj.numPages, `Drawing page ${n} of ${pj.numPages}…`);
    await breathe();
    try {
      const page = await pj.getPage(n);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / Math.max(v1.width, v1.height));
      const v = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.width);
      canvas.height = Math.round(v.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: v }).promise;
      const image = await out.embedJpg(await canvasToBytes(canvas, "image/jpeg", 0.88));
      out.addPage([v1.width, v1.height]).drawImage(image, { x: 0, y: 0, width: v1.width, height: v1.height });
      made++;
      canvas.width = canvas.height = 0;
    } catch (err) {
      failed.push(n);
    }
  }
  pj.loadingTask.destroy();
  if (failed.length) notes.lost.push(`${plural(failed.length, "page", "pages")} could not be drawn: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? " and more" : ""}`);
  return made ? { doc: out, pages: made } : null;
}

const list = (title, items) => {
  if (!items.length) return null;
  const box = document.createElement("div");
  const h = document.createElement("h3");
  h.className = "note-title";
  h.textContent = title;
  const ul = document.createElement("ul");
  ul.className = "note-list";
  for (const text of items) { const li = document.createElement("li"); li.textContent = text.charAt(0).toUpperCase() + text.slice(1) + "."; ul.appendChild(li); }
  box.append(h, ul);
  return box;
};

runBtn.addEventListener("click", async () => {
  if (!state.bytes || state.run || !state.info.isPdf) return;
  const job = { stopped: false, generation: state.generation };
  state.run = job;
  const { file, bytes, info: a } = state;
  const method = $("method").value;
  const keepBlank = $("damaged").value === "blank";
  runBtn.disabled = true;
  $("stopBtn").hidden = false;
  $("stopBtn").disabled = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  const notes = { fixed: [], lost: [] };
  const stale = () => job.generation !== state.generation;
  const progress = (f, t) => { setProgress(f); if (t) say(t); };

  try {
    let outBytes = null;
    let how = "";
    let pagesOut = 0;
    let blanked = 0;
    let found = 0;

    if (method === "rebuild") {
      progress(0.1, "Reading the file part by part…");
      await breathe();
      check(job);
      const built = await rebuild(bytes, a, notes);
      check(job);
      if (built) {
        const { doc } = built;
        how = built.method;
        const pages = doc.getPages();
        found = Math.max(pages.length, a.pageNums.length);
        progress(0.45, "Checking each page…");
        // pages that point at content that is gone
        const damaged = [];
        pages.forEach((p, i) => { if (contentState(doc, p) === "missing") damaged.push(i); });
        // the browser's reader, to catch a page whose content cannot be read
        const draft = await doc.save();
        let pj = null;
        try { pj = await loadPdfJsDoc(draft.slice()); } catch (err) { pj = null; }
        if (pj) {
          for (let i = 0; i < Math.min(pj.numPages, pages.length, 400); i++) {
            check(job);
            if (damaged.includes(i)) continue;
            if (i % 5 === 0) { progress(0.45 + 0.4 * (i / pages.length)); await breathe(); }
            try {
              const pg = await pj.getPage(i + 1);
              const ops = await pg.getOperatorList();
              if (!ops.fnArray.length && contentState(doc, pages[i]) === "ok") damaged.push(i);
              pg.cleanup();
            } catch (err) {
              damaged.push(i);
            }
          }
          pj.loadingTask.destroy();
        }
        const bad = [...new Set(damaged)].sort((x, y) => x - y);
        if (bad.length) {
          if (keepBlank) {
            blanked = bad.length;
            for (const i of bad) {
              const old = pages[i];
              const { width, height } = old.getSize();
              doc.insertPage(i, [width, height]);
              doc.removePage(i + 1);
            }
            notes.lost.push(`${plural(bad.length, "page", "pages")} had no content left and ${bad.length === 1 ? "is" : "are"} blank: page${bad.length === 1 ? "" : "s"} ${bad.slice(0, 8).map((i) => i + 1).join(", ")}${bad.length > 8 ? " and more" : ""}`);
          } else {
            for (const i of [...bad].reverse()) doc.removePage(i);
            notes.lost.push(`${plural(bad.length, "page", "pages")} had no content left and ${bad.length === 1 ? "was" : "were"} left out: original page${bad.length === 1 ? "" : "s"} ${bad.slice(0, 8).map((i) => i + 1).join(", ")}${bad.length > 8 ? " and more" : ""}`);
          }
        }
        if (doc.getPageCount() === 0) throw new Stopped("empty");
        pagesOut = doc.getPageCount();
        progress(0.92, "Saving…");
        outBytes = await doc.save();
        if (a.cut) notes.lost.push("the end of the file never arrived, so any pages after the cut are gone and cannot be recovered");
        else if (!a.hasEof) notes.fixed.push("the end-of-file marker was missing and was added; every page that is in the file was kept");
      } else {
        notes.fixed.push("the structure could not be rebuilt, so the pages were drawn as pictures instead");
      }
    }

    if (!outBytes) {
      // the last resort, or the way chosen: pictures of the pages the browser can draw
      const source = cutBack(bytes, a);
      const attempt = (await asPictures(withNewCatalog(source, a, a.pageNums), job, progress, notes)) || (await asPictures(bytes, job, progress, notes));
      if (stale()) return;
      if (!attempt) {
        say("This file could not be repaired. Not enough of it survives for the browser to read any page, so there is nothing to recover.", "error");
        return;
      }
      pagesOut = attempt.pages;
      found = Math.max(found, a.pageNums.length, pagesOut);
      how = "pictures of the pages";
      outBytes = await attempt.doc.save();
      notes.fixed.push("every page is a picture, so the text can no longer be selected");
    }
    if (stale()) return;

    const blob = new Blob([outBytes], { type: "application/pdf" });
    const outName = brandFilename("repair-pdf", safeBaseName($("prefix").value, "repaired"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${plural(pagesOut, "page", "pages")}${blanked ? ` (${blanked} blank)` : ""}, ${formatBytes(blob.size)}`;
    const box = $("noteLists");
    box.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "help-text";
    summary.textContent = `Method: ${how}.${found && pagesOut - blanked < found ? ` ${pagesOut - blanked} of the ${found} pages the file held could be saved.` : ""} Open the copy and check that everything you need is there.`;
    box.appendChild(summary);
    for (const s of [list("Fixed", notes.fixed), list("Could not be saved", notes.lost)]) if (s) box.appendChild(s);
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "repair-pdf",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    say(`Sorted, ${plural(pagesOut - blanked, "page", "pages")} recovered${blanked ? `, ${blanked} kept as blank` : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    if (err instanceof Stopped) say(err.message === "empty" ? "None of the pages could be saved. Try pictures of the pages under Method." : "Stopped. Nothing was changed.");
    else {
      console.error(err);
      say(`Something went wrong: ${err.message || "unknown error"}`, "error");
    }
  } finally {
    setProgress(null);
    $("stopBtn").hidden = true;
    if (state.run === job) state.run = null;
    updatePlan();
  }
});

$("stopBtn").addEventListener("click", () => {
  if (!state.run) return;
  state.run.stopped = true;
  $("stopBtn").disabled = true;
  say("Stopping…");
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

updatePlan();
