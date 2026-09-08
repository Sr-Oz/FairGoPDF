import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, renderPageToCanvasAtScale } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const stage = document.getElementById("linkStage");
const editPanel = document.getElementById("linkEditPanel");
const urlField = document.getElementById("urlField");
const pageField = document.getElementById("pageField");
const linkUrlInput = document.getElementById("linkUrl");
const linkPageInput = document.getElementById("linkPage");
const confirmLinkBtn = document.getElementById("confirmLinkBtn");
const deleteLinkBtn = document.getElementById("deleteLinkBtn");
const cancelLinkBtn = document.getElementById("cancelLinkBtn");
const clearPageBtn = document.getElementById("clearPageBtn");
const linkSummary = document.getElementById("linkSummary");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PREVIEW_WIDTH = 700;

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let pageCount = 0;
let selectedPageIndex = 0;

// pageIndex (0-based) -> array of { x, y, w, h, type: 'url'|'page', url, targetPage }
// x, y, w, h are in PDF point space (origin bottom-left).
const links = new Map();

let stageScale = 1;
let stageWidthPt = 0;
let stageHeightPt = 0;
let baseCanvas = null;
let dragStartPx = null;
let pendingRectPt = null; // the rect currently being configured in the edit panel
let editingLink = null; // reference to an existing link object being edited, or null for "new"

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  links.clear();

  try {
    setStatus(statusEl, "Rendering pages…", "");
    statusEl.classList.add("visible");
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    pageCount = pdfJsDoc.numPages;
    pageGrid.innerHTML = "";
    selectedPageIndex = 0;

    for (let i = 1; i <= pageCount; i++) {
      const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 160);
      const thumb = document.createElement("div");
      thumb.className = "page-thumb" + (i === 1 ? " selected" : "");
      thumb.dataset.pageIndex = String(i - 1);
      thumb.innerHTML = `<span class="page-num">${i}</span><span class="link-badge"></span>`;
      thumb.appendChild(canvas);
      thumb.addEventListener("click", () => selectPage(i - 1));
      pageGrid.appendChild(thumb);
    }

    editor.style.display = "block";
    clearStatus(statusEl);
    await selectPage(0);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

async function selectPage(index) {
  closeEditPanel();
  selectedPageIndex = index;
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.pageIndex) === index);
  });

  const page = await pdfJsDoc.getPage(index + 1);
  const viewport1 = page.getViewport({ scale: 1 });
  stageWidthPt = viewport1.width;
  stageHeightPt = viewport1.height;
  stageScale = PREVIEW_WIDTH / viewport1.width;

  baseCanvas = await renderPageToCanvasAtScale(pdfJsDoc, index + 1, stageScale);
  stage.width = baseCanvas.width;
  stage.height = baseCanvas.height;
  redrawStage();
}

function redrawStage(liveRectPx) {
  const ctx = stage.getContext("2d");
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);

  const pageLinks = links.get(selectedPageIndex) || [];
  pageLinks.forEach((link, i) => {
    const box = ptRectToPx(link);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = "#2563eb";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(String(i + 1), box.x + 4, box.y + 14);
    ctx.restore();
    link._box = box;
  });

  if (liveRectPx) {
    ctx.fillRect(liveRectPx.x, liveRectPx.y, liveRectPx.w, liveRectPx.h);
    ctx.strokeRect(liveRectPx.x, liveRectPx.y, liveRectPx.w, liveRectPx.h);
  }
  ctx.setLineDash([]);
}

function ptRectToPx(r) {
  const x = r.x * stageScale;
  const w = r.w * stageScale;
  const h = r.h * stageScale;
  const y = stage.height - r.y * stageScale - h;
  return { x, y, w, h };
}

function pxRectToPt(xPx, yPx, wPx, hPx) {
  const x = xPx / stageScale;
  const w = wPx / stageScale;
  const h = hPx / stageScale;
  const y = (stage.height - yPx) / stageScale - h;
  return { x, y, w, h };
}

function stagePoint(e) {
  const rect = stage.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (stage.width / rect.width),
    y: (e.clientY - rect.top) * (stage.height / rect.height),
  };
}

function hitTestLink(px, py) {
  const pageLinks = links.get(selectedPageIndex) || [];
  for (let i = pageLinks.length - 1; i >= 0; i--) {
    const b = pageLinks[i]._box;
    if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return pageLinks[i];
  }
  return null;
}

stage.addEventListener("pointerdown", (e) => {
  if (!baseCanvas) return;
  const p = stagePoint(e);
  const hit = hitTestLink(p.x, p.y);
  if (hit) {
    openEditPanel(hit, false);
    return;
  }
  dragStartPx = p;
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener("pointermove", (e) => {
  if (!dragStartPx) return;
  const p = stagePoint(e);
  const x = Math.min(dragStartPx.x, p.x);
  const y = Math.min(dragStartPx.y, p.y);
  const w = Math.abs(p.x - dragStartPx.x);
  const h = Math.abs(p.y - dragStartPx.y);
  redrawStage({ x, y, w, h });
});

stage.addEventListener("pointerup", (e) => {
  if (!dragStartPx) return;
  const p = stagePoint(e);
  const xPx = Math.min(dragStartPx.x, p.x);
  const yPx = Math.min(dragStartPx.y, p.y);
  const wPx = Math.abs(p.x - dragStartPx.x);
  const hPx = Math.abs(p.y - dragStartPx.y);
  dragStartPx = null;

  if (wPx < 8 || hPx < 8) {
    redrawStage();
    return;
  }

  pendingRectPt = pxRectToPt(xPx, yPx, wPx, hPx);
  openEditPanel(null, true);
});

function openEditPanel(link, isNew) {
  editingLink = isNew ? null : link;
  editPanel.classList.add("visible");
  deleteLinkBtn.style.display = isNew ? "none" : "inline-flex";

  const type = isNew ? "url" : link.type;
  document.querySelectorAll('input[name="linkType"]').forEach((r) => { r.checked = r.value === type; });
  urlField.style.display = type === "url" ? "block" : "none";
  pageField.style.display = type === "page" ? "block" : "none";
  linkUrlInput.value = isNew ? "" : link.url || "";
  linkPageInput.max = String(pageCount);
  linkPageInput.value = isNew ? String(selectedPageIndex + 1) : String(link.targetPage || 1);

  if (!isNew) {
    pendingRectPt = { x: link.x, y: link.y, w: link.w, h: link.h };
    redrawStage();
  }
}

function closeEditPanel() {
  editPanel.classList.remove("visible");
  editingLink = null;
  pendingRectPt = null;
  redrawStage();
}

document.querySelectorAll('input[name="linkType"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const type = document.querySelector('input[name="linkType"]:checked').value;
    urlField.style.display = type === "url" ? "block" : "none";
    pageField.style.display = type === "page" ? "block" : "none";
  });
});

confirmLinkBtn.addEventListener("click", () => {
  const type = document.querySelector('input[name="linkType"]:checked').value;
  if (type === "url") {
    const url = linkUrlInput.value.trim();
    if (!url) {
      setStatus(statusEl, "Enter a URL for this link.", "error");
      statusEl.classList.add("visible");
      return;
    }
  } else {
    const target = Number(linkPageInput.value);
    if (!target || target < 1 || target > pageCount) {
      setStatus(statusEl, `Enter a page number between 1 and ${pageCount}.`, "error");
      statusEl.classList.add("visible");
      return;
    }
  }

  const rect = pendingRectPt;
  if (editingLink) {
    editingLink.type = type;
    editingLink.url = linkUrlInput.value.trim();
    editingLink.targetPage = Number(linkPageInput.value);
  } else {
    if (!links.has(selectedPageIndex)) links.set(selectedPageIndex, []);
    links.get(selectedPageIndex).push({
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      type,
      url: linkUrlInput.value.trim(),
      targetPage: Number(linkPageInput.value),
    });
  }
  closeEditPanel();
  updateBadgesAndSummary();
});

deleteLinkBtn.addEventListener("click", () => {
  if (!editingLink) return;
  const list = links.get(selectedPageIndex) || [];
  links.set(selectedPageIndex, list.filter((l) => l !== editingLink));
  closeEditPanel();
  updateBadgesAndSummary();
});

cancelLinkBtn.addEventListener("click", closeEditPanel);

clearPageBtn.addEventListener("click", () => {
  closeEditPanel();
  links.delete(selectedPageIndex);
  redrawStage();
  updateBadgesAndSummary();
});

function updateBadgesAndSummary() {
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    const idx = Number(el.dataset.pageIndex);
    el.classList.toggle("has-links", links.has(idx) && links.get(idx).length > 0);
  });
  const markedPages = Array.from(links.values()).filter((r) => r.length > 0).length;
  const totalLinks = Array.from(links.values()).reduce((sum, r) => sum + r.length, 0);
  linkSummary.textContent = markedPages
    ? `${totalLinks} link${totalLinks > 1 ? "s" : ""} added across ${markedPages} page${markedPages > 1 ? "s" : ""}.`
    : "No links added yet.";
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pdfJsDoc = null;
  pageCount = 0;
  links.clear();
  closeEditPanel();
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

function addLinkAnnotation(context, page, rectPt, actionDict) {
  const { PDFName, PDFArray } = PDFLib;
  const annotDict = context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rectPt.x, rectPt.y, rectPt.x + rectPt.w, rectPt.y + rectPt.h],
    Border: [0, 0, 0],
    A: actionDict,
  });
  const annotRef = context.register(annotDict);
  const existing = page.node.lookup(PDFName.of("Annots"));
  let annotsArray;
  if (existing instanceof PDFArray) {
    annotsArray = existing;
  } else {
    annotsArray = context.obj([]);
    page.node.set(PDFName.of("Annots"), annotsArray);
  }
  annotsArray.push(annotRef);
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const markedPages = Array.from(links.entries()).filter(([, l]) => l.length > 0);
  if (markedPages.length === 0) {
    setStatus(statusEl, "Draw at least one link area first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Adding links…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const pages = doc.getPages();
    const context = doc.context;

    for (const [pageIndex, pageLinks] of links.entries()) {
      const page = pages[pageIndex];
      if (!page) continue;
      for (const link of pageLinks) {
        const actionDict = link.type === "url"
          ? context.obj({ Type: "Action", S: "URI", URI: PDFLib.PDFString.of(link.url) })
          : context.obj({ Type: "Action", S: "GoTo", D: [pages[link.targetPage - 1].ref, "Fit"] });
        addLinkAnnotation(context, page, link, actionDict);
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-links.pdf`);
    const totalLinks = markedPages.reduce((sum, [, l]) => sum + l.length, 0);
    setStatus(statusEl, `Sorted — added ${totalLinks} link${totalLinks > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
