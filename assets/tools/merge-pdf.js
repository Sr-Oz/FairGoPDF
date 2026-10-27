import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas } from "/assets/tools/pdf-common.js";
import { renderFileCards } from "/assets/tools/file-cards.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { sortEntries, blanksNeeded, imagePlacement, jpegOrientation, bookmarkTitle } from "/assets/tools/merge-core.js";
import { parsePageSpec, safeBaseName } from "/assets/tools/page-tools.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileListEl = $("fileList");
const runBtn = $("runBtn");
const clearBtn = $("clearBtn");
const statusEl = $("status");

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Each entry is { file, kind: "pdf" | "image", range, canvas, pages, failed }: canvas (the first page) and pages arrive once
// pdf.js (or the browser, for a picture) has read the file.
let files = [];

async function loadPreview(entry) {
  if (entry.kind === "image") {
    try {
      const bitmap = await createImageBitmap(entry.file, { resizeWidth: 240, resizeQuality: "medium" }); // upright, as the page will show it
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      entry.canvas = canvas;
    } catch (err) {
      entry.failed = true; // the browser can't read it; the merge will say so
    }
  } else {
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
  }
  if (files.includes(entry)) renderFileList(true);
}

// ---------------------------------------------------------------- the cards

// "Takes 5 of 12 pages", or what is wrong with what was typed
function describeRange(entry) {
  const r = parsePageSpec(entry.range, entry.pages || 0);
  if (r.error) return { text: r.error, error: true };
  if (r.pages) return { text: entry.range.trim() ? `Takes ${r.pages.length} of ${entry.pages} page${entry.pages === 1 ? "" : "s"}` : "", error: false };
  return { text: "", error: false };
}

function rangeBox(entry, index) {
  if (entry.kind !== "pdf") return null;
  const wrap = document.createElement("div");
  wrap.className = "card-range";
  const input = document.createElement("input");
  input.type = "text";
  input.id = `range-${index}`;
  input.value = entry.range;
  input.placeholder = "All pages";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.dataset.index = String(index);
  input.setAttribute("aria-label", `Pages to take from ${entry.file.name}`);
  const note = document.createElement("span");
  note.className = "card-range-note";
  const paint = () => {
    const d = describeRange(entry);
    note.textContent = d.text;
    note.classList.toggle("is-error", d.error);
    input.setAttribute("aria-invalid", String(d.error));
  };
  input.addEventListener("input", () => { entry.range = input.value; paint(); });
  paint();
  wrap.append(input, note);
  return wrap;
}

function renderFileList(keepStatus = false) {
  // finishing a preview redraws the cards, so a box being typed in keeps its place
  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.index : undefined;
  const caret = active !== undefined ? document.activeElement.selectionStart : 0;
  renderFileCards(fileListEl, files, {
    detail: (entry) => entry.kind === "image"
      ? `Picture · ${formatBytes(entry.file.size)}`
      : [entry.pages ? `${entry.pages} page${entry.pages === 1 ? "" : "s"}` : "", formatBytes(entry.file.size)].filter(Boolean).join(" · "),
    icon: "picture_as_pdf",
    extra: (entry) => rangeBox(entry, files.indexOf(entry)),
    onChange: renderFileList,
  });
  if (active !== undefined) {
    const again = document.getElementById(`range-${active}`);
    if (again) { again.focus(); again.setSelectionRange(caret, caret); }
  }
  $("sortRow").hidden = files.length < 2;
  runBtn.disabled = files.length < 2;
  clearBtn.disabled = files.length < 1;
  dropzone.classList.toggle("compact", files.length > 0);
  if (!keepStatus) clearStatus(statusEl); // a finished preview redraws the cards but should not wipe a message
}

function addFiles(newFiles) {
  const isPdf = (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
  const accepted = newFiles.filter((f) => isPdf(f) || IMAGE_TYPES.includes(f.type));
  const entries = accepted.map((file) => ({ file, kind: isPdf(file) ? "pdf" : "image", range: "", canvas: null, pages: 0, failed: false }));
  files = files.concat(entries);
  renderFileList();
  if (accepted.length !== newFiles.length) setStatus(statusEl, "Some files were skipped because they weren't PDFs or JPG, PNG or WebP pictures.", "error");
  // one at a time, so a big batch doesn't read every file into memory at once
  (async () => {
    for (const entry of entries) if (files.includes(entry)) await loadPreview(entry);
  })();
}

initDropzone(dropzone, $("fileInput"), addFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "merge-pdf", dropzone, onFiles: addFiles });

clearBtn.addEventListener("click", () => {
  files = [];
  renderFileList();
});

for (const b of document.querySelectorAll("[data-sort]")) {
  b.addEventListener("click", () => {
    files = sortEntries(files, b.dataset.sort);
    renderFileList();
  });
}

// ---------------------------------------------------------------- building the merged file

// A picture on a page of its own. A JPEG that carries a camera rotation, and a WebP, go through a canvas first: PDF software
// ignores the rotation flag, and pdf-lib cannot read WebP. Everything else is embedded exactly as it is.
async function embedPicture(doc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const viaCanvas = async (type) => {
    const bitmap = await createImageBitmap(file); // upright
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvasToBlob(canvas, type, 0.92);
    if (!blob) throw new OpenProblem(`${file.name} couldn't be read as a picture.`);
    return new Uint8Array(await blob.arrayBuffer());
  };
  try {
    if (file.type === "image/png") return await doc.embedPng(bytes);
    if (file.type === "image/jpeg") return jpegOrientation(bytes) > 1 ? await doc.embedJpg(await viaCanvas("image/jpeg")) : await doc.embedJpg(bytes);
    return await doc.embedPng(await viaCanvas("image/png"));
  } catch (err) {
    if (err instanceof OpenProblem) throw err;
    throw new OpenProblem(`${file.name} couldn't be read as a picture (${err.message || "unknown problem"}).`);
  }
}

// One entry per file in the side panel of a PDF reader, pointing at that file's first page
function addBookmarks(doc, marks) {
  const { PDFName, PDFHexString } = PDFLib;
  const ctx = doc.context;
  const root = ctx.nextRef();
  const refs = marks.map(() => ctx.nextRef());
  marks.forEach((m, i) => {
    const item = {
      Title: PDFHexString.fromText(m.title),
      Parent: root,
      Dest: [doc.getPage(m.pageIndex).ref, PDFName.of("Fit")],
    };
    if (i > 0) item.Prev = refs[i - 1];
    if (i < marks.length - 1) item.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(item));
  });
  ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: marks.length }));
  doc.catalog.set(PDFName.of("Outlines"), root);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

runBtn.addEventListener("click", async () => {
  if (files.length < 2) {
    setStatus(statusEl, "Add at least two files to merge.", "error");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, "Merging…", "");

  try {
    const blankMode = $("blankMode").value;
    const imageSize = $("imageSize").value;
    const merged = await PDFLib.PDFDocument.create();
    const marks = [];
    const jobs = files.map((entry) => ({ entry, range: entry.range })); // what was typed when the button was pressed

    for (const [i, { entry, range }] of jobs.entries()) {
      setStatus(statusEl, `Merging ${i + 1} of ${jobs.length}…`, "");
      await new Promise((resolve) => setTimeout(resolve)); // let the page repaint between big files

      // work out where this file's pages go, then the blank pages before them
      let src = null;
      let take = [];
      if (entry.kind === "pdf") {
        src = await loadEditable(entry.file);
        const r = parsePageSpec(range, src.getPageCount());
        if (r.error) throw new OpenProblem(`${entry.file.name}: ${r.error}`);
        take = r.pages.map((n) => n - 1);
      }
      const count = entry.kind === "pdf" ? take.length : 1;
      for (let b = blanksNeeded(merged.getPageCount(), blankMode, i === 0); b > 0; b--) {
        const last = merged.getPageCount() ? merged.getPage(merged.getPageCount() - 1).getSize() : { width: 595.28, height: 841.89 };
        merged.addPage([last.width, last.height]);
      }

      const firstPage = merged.getPageCount();
      if (entry.kind === "pdf") {
        const pages = await merged.copyPages(src, take);
        pages.forEach((p) => merged.addPage(p));
      } else {
        const image = await embedPicture(merged, entry.file);
        const at = imagePlacement(image.width, image.height, imageSize);
        merged.addPage([at.pw, at.ph]).drawImage(image, { x: at.x, y: at.y, width: at.width, height: at.height });
      }
      if (merged.getPageCount() - firstPage !== count) throw new OpenProblem(`${entry.file.name} did not add the pages it should have.`);
      marks.push({ title: bookmarkTitle(entry.file.name), pageIndex: firstPage });
    }

    if ($("bookmarks").checked) addBookmarks(merged, marks);
    const title = $("docTitle").value.trim();
    const author = $("docAuthor").value.trim();
    if (title) merged.setTitle(title);
    if (author) merged.setAuthor(author);

    const outBytes = await merged.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const outName = brandFilename("merge-pdf", safeBaseName($("outName").value), "pdf");
    triggerDownload(blob, outName);
    const pageCount = merged.getPageCount();
    setStatus(statusEl, `Sorted, merged ${jobs.length} files into one PDF of ${pageCount} page${pageCount === 1 ? "" : "s"} (${formatBytes(blob.size)}).`, "success");

    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "merge-pdf",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "could not merge these files."}`, "error");
  } finally {
    runBtn.disabled = files.length < 2;
  }
});

renderFileList();
