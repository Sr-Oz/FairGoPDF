import * as fflate from "/assets/vendor/fflate.min.js";
import { renderHtmlSectionsPdf } from "/assets/tools/doc-pdf-render.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const controls = document.getElementById("controls");
const actionsRow = document.getElementById("actionsRow");
const pageSizeSelect = document.getElementById("pageSize");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentSections = null;

function resolvePath(baseDir, href) {
  const parts = (baseDir + href).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function parseEpub(zipFiles) {
  const xmlParser = new DOMParser();
  const containerPath = "META-INF/container.xml";
  if (!zipFiles[containerPath]) throw new Error("missing META-INF/container.xml, that's not a valid EPUB");
  const containerXml = xmlParser.parseFromString(fflate.strFromU8(zipFiles[containerPath]), "application/xml");
  const opfPath = containerXml.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath || !zipFiles[opfPath]) throw new Error("could not find the book's content file");

  const opf = xmlParser.parseFromString(fflate.strFromU8(zipFiles[opfPath]), "application/xml");
  const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const manifest = new Map();
  opf.querySelectorAll("manifest item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") || "";
    if (id && href) manifest.set(id, { href: resolvePath(baseDir, href), mediaType });
  });

  const chapterHrefs = [];
  opf.querySelectorAll("spine itemref").forEach((itemref) => {
    const idref = itemref.getAttribute("idref");
    const entry = idref && manifest.get(idref);
    if (entry && /html|xml/.test(entry.mediaType) && zipFiles[entry.href]) chapterHrefs.push(entry.href);
  });
  if (!chapterHrefs.length) throw new Error("no readable chapters found in the spine");

  const title = opf.querySelector("metadata title")?.textContent?.trim();
  const creator = opf.querySelector("metadata creator")?.textContent?.trim();

  const sections = [];
  if (title) {
    sections.push({ html: `<h1>${escapeHtml(title)}</h1>${creator ? `<p>${escapeHtml(creator)}</p>` : ""}` });
  }
  chapterHrefs.forEach((href, i) => {
    const html = fflate.strFromU8(zipFiles[href]);
    sections.push({ html, pageBreakBefore: i > 0 || sections.length > 0 });
  });
  return sections;
}

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".epub"));
  if (!file) {
    setStatus(statusEl, "Please choose a .epub file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = file;
  try {
    setStatus(statusEl, "Reading ebook…", "");
    statusEl.classList.add("visible");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zipFiles = fflate.unzipSync(bytes);
    currentSections = parseEpub(zipFiles);
    controls.style.display = "flex";
    actionsRow.style.display = "flex";
    setStatus(statusEl, `Found ${currentSections.length} section${currentSections.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that file: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentSections = null;
  controls.style.display = "none";
  actionsRow.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentSections) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Building PDF…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await renderHtmlSectionsPdf(currentSections, pageSizeSelect.value);
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("epub-to-pdf", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "epub-to-pdf",
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
    setStatus(statusEl, `Sorted — created a ${doc.getPageCount()}-page PDF (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
