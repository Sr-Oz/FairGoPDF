import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const scanSummary = document.getElementById("scanSummary");
const optScripts = document.getElementById("optScripts");
const optFiles = document.getElementById("optFiles");
const optMetadata = document.getElementById("optMetadata");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

function walkScriptsAndActions(doc, { remove }) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  let count = 0;
  const catalog = doc.catalog;

  if (catalog.has(PDFName.of("OpenAction"))) {
    count++;
    if (remove) catalog.delete(PDFName.of("OpenAction"));
  }
  if (catalog.has(PDFName.of("AA"))) {
    count++;
    if (remove) catalog.delete(PDFName.of("AA"));
  }

  const namesRef = catalog.get(PDFName.of("Names"));
  if (namesRef) {
    const namesDict = doc.context.lookup(namesRef, PDFDict);
    if (namesDict && namesDict.has(PDFName.of("JavaScript"))) {
      count++;
      if (remove) namesDict.delete(PDFName.of("JavaScript"));
    }
  }

  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of("AA"))) {
      count++;
      if (remove) page.node.delete(PDFName.of("AA"));
    }
    const annotsRef = page.node.get(PDFName.of("Annots"));
    if (!annotsRef) continue;
    const annots = doc.context.lookup(annotsRef, PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annotDict = doc.context.lookup(annots.get(i), PDFDict);
      if (!annotDict) continue;
      const actionRef = annotDict.get(PDFName.of("A"));
      if (!actionRef) continue;
      const actionDict = doc.context.lookup(actionRef, PDFDict);
      const subtype = actionDict && actionDict.get(PDFName.of("S"));
      if (subtype && subtype.toString() === "/JavaScript") {
        count++;
        if (remove) annotDict.delete(PDFName.of("A"));
      }
    }
  }
  return count;
}

function walkEmbeddedFiles(doc, { remove }) {
  const { PDFName, PDFDict } = PDFLib;
  const namesRef = doc.catalog.get(PDFName.of("Names"));
  if (!namesRef) return 0;
  const namesDict = doc.context.lookup(namesRef, PDFDict);
  if (!namesDict || !namesDict.has(PDFName.of("EmbeddedFiles"))) return 0;
  if (remove) namesDict.delete(PDFName.of("EmbeddedFiles"));
  return 1;
}

function hasMetadata(doc) {
  return Boolean(doc.getTitle() || doc.getAuthor() || doc.getSubject() || doc.getKeywords() || doc.getCreator() || doc.getProducer());
}

function stripMetadata(doc) {
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setCreator("");
  doc.setProducer("");
  doc.setModificationDate(new Date());
  try {
    doc.catalog.delete(PDFLib.PDFName.of("Metadata"));
  } catch (e) { /* no XMP stream present, nothing to remove */ }
}

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  try {
    currentBytes = new Uint8Array(await pdf.arrayBuffer());
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const scriptCount = walkScriptsAndActions(doc, { remove: false });
    const fileCount = walkEmbeddedFiles(doc, { remove: false });
    const metaFound = hasMetadata(doc);
    const parts = [];
    parts.push(scriptCount > 0 ? `${scriptCount} script/auto-action item(s)` : "no scripts or auto-actions");
    parts.push(fileCount > 0 ? "embedded file attachments" : "no embedded file attachments");
    parts.push(metaFound ? "author/title metadata" : "no author/title metadata");
    scanSummary.textContent = `Found: ${parts.join(", ")}.`;
    editor.style.display = "block";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  if (!optScripts.checked && !optFiles.checked && !optMetadata.checked) {
    setStatus(statusEl, "Tick at least one option to sanitise.", "error");
    statusEl.classList.add("visible");
    return;
  }
  runBtn.disabled = true;
  setStatus(statusEl, "Sanitising…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const removedParts = [];

    if (optScripts.checked) {
      const n = walkScriptsAndActions(doc, { remove: true });
      if (n > 0) removedParts.push(`${n} script/action item(s)`);
    }
    if (optFiles.checked) {
      const n = walkEmbeddedFiles(doc, { remove: true });
      if (n > 0) removedParts.push("embedded file attachments");
    }
    if (optMetadata.checked) {
      if (hasMetadata(doc)) removedParts.push("metadata");
      stripMetadata(doc);
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-sanitized.pdf`);
    setStatus(statusEl, removedParts.length > 0
      ? `Sorted — removed ${removedParts.join(", ")} (${formatBytes(blob.size)}).`
      : `Sorted — nothing to remove, saved a clean copy (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
