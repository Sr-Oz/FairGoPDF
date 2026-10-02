import { PDFLib } from "/assets/tools/pdf-common.js";

const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};
const MARGIN = 50;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const inputText = document.getElementById("inputText");
const pageSizeSelect = document.getElementById("pageSize");
const fontSizeInput = document.getElementById("fontSize");
const fontSizeVal = document.getElementById("fontSizeVal");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

fontSizeInput.addEventListener("input", () => { fontSizeVal.textContent = fontSizeInput.value; });

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt"));
  if (!file) {
    setStatus(statusEl, "Please choose a .txt file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  inputText.value = await file.text();
  clearStatus(statusEl);
});

clearBtn.addEventListener("click", () => {
  inputText.value = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

function wrapLine(line, font, fontSize, maxWidth) {
  if (line === "") return [""];
  const words = line.split(" ");
  const wrapped = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) wrapped.push(current);
    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      current = word;
    } else {
      // Single word longer than the line, hard-break it by character.
      let chunk = "";
      for (const ch of word) {
        const test = chunk + ch;
        if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
          chunk = test;
        } else {
          wrapped.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

runBtn.addEventListener("click", async () => {
  const text = inputText.value;
  if (!text.trim()) {
    setStatus(statusEl, "Paste or add some text first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building PDF…", "");
  statusEl.classList.add("visible");

  try {
    const [width, height] = PAGE_SIZES[pageSizeSelect.value];
    const fontSize = Number(fontSizeInput.value) || 12;
    const lineHeight = fontSize * 1.35;
    const maxWidth = width - MARGIN * 2;
    const linesPerPage = Math.max(1, Math.floor((height - MARGIN * 2) / lineHeight));

    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

    const allLines = text.split("\n").flatMap((line) => wrapLine(line, font, fontSize, maxWidth));

    for (let i = 0; i < allLines.length; i += linesPerPage) {
      const pageLines = allLines.slice(i, i + linesPerPage);
      const page = doc.addPage([width, height]);
      pageLines.forEach((line, idx) => {
        if (!line) return;
        page.drawText(line, {
          x: MARGIN,
          y: height - MARGIN - lineHeight * (idx + 1),
          size: fontSize,
          font,
          color: PDFLib.rgb(0, 0, 0),
        });
      });
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const pageCount = doc.getPageCount();
    const outName = brandFilename("text-to-pdf", "text", "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "text-to-pdf",
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
    setStatus(statusEl, `Sorted — created a ${pageCount}-page PDF (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
