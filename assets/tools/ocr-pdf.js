import { PDFLib, loadPdfJsDoc } from "/assets/tools/pdf-common.js";

const ENGINE = "/assets/vendor/ocr/";
const ENGINE_FILES = [
  { url: `${ENGINE}models/PP-OCRv6_small_det_onnx_infer.tar`, bytes: 9891840 },
  { url: `${ENGINE}models/PP-OCRv6_small_rec_onnx_infer.tar`, bytes: 21319680 },
  { url: `${ENGINE}ocr-worker.js`, bytes: 11341486 },
  { url: `${ENGINE}ort-wasm-simd-threaded.wasm`, bytes: 12361745 },
  { url: `${ENGINE}ort-wasm-simd-threaded.mjs`, bytes: 24274 },
];
const ENGINE_TOTAL = ENGINE_FILES.reduce((n, f) => n + f.bytes, 0);

const LONG_SIDE_PX = { fast: 1400, standard: 1800, high: 2400 };
const MIN_TEXT_CHARS = 25;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const fileSummary = document.getElementById("fileSummary");
const qualitySelect = document.getElementById("quality");
const optSkip = document.getElementById("optSkip");
const runBtn = document.getElementById("runBtn");
const cancelBtn = document.getElementById("cancelBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progressFill");

let currentFile = null;
let currentBytes = null;
let pageCount = 0;
let engine = null;
let worker = null;
let cancelled = false;
let rejectCancel = null;

function show(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

function releasePdf(doc) {
  if (!doc) return;
  if (doc.loadingTask && typeof doc.loadingTask.destroy === "function") doc.loadingTask.destroy();
  else if (typeof doc.destroy === "function") doc.destroy();
}

function setProgress(fraction) {
  progressEl.style.display = fraction === null ? "none" : "block";
  if (fraction !== null) progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function setBusy(busy) {
  runBtn.disabled = busy;
  clearBtn.disabled = busy;
  qualitySelect.disabled = busy;
  optSkip.disabled = busy;
  cancelBtn.style.display = busy ? "inline-flex" : "none";
}

function browserSupportsOcr() {
  return typeof WebAssembly === "object" && typeof OffscreenCanvas === "function" && typeof Worker === "function";
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    show("Please choose a PDF file.", "error");
    return;
  }
  if (!browserSupportsOcr()) {
    show("This browser can't run the OCR engine. Try a recent version of Chrome, Edge, Firefox or Safari.", "error");
    return;
  }
  try {
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const doc = await loadPdfJsDoc(bytes.slice());
    pageCount = doc.numPages;
    releasePdf(doc);
    currentFile = pdf;
    currentBytes = bytes;
    const long = pageCount > 30 ? " That's a lot of pages, so keep this tab open while it works." : "";
    fileSummary.textContent = `${pdf.name}: ${pageCount} page${pageCount > 1 ? "s" : ""}.${long}`;
    editor.style.display = "block";
    clearStatus(statusEl);
    setProgress(null);
  } catch (err) {
    console.error(err);
    if (err && err.name === "PasswordException") {
      show("This PDF is password protected. Unlock it first with the Unlock PDF tool, then come back.", "error");
    } else {
      show(`Could not read that PDF: ${err.message || "unknown error"}`, "error");
    }
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "ocr-pdf", dropzone, onFiles: handleFiles });
}

async function downloadEngineFiles() {
  let loaded = 0;
  for (const file of ENGINE_FILES) {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`could not load ${file.url.split("/").pop()} (${res.status})`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      setProgress(loaded / ENGINE_TOTAL);
      show(`Downloading the OCR engine, ${Math.round((loaded / ENGINE_TOTAL) * 100)}% (first time only)…`);
      if (cancelled) {
        await reader.cancel();
        throw new Error("cancelled");
      }
    }
  }
}

async function startEngine() {
  await downloadEngineFiles();
  show("Starting the OCR engine…");
  const { PaddleOCR } = await import(`${ENGINE}paddleocr-client.mjs`);
  return PaddleOCR.create({
    textDetectionModelName: "PP-OCRv6_small_det",
    textDetectionModelAsset: { url: `${ENGINE}models/PP-OCRv6_small_det_onnx_infer.tar` },
    textRecognitionModelName: "PP-OCRv6_small_rec",
    textRecognitionModelAsset: { url: `${ENGINE}models/PP-OCRv6_small_rec_onnx_infer.tar` },
    ortOptions: {
      backend: "wasm",
      wasmPaths: { mjs: `${ENGINE}ort-wasm-simd-threaded.mjs`, wasm: `${ENGINE}ort-wasm-simd-threaded.wasm` },
      numThreads: 1,
      simd: true,
    },
    worker: {
      createWorker: () => {
        worker = new Worker(`${ENGINE}ocr-worker.js`, { type: "module" });
        return worker;
      },
    },
  });
}

async function stopEngine() {
  const e = engine;
  engine = null;
  if (e) {
    try { await e.dispose(); } catch (err) { /* worker already gone */ }
  }
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

// A busy worker can't answer a polite dispose() until its current page finishes,
// so cancelling terminates it outright.
function abortEngine() {
  engine = null;
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

async function pageHasText(pdfJsPage) {
  const content = await pdfJsPage.getTextContent();
  let chars = 0;
  for (const item of content.items) {
    if (typeof item.str === "string") chars += item.str.trim().length;
    if (chars >= MIN_TEXT_CHARS) return true;
  }
  return false;
}

async function renderPage(pdfJsPage, longSidePx) {
  const base = pdfJsPage.getViewport({ scale: 1 });
  const scale = Math.min(4, longSidePx / Math.max(base.width, base.height));
  const viewport = pdfJsPage.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent keeps pdf.js off requestAnimationFrame, so rendering carries on when the visitor switches tabs.
  await pdfJsPage.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
  return { canvas, viewport };
}

function toWinAnsi(text, supported) {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (supported.has(ch.codePointAt(0))) {
      out += ch;
      continue;
    }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base && [...base].every((c) => supported.has(c.codePointAt(0))) ? base : "?";
  }
  return out;
}

function addInvisibleText(pdfLibPage, font, supported, items, viewport) {
  const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode,
    TextRenderingMode, setTextMatrix, showText, PDFOperator, PDFNumber } = PDFLib;
  const fontKey = pdfLibPage.node.newFontDictionary(font.name, font.ref);
  let drawn = 0;

  for (const item of items) {
    const text = toWinAnsi(item.text || "", supported).trim();
    if (!text || !item.poly || item.poly.length < 4) continue;

    let poly = item.poly.slice(0, 4);
    if (poly[1][0] < poly[0][0] && Math.abs(poly[1][0] - poly[0][0]) > Math.abs(poly[1][1] - poly[0][1])) {
      poly = [poly[2], poly[3], poly[0], poly[1]];
    }
    const [p0, p1, p2, p3] = poly.map(([x, y]) => viewport.convertToPdfPoint(x, y));
    const wx = p2[0] - p3[0];
    const wy = p2[1] - p3[1];
    const hx = p0[0] - p3[0];
    const hy = p0[1] - p3[1];
    const width = Math.hypot(wx, wy);
    const height = Math.hypot(hx, hy);
    if (width < 1 || height < 1) continue;

    const size = Math.max(2, height * 0.8);
    const natural = font.widthOfTextAtSize(text, size);
    if (!natural) continue;
    const scalePct = Math.min(500, Math.max(20, (width / natural) * 100));
    const ux = wx / width;
    const uy = wy / width;

    pdfLibPage.pushOperators(
      pushGraphicsState(),
      beginText(),
      setFontAndSize(fontKey, size),
      setTextRenderingMode(TextRenderingMode.Invisible),
      PDFOperator.of("Tz", [PDFNumber.of(scalePct)]),
      setTextMatrix(ux, uy, -uy, ux, p3[0] + hx * 0.2, p3[1] + hy * 0.2),
      showText(font.encodeText(text)),
      endText(),
      popGraphicsState()
    );
    drawn++;
  }
  return drawn;
}

function formatEta(seconds) {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds left`;
  const mins = Math.round(seconds / 60);
  return `about ${mins} minute${mins > 1 ? "s" : ""} left`;
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pageCount = 0;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
  setProgress(null);
  stopEngine();
});

cancelBtn.addEventListener("click", () => {
  cancelled = true;
  cancelBtn.disabled = true;
  show("Cancelling…");
  abortEngine();
  if (rejectCancel) rejectCancel(new Error("cancelled"));
});

runBtn.addEventListener("click", async () => {
  if (!currentBytes) return;
  cancelled = false;
  cancelBtn.disabled = false;
  const cancelPromise = new Promise((_, reject) => { rejectCancel = reject; });
  cancelPromise.catch(() => {});
  setBusy(true);
  setProgress(0);

  let pdfJsDoc = null;
  try {
    const longSide = LONG_SIDE_PX[qualitySelect.value] || LONG_SIDE_PX.standard;
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());

    const skip = new Set();
    if (optSkip.checked) {
      show("Checking which pages already have text…");
      for (let i = 1; i <= pdfJsDoc.numPages; i++) {
        if (await pageHasText(await pdfJsDoc.getPage(i))) skip.add(i);
      }
      if (skip.size === pdfJsDoc.numPages) {
        show("Every page already has selectable text, so there's nothing to do. Untick “Skip pages that already have text” to run OCR anyway.", "error");
        setProgress(null);
        return;
      }
    }

    const starting = startEngine();
    starting.catch(() => {});
    engine = await Promise.race([starting, cancelPromise]);
    if (cancelled) throw new Error("cancelled");

    const todo = [];
    for (let i = 1; i <= pdfJsDoc.numPages; i++) if (!skip.has(i)) todo.push(i);

    const results = new Map();
    const started = performance.now();
    for (let n = 0; n < todo.length; n++) {
      if (cancelled) throw new Error("cancelled");
      const pageNo = todo[n];
      const eta = n > 0 ? `, ${formatEta((((performance.now() - started) / n) * (todo.length - n)) / 1000)}` : "";
      show(`Reading page ${n + 1} of ${todo.length}${eta}…`);
      setProgress(n / todo.length);

      const { canvas, viewport } = await renderPage(await pdfJsDoc.getPage(pageNo), longSide);
      let result;
      try {
        [result] = await Promise.race([engine.predict(canvas), cancelPromise]);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (cancelled) throw new Error("cancelled");
      results.set(pageNo, { items: result.items, viewport });
    }
    setProgress(1);
    await stopEngine();

    show("Adding the text to your PDF…");
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const supported = new Set(font.getCharacterSet());
    const pages = doc.getPages();
    let recognised = 0;
    let lines = 0;
    for (const [pageNo, { items, viewport }] of results) {
      const drawn = addInvisibleText(pages[pageNo - 1], font, supported, items, viewport);
      if (drawn > 0) {
        recognised++;
        lines += drawn;
      }
    }

    if (recognised === 0) {
      show("No text was found on those pages, so there's nothing to add. Try “Sharper” quality, or check the scan is clear and upright.", "error");
      setProgress(null);
      return;
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("ocr-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "ocr-pdf",
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
    const skippedNote = skip.size ? `, skipped ${skip.size} page${skip.size > 1 ? "s" : ""} that already had text` : "";
    const blankNote = recognised < results.size ? `, ${results.size - recognised} had no readable text` : "";
    show(`Sorted — added searchable text to ${recognised} page${recognised > 1 ? "s" : ""} (${lines} lines${skippedNote}${blankNote}). ${formatBytes(blob.size)}.`, "success");
    setProgress(null);
  } catch (err) {
    if (cancelled || (err && err.message === "cancelled")) {
      show("Cancelled. Nothing was changed.");
    } else {
      console.error(err);
      show(`Something went wrong: ${err.message || "unknown error"}`, "error");
    }
    setProgress(null);
  } finally {
    releasePdf(pdfJsDoc);
    rejectCancel = null;
    await stopEngine();
    setBusy(false);
  }
});
