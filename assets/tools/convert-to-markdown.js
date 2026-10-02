import { loadPdfJsDoc, extractPdfPageTexts } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const pasteArea = document.getElementById("pasteArea");
const pasteConvertBtn = document.getElementById("pasteConvertBtn");
const editor = document.getElementById("editor");
const headingHint = document.getElementById("headingHint");
const markdownOutput = document.getElementById("markdownOutput");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

pasteArea.setAttribute("data-placeholder", "Paste content here…");

let currentFile = null;
let lastPdfPages = null;
let lastType = null;

function detectType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (name.endsWith(".html") || name.endsWith(".htm") || file.type === "text/html") return "html";
  return null;
}

function htmlToMarkdown(html) {
  const turndownService = new window.TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  return turndownService.turndown(html);
}

// Best-effort: PDFs don't store real document structure, so this reconstructs
// paragraphs from line breaks and guesses at headings/bullets from line shape.
function pdfPagesToMarkdown(pages, detectHeadings) {
  const blocks = [];
  for (const pageText of pages) {
    const rawLines = pageText.split("\n").map((l) => l.trim());
    let buffer = [];
    const flush = () => {
      if (buffer.length) {
        blocks.push(buffer.join(" "));
        buffer = [];
      }
    };
    for (const line of rawLines) {
      if (line === "") {
        flush();
        continue;
      }
      const bulletMatch = line.match(/^([•\-*]|\d+[.)])\s+(.*)/);
      if (bulletMatch) {
        flush();
        const marker = /^\d+[.)]/.test(bulletMatch[1]) ? bulletMatch[1].replace(")", ".") : "-";
        blocks.push(`${marker} ${bulletMatch[2]}`);
        continue;
      }
      buffer.push(line);
    }
    flush();
  }

  return blocks
    .map((block) => {
      if (/^([-*]|\d+\.)\s/.test(block)) return block;
      if (detectHeadings && block.length > 0 && block.length <= 70 && !/[.,;:]$/.test(block)) {
        return `## ${block}`;
      }
      return block;
    })
    .join("\n\n")
    .trim();
}

function showResult(markdown) {
  markdownOutput.value = markdown;
  editor.style.display = "block";
}

async function convertFile(file) {
  const type = detectType(file);
  if (!type) {
    setStatus(statusEl, "Please choose a PDF, Word (.docx) or HTML file.", "error");
    return;
  }
  currentFile = file;
  try {
    setStatus(statusEl, "Converting…", "");
    let markdown;
    if (type === "pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfJsDoc = await loadPdfJsDoc(bytes.slice());
      const pages = await extractPdfPageTexts(pdfJsDoc, (i, total) => {
        setStatus(statusEl, `Reading page ${i} of ${total}…`, "");
      });
      lastPdfPages = pages;
      lastType = "pdf";
      markdown = pdfPagesToMarkdown(pages, headingHint.checked);
    } else if (type === "docx") {
      const arrayBuffer = await file.arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });
      lastPdfPages = null;
      lastType = "docx";
      markdown = htmlToMarkdown(result.value);
    } else {
      const text = await file.text();
      lastPdfPages = null;
      lastType = "html";
      markdown = htmlToMarkdown(text);
    }
    showResult(markdown);
    setStatus(statusEl, "Sorted, converted to Markdown.", "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not convert that file: ${err.message || "unknown error"}`, "error");
  }
}

initDropzone(dropzone, fileInput, (files) => {
  if (files.length) convertFile(files[0]);
});

pasteConvertBtn.addEventListener("click", () => {
  if (!pasteArea.textContent.trim()) {
    setStatus(statusEl, "Paste something first.", "error");
    return;
  }
  try {
    const markdown = htmlToMarkdown(pasteArea.innerHTML);
    currentFile = { name: "pasted-content" };
    lastPdfPages = null;
    lastType = "html";
    showResult(markdown);
    setStatus(statusEl, "Sorted, converted to Markdown.", "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not convert that content: ${err.message || "unknown error"}`, "error");
  }
});

headingHint.addEventListener("change", () => {
  if (lastType === "pdf" && lastPdfPages) {
    markdownOutput.value = pdfPagesToMarkdown(lastPdfPages, headingHint.checked);
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(markdownOutput.value);
    setStatus(statusEl, "Copied to clipboard.", "success");
  } catch (err) {
    markdownOutput.select();
    setStatus(statusEl, "Couldn't access the clipboard automatically, the text is selected, press Ctrl/Cmd+C to copy.", "error");
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([markdownOutput.value], { type: "text/markdown" });
  triggerDownload(blob, brandFilename("convert-to-markdown", stripExtension(currentFile.name), "md"));
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  lastPdfPages = null;
  lastType = null;
  editor.style.display = "none";
  fileInput.value = "";
  pasteArea.innerHTML = "";
  clearStatus(statusEl);
});
