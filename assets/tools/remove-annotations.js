import { PDFLib } from "/assets/tools/pdf-common.js";

// Comments, highlights and markup — links and fillable form fields are left alone
// since removing those would break navigation and forms, not just clean up clutter.
const MARKUP_SUBTYPES = new Set([
  "Text", "FreeText", "Line", "Square", "Circle", "Polygon", "PolyLine",
  "Highlight", "Underline", "Squiggly", "StrikeOut", "Stamp", "Caret",
  "Ink", "Popup", "FileAttachment", "Sound", "Redact",
]);

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const scanSummary = document.getElementById("scanSummary");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

function walkMarkupAnnotations(doc, { remove }) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  let count = 0;
  for (const page of doc.getPages()) {
    const annotsRef = page.node.get(PDFName.of("Annots"));
    if (!annotsRef) continue;
    const annots = doc.context.lookup(annotsRef, PDFArray);
    if (!annots) continue;

    const kept = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const annotDict = doc.context.lookup(ref, PDFDict);
      const subtype = annotDict && annotDict.get(PDFName.of("Subtype"));
      const name = subtype ? subtype.toString().replace("/", "") : "";
      if (MARKUP_SUBTYPES.has(name)) {
        count++;
      } else {
        kept.push(ref);
      }
    }
    if (remove && count > 0) {
      if (kept.length === 0) {
        page.node.delete(PDFName.of("Annots"));
      } else {
        page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
      }
    }
  }
  return count;
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
    const count = walkMarkupAnnotations(doc, { remove: false });
    scanSummary.textContent = count > 0
      ? `Found ${count} comment/markup annotation${count > 1 ? "s" : ""} across this PDF.`
      : "No comments, highlights or markup found in this PDF.";
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
  runBtn.disabled = true;
  setStatus(statusEl, "Removing annotations…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const count = walkMarkupAnnotations(doc, { remove: true });
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-no-annotations.pdf`);
    setStatus(statusEl, count > 0
      ? `Sorted — removed ${count} annotation(s) (${formatBytes(blob.size)}).`
      : `Sorted — nothing to remove, saved a clean copy (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
