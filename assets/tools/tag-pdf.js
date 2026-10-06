import { analysePdf, tagPdf, TagError } from "/assets/tools/tag-pdf-engine.js";
import { pdfjsLib } from "/assets/tools/pdf-common.js";

const LANGUAGES = [
  ["en-AU", "English (Australia)"], ["en-NZ", "English (New Zealand)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"],
  ["mi-NZ", "Māori"], ["fr-FR", "French"], ["de-DE", "German"], ["es-ES", "Spanish"], ["it-IT", "Italian"],
  ["pt-PT", "Portuguese"], ["nl-NL", "Dutch"], ["id-ID", "Indonesian"], ["vi-VN", "Vietnamese"], ["zh-CN", "Chinese (Simplified)"],
];
const MAX_HEADING_ROWS = 400;
const MAX_THUMBNAILS = 60;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const fileSummary = document.getElementById("fileSummary");
const findingsEl = document.getElementById("findings");
const docTitle = document.getElementById("docTitle");
const docLang = document.getElementById("docLang");
const headingsCount = document.getElementById("headingsCount");
const headingList = document.getElementById("headingList");
const imagesSection = document.getElementById("imagesSection");
const imagesCount = document.getElementById("imagesCount");
const imageList = document.getElementById("imageList");
const allDecorativeBtn = document.getElementById("allDecorativeBtn");
const optBookmarks = document.getElementById("optBookmarks");
const optLinks = document.getElementById("optLinks");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progressFill");

let currentFile = null;
let analysis = null;
let thumbsStarted = false;
let session = 0;

function show(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

function setProgress(fraction) {
  progressEl.style.display = fraction === null ? "none" : "block";
  if (fraction !== null) progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function setBusy(busy) {
  runBtn.disabled = busy;
  clearBtn.disabled = busy;
}

function resetEditor() {
  analysis = null;
  thumbsStarted = false;
  editor.style.display = "none";
  headingList.innerHTML = "";
  imageList.innerHTML = "";
  findingsEl.innerHTML = "";
  setProgress(null);
}

const FRIENDLY = {
  tagged: 'This PDF already has tags, so Tag PDF leaves it alone: tagging it again could break the structure that is there. See how it scores with the <a href="/pdf-accessibility-checker/">Accessibility Checker</a>.',
  encrypted: 'This PDF is password protected. Unlock it first with <a href="/unlock-pdf/">Unlock PDF</a>, then come back.',
  "no-text": 'No selectable text was found, so this looks like a scan. Run it through <a href="/ocr-pdf/">OCR PDF</a> first, then tag the result.',
};

function showHtml(html, kind) {
  show("", kind);
  statusEl.innerHTML = html;
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    show("Please choose a PDF file.", "error");
    return;
  }
  const mine = ++session;
  resetEditor();
  currentFile = pdf;
  setBusy(true);
  try {
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    show("Reading your PDF…");
    setProgress(0);
    const result = await analysePdf(bytes, {
      onProgress: ({ phase, done, total }) => {
        if (mine !== session) return;
        show(`${phase}, page ${Math.min(done + 1, total)} of ${total}…`);
        setProgress(done / total);
      },
    });
    if (mine !== session) return;
    analysis = result;
    fillEditor();
    clearStatus(statusEl);
    setProgress(null);
  } catch (err) {
    if (mine !== session) return;
    setProgress(null);
    if (err instanceof TagError && FRIENDLY[err.code]) {
      showHtml(FRIENDLY[err.code], "error");
    } else {
      console.error(err);
      show(`Could not read that PDF: ${err.message || "unknown error"}`, "error");
    }
  } finally {
    setBusy(false);
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "tag-pdf", dropzone, onFiles: handleFiles });
}

function option(value, label, selected) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

function fillEditor() {
  const a = analysis;
  fileSummary.textContent = `${currentFile.name}: ${a.pageCount} page${a.pageCount > 1 ? "s" : ""}.`;

  findingsEl.innerHTML = "";
  a.findings.forEach((f) => {
    const li = document.createElement("li");
    li.className = f.level;
    li.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${f.level === "warn" ? "warning" : "info"}</span><span>${escapeHtml(f.message)}</span>`;
    findingsEl.appendChild(li);
  });

  docTitle.value = a.suggestedTitle || currentFile.name.replace(/\.pdf$/i, "");
  docLang.innerHTML = "";
  const known = LANGUAGES.some(([code]) => code === a.lang);
  const list = a.lang && !known ? [[a.lang, a.lang], ...LANGUAGES] : LANGUAGES;
  list.forEach(([code, name]) => docLang.appendChild(option(code, name, code === (a.lang || "en-AU"))));

  headingList.innerHTML = "";
  if (!a.headings.length) {
    headingsCount.textContent = "(none found)";
    const p = document.createElement("p");
    p.className = "help-text";
    p.textContent = "No headings were found, so the document will be tagged with paragraphs only and there will be no bookmarks.";
    headingList.appendChild(p);
  } else {
    headingsCount.textContent = `(${a.headings.length} found)`;
    a.headings.slice(0, MAX_HEADING_ROWS).forEach((h) => {
      const row = document.createElement("div");
      row.className = "tag-row";
      const sel = document.createElement("select");
      sel.dataset.id = h.id;
      sel.dataset.auto = String(h.level);
      sel.setAttribute("aria-label", `Level for the heading "${h.text}"`);
      for (let l = 1; l <= 6; l++) sel.appendChild(option(String(l), `H${l}`, l === h.level));
      sel.appendChild(option("0", "Not a heading", false));
      row.innerHTML = `<span class="pg">p. ${h.page}</span><span class="tx" title="${escapeHtml(h.text)}">${escapeHtml(h.text)}</span>`;
      row.appendChild(sel);
      headingList.appendChild(row);
    });
    if (a.headings.length > MAX_HEADING_ROWS) {
      const p = document.createElement("p");
      p.className = "help-text";
      p.textContent = `Showing the first ${MAX_HEADING_ROWS} of ${a.headings.length} headings. The rest keep their automatic levels.`;
      headingList.appendChild(p);
    }
  }

  imageList.innerHTML = "";
  if (!a.images.length) {
    imagesCount.textContent = "(none found)";
    const p = document.createElement("p");
    p.className = "help-text";
    p.textContent = "No content images were found.";
    imageList.appendChild(p);
    allDecorativeBtn.style.display = "none";
  } else {
    allDecorativeBtn.style.display = "";
    a.images.forEach((im) => {
      const row = document.createElement("div");
      row.className = "tag-row tag-image-row";
      row.dataset.id = im.id;
      row.innerHTML = `
        <canvas class="thumb" width="96" height="72" aria-hidden="true"></canvas>
        <div class="meta">
          <span class="pg">Page ${im.page}</span>
          <input type="text" class="alt" maxlength="300" placeholder="Describe this image" aria-label="Description of the image on page ${im.page}">
          <label class="deco"><input type="checkbox"> Decorative</label>
        </div>`;
      imageList.appendChild(row);
    });
    updateImagesCount();
    imagesSection.open = a.images.length <= 8;
  }
  thumbsStarted = false;
  if (imagesSection.open) startThumbnails();
  editor.style.display = "block";
}

function updateImagesCount() {
  const rows = [...imageList.querySelectorAll(".tag-image-row")];
  const done = rows.filter((r) => r.querySelector(".deco input").checked || r.querySelector(".alt").value.trim()).length;
  imagesCount.textContent = `(${done} of ${rows.length} done)`;
}

imageList.addEventListener("input", (e) => {
  const row = e.target.closest(".tag-image-row");
  if (!row) return;
  if (e.target.matches(".deco input")) row.querySelector(".alt").disabled = e.target.checked;
  updateImagesCount();
});

allDecorativeBtn.addEventListener("click", () => {
  imageList.querySelectorAll(".tag-image-row").forEach((row) => {
    row.querySelector(".deco input").checked = true;
    row.querySelector(".alt").disabled = true;
  });
  updateImagesCount();
});

imagesSection.addEventListener("toggle", () => { if (imagesSection.open) startThumbnails(); });

async function startThumbnails() {
  if (thumbsStarted || !analysis || !analysis.images.length) return;
  thumbsStarted = true;
  const mine = session;
  let doc = null;
  try {
    doc = await pdfjsLib.getDocument({ data: analysis._inputBytes.slice() }).promise;
    const byPage = new Map();
    analysis.images.slice(0, MAX_THUMBNAILS).forEach((im) => {
      if (!byPage.has(im.page)) byPage.set(im.page, []);
      byPage.get(im.page).push(im);
    });
    for (const [pageNo, list] of byPage) {
      if (mine !== session) return;
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 800 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
      for (const im of list) {
        const row = imageList.querySelector(`[data-id="${CSS.escape(im.id)}"]`);
        const thumb = row && row.querySelector("canvas.thumb");
        if (!thumb) continue;
        const [ta, tb, tc, td, te, tf] = viewport.transform;
        const toView = (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf];
        const [x1, y1] = toView(im.bbox[0], im.bbox[1]);
        const [x2, y2] = toView(im.bbox[2], im.bbox[3]);
        const sx = Math.max(0, Math.min(x1, x2));
        const sy = Math.max(0, Math.min(y1, y2));
        const sw = Math.min(canvas.width - sx, Math.abs(x2 - x1));
        const sh = Math.min(canvas.height - sy, Math.abs(y2 - y1));
        if (sw < 2 || sh < 2) continue;
        const scale = Math.min(thumb.width / sw, thumb.height / sh);
        const tctx = thumb.getContext("2d");
        tctx.fillStyle = "#f4f4f2";
        tctx.fillRect(0, 0, thumb.width, thumb.height);
        tctx.drawImage(canvas, sx, sy, sw, sh, (thumb.width - sw * scale) / 2, (thumb.height - sh * scale) / 2, sw * scale, sh * scale);
      }
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (doc && doc.loadingTask) doc.loadingTask.destroy();
  }
}

clearBtn.addEventListener("click", () => {
  session++;
  currentFile = null;
  fileInput.value = "";
  resetEditor();
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!analysis) return;
  setBusy(true);
  setProgress(0);
  show("Tagging…");
  const headingLevels = {};
  headingList.querySelectorAll("select[data-id]").forEach((sel) => {
    if (sel.value !== sel.dataset.auto) headingLevels[sel.dataset.id] = Number(sel.value);
  });
  const images = {};
  imageList.querySelectorAll(".tag-image-row").forEach((row) => {
    images[row.dataset.id] = { decorative: row.querySelector(".deco input").checked, alt: row.querySelector(".alt").value };
  });
  try {
    const { bytes, stats } = await tagPdf(
      analysis,
      {
        title: docTitle.value.trim() || analysis.suggestedTitle || currentFile.name.replace(/\.pdf$/i, ""),
        lang: docLang.value,
        headingLevels,
        images,
        bookmarks: optBookmarks.checked,
        tagLinks: optLinks.checked,
      },
      {
        onProgress: ({ phase, done, total }) => {
          show(`${phase} ${Math.min(done + 1, total)} of ${total}…`);
          setProgress(done / total);
        },
      }
    );
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("tag-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "tag-pdf",
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
    const parts = [];
    const add = (n, one, many) => { if (n) parts.push(`${n} ${n === 1 ? one : many}`); };
    add(stats.headings, "heading", "headings");
    add(stats.paragraphs, "paragraph", "paragraphs");
    add(stats.lists, "list", "lists");
    add(stats.figures, "image", "images");
    add(stats.links, "link", "links");
    let message = `Sorted — tagged ${parts.join(", ") || "the document"} (${formatBytes(blob.size)}).`;
    if (stats.imagesNeedingAlt) {
      message += ` ${stats.imagesNeedingAlt} image${stats.imagesNeedingAlt === 1 ? " has" : "s have"} no description yet, so a screen reader will announce ${stats.imagesNeedingAlt === 1 ? "it" : "them"} without one.`;
    }
    message += " Check the result with the Accessibility Checker.";
    show(message, "success");
    setProgress(null);
  } catch (err) {
    console.error(err);
    show(`Something went wrong: ${err.message || "unknown error"}`, "error");
    setProgress(null);
  } finally {
    setBusy(false);
  }
});
