import { loadPdfJsDoc, extractPdfPageTexts } from "/assets/tools/pdf-common.js";
import * as fflate from "/assets/vendor/fflate.min.js";
import { rtfToHtml } from "/assets/tools/rtf-to-html.js";
import {
  detectFormat, tableToMarkdown, sheetsToMarkdown, csvToMarkdown, jsonToMarkdown, xmlToMarkdown, textToMarkdown,
  pptxToMarkdown, joinSections, countWords,
} from "/assets/tools/markdown-core.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const pasteArea = document.getElementById("pasteArea");
const pasteConvertBtn = document.getElementById("pasteConvertBtn");
const editor = document.getElementById("editor");
const headingHint = document.getElementById("headingHint");
const keepImages = document.getElementById("keepImages");
const markdownOutput = document.getElementById("markdownOutput");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

pasteArea.setAttribute("data-placeholder", "Paste content here…");

const MAX_TABLE_ROWS = 5000; // a spreadsheet of 200,000 rows would freeze the page and not be much use as Markdown
const MAX_ZIP_BYTES = 300 * 1024 * 1024; // what a ZIP may unpack to; stops a tiny file that expands into gigabytes
const MAX_ZIP_FILES = 200;
const LABELS = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", xlsx: "Excel", csv: "CSV", html: "HTML", epub: "EPUB", rtf: "Rich Text", json: "JSON", xml: "XML", text: "text", zip: "ZIP" };

let source = null; // { name, bytes } of the file last converted, so changing an option can convert it again
const pdfPages = new WeakMap(); // reading a PDF is the slow part, so its pages are kept while its bytes are

// What a conversion leaves out or skips, shown to the visitor afterwards.
let notes;
const resetNotes = () => { notes = { images: 0, skipped: [], sheets: 0 }; };

// ---------------------------------------------------------------- reading

function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    return new TextDecoder("windows-1252").decode(bytes); // CSV saved by older Excel, and plenty of other old files
  }
}

// Turndown does not know tables, and Word and web pages are full of them.
function makeTurndown({ dropAllImages = false } = {}) {
  const td = new window.TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["script", "style", "noscript", "template", "title"]);
  td.addRule("table", {
    filter: "table",
    replacement: (content, node) => {
      const rows = Array.from(node.rows).map((tr) => Array.from(tr.cells).map((cell) => td.turndown(cell).replace(/\n+/g, "<br>")));
      const table = tableToMarkdown(rows, { maxRows: MAX_TABLE_ROWS });
      return table ? `\n\n${table}\n\n` : "";
    },
  });
  td.addRule("image", {
    filter: "img",
    replacement: (content, node) => {
      const src = node.getAttribute("src") || "";
      const embedded = src.startsWith("data:"); // Word saves pictures inside the file, which would make this a wall of text
      if (!src || dropAllImages || (embedded && !keepImages.checked)) {
        if (src || dropAllImages) notes.images++;
        return "";
      }
      const alt = (node.getAttribute("alt") || "").replace(/[\[\]\n]/g, " ").trim();
      return `![${alt}](${src.replace(/([<>() ])/g, (c) => (c === " " ? "%20" : `\\${c}`))})`;
    },
  });
  return td;
}

function htmlToMarkdown(html, opts) {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return makeTurndown(opts).turndown(body);
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

let xlsxLoading = null;
function loadSpreadsheetReader() {
  if (window.XLSX) return Promise.resolve();
  xlsxLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/vendor/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = () => { xlsxLoading = null; reject(new Error("the spreadsheet reader did not load, refresh the page and try again")); };
    document.head.append(script);
  });
  return xlsxLoading;
}

async function workbookToMarkdown(bytes) {
  await loadSpreadsheetReader();
  const workbook = window.XLSX.read(bytes, { type: "array" });
  const hidden = (workbook.Workbook?.Sheets || []).map((s) => s.Hidden);
  const sheets = [];
  workbook.SheetNames.forEach((name, i) => {
    if (hidden[i]) return; // hidden sheets are hidden for a reason
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
    sheets.push({ name, rows });
  });
  notes.sheets += sheets.length;
  const markdown = sheetsToMarkdown(sheets, { maxRows: MAX_TABLE_ROWS });
  if (!markdown) throw new Error("no data found in that spreadsheet");
  return markdown;
}

function resolvePath(baseDir, href) {
  const out = [];
  for (const part of (baseDir + href.split("#")[0]).split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function epubToMarkdown(zip) {
  const xml = (path) => new DOMParser().parseFromString(fflate.strFromU8(zip[path]), "application/xml");
  if (!zip["META-INF/container.xml"]) throw new Error("missing META-INF/container.xml, that's not a valid EPUB");
  const opfPath = xml("META-INF/container.xml").querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath || !zip[opfPath]) throw new Error("could not find the book's content file");
  const opf = xml(opfPath);
  const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map();
  opf.querySelectorAll("manifest item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, { path: resolvePath(baseDir, decodeURIComponent(href)), type: item.getAttribute("media-type") || "" });
  });
  const chapters = [];
  opf.querySelectorAll("spine itemref").forEach((ref) => {
    const entry = manifest.get(ref.getAttribute("idref"));
    if (entry && /html|xml/.test(entry.type) && zip[entry.path]) chapters.push(entry.path);
  });
  if (!chapters.length) throw new Error("no readable chapters found in the spine");
  const title = opf.querySelector("metadata title")?.textContent?.trim();
  const creator = opf.querySelector("metadata creator")?.textContent?.trim();
  const parts = [];
  if (title) parts.push(`# ${title}${creator ? `\n\n*${creator}*` : ""}`);
  for (const path of chapters) {
    const md = htmlToMarkdown(fflate.strFromU8(zip[path]), { dropAllImages: true }).trim(); // picture links would point inside the EPUB
    if (md) parts.push(md);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- one file

async function convertBytes(name, bytes, kind, depth = 0) {
  switch (kind) {
    case "pdf": {
      let pages = pdfPages.get(bytes);
      if (!pages) {
        const doc = await loadPdfJsDoc(bytes.slice());
        pages = await extractPdfPageTexts(doc, (i, total) => setStatus(statusEl, `Reading ${depth ? `${name}, ` : ""}page ${i} of ${total}…`, ""));
        pdfPages.set(bytes, pages);
      }
      return pdfPagesToMarkdown(pages, headingHint.checked);
    }
    case "docx": {
      const result = await window.mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer });
      return htmlToMarkdown(result.value);
    }
    case "pptx": return pptxToMarkdown(fflate.unzipSync(bytes, { filter: (f) => /^ppt\/(slides\/|notesSlides\/|presentation\.xml$|_rels\/presentation\.xml\.rels$)/.test(f.name) })); // the slides, their notes and the order, not the pictures
    case "xlsx": return workbookToMarkdown(bytes);
    case "csv": return csvToMarkdown(decodeText(bytes), { maxRows: MAX_TABLE_ROWS });
    case "html": return htmlToMarkdown(decodeText(bytes));
    case "epub": return epubToMarkdown(fflate.unzipSync(bytes));
    case "rtf": {
      const text = decodeText(bytes);
      if (!/^\s*\{\\rtf/.test(text)) throw new Error("that doesn't look like an RTF file");
      return htmlToMarkdown(rtfToHtml(text));
    }
    case "json": return jsonToMarkdown(decodeText(bytes));
    case "xml": return xmlToMarkdown(decodeText(bytes));
    case "text": return textToMarkdown(decodeText(bytes));
    case "zip": return zipToMarkdown(bytes, depth);
    default: throw new Error("that file type isn't supported");
  }
}

async function zipToMarkdown(bytes, depth) {
  if (depth) throw new Error("a ZIP inside a ZIP is skipped");
  let total = 0;
  let count = 0;
  const entries = fflate.unzipSync(bytes, {
    filter: (f) => {
      if (f.name.endsWith("/") || /(^|\/)(__MACOSX|\.[^/]*)(\/|$)/.test(f.name)) return false; // folders, Mac leftovers and hidden files
      const kind = detectFormat(f.name);
      if (!kind || kind === "zip") { notes.skipped.push(f.name); return false; }
      total += f.originalSize;
      if (total > MAX_ZIP_BYTES || ++count > MAX_ZIP_FILES) throw new Error(`that ZIP holds more than ${MAX_ZIP_FILES} files or ${MAX_ZIP_BYTES / 1024 / 1024} MB once opened, so it was not unpacked`);
      return true;
    },
  });
  const items = [];
  for (const name of Object.keys(entries).sort()) {
    try {
      const markdown = (await convertBytes(name, entries[name], detectFormat(name), depth + 1)).trim();
      if (markdown) items.push({ name, markdown });
      else notes.skipped.push(name);
    } catch (err) {
      console.error(name, err);
      notes.skipped.push(`${name} (${err.message || "could not convert"})`);
    }
  }
  if (!items.length) throw new Error("nothing in that ZIP could be converted");
  return joinSections(items);
}

// ---------------------------------------------------------------- the page

function summary(kind, markdown) {
  const words = countWords(markdown);
  const bits = [`${words.toLocaleString("en-AU")} word${words === 1 ? "" : "s"}`];
  if (notes.sheets) bits.push(`${notes.sheets} sheet${notes.sheets === 1 ? "" : "s"}`);
  if (notes.images) bits.push(`${notes.images} image${notes.images === 1 ? "" : "s"} left out`);
  if (notes.skipped.length) bits.push(`${notes.skipped.length} file${notes.skipped.length === 1 ? "" : "s"} skipped (${notes.skipped.slice(0, 3).join(", ")}${notes.skipped.length > 3 ? ", …" : ""})`);
  return `Sorted, ${LABELS[kind] || "your content"} converted to Markdown: ${bits.join(", ")}.`;
}

function showResult(markdown) {
  markdownOutput.value = markdown;
  editor.style.display = "block";
}

async function runSource() {
  const kind = detectFormat(source.name);
  resetNotes();
  try {
    setStatus(statusEl, "Converting…", "");
    const markdown = (await convertBytes(source.name, source.bytes, kind)).trim();
    if (!markdown) throw new Error("no text found in that file");
    showResult(markdown);
    setStatus(statusEl, summary(kind, markdown), "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not convert that file: ${err.message || "unknown error"}`, "error");
  }
}

async function convertFile(file) {
  if (!detectFormat(file.name)) {
    setStatus(statusEl, "That file type isn't supported. Try PDF, Word, PowerPoint, Excel, CSV, HTML, EPUB, RTF, JSON, XML, text or ZIP.", "error");
    return;
  }
  source = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  await runSource();
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
    resetNotes();
    source = { name: "pasted-content" };
    const markdown = htmlToMarkdown(pasteArea.innerHTML);
    showResult(markdown);
    setStatus(statusEl, summary("html", markdown), "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not convert that content: ${err.message || "unknown error"}`, "error");
  }
});

// Changing an option converts the file again (reading a PDF is not repeated).
[headingHint, keepImages].forEach((box) => box.addEventListener("change", () => {
  if (source?.bytes) runSource();
  else if (source) pasteConvertBtn.click();
}));

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
  triggerDownload(blob, brandFilename("convert-to-markdown", stripExtension(source.name), "md"));
});

clearBtn.addEventListener("click", () => {
  source = null;
  editor.style.display = "none";
  fileInput.value = "";
  pasteArea.innerHTML = "";
  clearStatus(statusEl);
});
