import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const label = document.getElementById("label");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const checkListEl = document.getElementById("checkList");

let currentFile = null;

initDropzone(dropzone, fileInput, (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) return;
  currentFile = pdf;
  label.textContent = pdf.name;
  runBtn.disabled = false;
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  label.textContent = "Choose a PDF";
  fileInput.value = "";
  runBtn.disabled = true;
  resultsEl.style.display = "none";
  checkListEl.innerHTML = "";
  clearStatus(statusEl);
});

// A PDF string entry (/Lang, form field tooltips, …) can arrive as a
// PDFString, a PDFHexString, or occasionally something already string-like.
// decodeText() handles both string encodings PDF allows; fall back to a
// plain toString() for anything else rather than throwing.
function decodePdfText(obj) {
  if (!obj) return "";
  if (typeof obj.decodeText === "function") {
    try {
      return obj.decodeText();
    } catch (e) {
      /* fall through to toString below */
    }
  }
  return String(obj).replace(/^\(|\)$/g, "");
}

// Walks the structure tree looking for /Figure tags, counting how many
// carry an /Alt attribute. Struct trees are recursive and their /K (kids)
// entry can be a single item, an array, a plain integer (a marked-content
// reference, not a further element), or missing entirely, so this stays
// defensive throughout rather than assuming a clean shape.
function countFigureAltText(doc) {
  const { PDFName, PDFDict, PDFArray, PDFRef } = PDFLib;
  let figures = 0;
  let missingAlt = 0;
  const rootRef = doc.catalog.get(PDFName.of("StructTreeRoot"));
  if (!rootRef) return { figures, missingAlt };
  const root = doc.context.lookup(rootRef, PDFDict);
  if (!root) return { figures, missingAlt };

  const seen = new Set();
  const walk = (node) => {
    let dict = node instanceof PDFRef ? doc.context.lookup(node, PDFDict) : node;
    if (!dict || typeof dict.get !== "function" || seen.has(dict)) return;
    seen.add(dict);

    const type = dict.get(PDFName.of("S"));
    if (type && type.toString() === "/Figure") {
      figures++;
      if (!dict.get(PDFName.of("Alt"))) missingAlt++;
    }

    let kids = dict.get(PDFName.of("K"));
    if (!kids) return;
    if (kids instanceof PDFRef) kids = doc.context.lookup(kids);
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) walk(kids.get(i));
    } else {
      walk(kids);
    }
  };
  walk(root);
  return { figures, missingAlt };
}

async function runChecks(bytes) {
  const { PDFName, PDFDict, PDFBool } = PDFLib;
  const doc = await PDFLib.PDFDocument.load(bytes.slice());
  const catalog = doc.catalog;
  const results = [];

  // 1. Tagged PDF — the structural prerequisite everything else builds on.
  let tagged = false;
  const markInfoRef = catalog.get(PDFName.of("MarkInfo"));
  if (markInfoRef) {
    const markInfo = doc.context.lookup(markInfoRef, PDFDict);
    const marked = markInfo && markInfo.get(PDFName.of("Marked"));
    tagged = marked instanceof PDFBool ? marked.asBoolean() : String(marked) === "true";
  }
  const hasStructTree = catalog.has(PDFName.of("StructTreeRoot"));
  const isTagged = tagged && hasStructTree;
  results.push({
    title: "Tagged as an accessible document",
    pass: isTagged,
    detail: isTagged
      ? "This PDF is tagged, screen readers have a structure to follow."
      : "This PDF isn't tagged. Without a tag structure, a screen reader has no reliable way to read it, this is the single biggest accessibility gap a PDF can have.",
  });

  // 2. Document language.
  let lang = "";
  try {
    lang = decodePdfText(catalog.get(PDFName.of("Lang")));
  } catch (e) {
    /* leave lang empty if it can't be read */
  }
  results.push({
    title: "Document language set",
    pass: Boolean(lang),
    detail: lang
      ? `Set to "${lang}".`
      : "No document language is set, a screen reader may default to the wrong pronunciation.",
  });

  // 3. Document title.
  const title = (doc.getTitle() || "").trim();
  results.push({
    title: "Document title set",
    pass: Boolean(title),
    detail: title ? `Set to "${title}".` : "No title is set, a screen reader will read the filename instead.",
  });

  // 4. Image alt text — only meaningful once we know the doc is tagged.
  if (isTagged) {
    let figures = 0;
    let missingAlt = 0;
    try {
      ({ figures, missingAlt } = countFigureAltText(doc));
    } catch (e) {
      console.error(e);
    }
    results.push({
      title: "Images have alt text",
      pass: figures > 0 && missingAlt === 0,
      na: figures === 0,
      detail:
        figures === 0
          ? "No tagged images found to check."
          : missingAlt === 0
          ? `All ${figures} tagged image${figures === 1 ? "" : "s"} ${figures === 1 ? "has" : "have"} alt text.`
          : `${missingAlt} of ${figures} tagged image${figures === 1 ? "" : "s"} ${missingAlt === 1 ? "is" : "are"} missing alt text.`,
    });
  } else {
    results.push({
      title: "Images have alt text",
      pass: false,
      na: true,
      detail: "Can't check, this document isn't tagged.",
    });
  }

  // 5. Form field descriptions.
  try {
    const fields = doc.getForm().getFields();
    const missingTooltip = fields.filter((f) => !f.acroField.dict.get(PDFName.of("TU"))).length;
    results.push({
      title: "Form fields have descriptions",
      pass: fields.length > 0 && missingTooltip === 0,
      na: fields.length === 0,
      detail:
        fields.length === 0
          ? "No form fields in this document."
          : missingTooltip === 0
          ? `All ${fields.length} form field${fields.length === 1 ? "" : "s"} ${fields.length === 1 ? "has" : "have"} a description.`
          : `${missingTooltip} of ${fields.length} form field${fields.length === 1 ? "" : "s"} ${missingTooltip === 1 ? "is" : "are"} missing a description screen readers rely on.`,
    });
  } catch (e) {
    console.error(e);
    results.push({
      title: "Form fields have descriptions",
      pass: false,
      na: true,
      detail: "Couldn't read this document's form fields.",
    });
  }

  return results;
}

function renderResults(results) {
  checkListEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const r of results) {
    const item = document.createElement("div");
    item.className = "a11y-check-item " + (r.na ? "na" : r.pass ? "pass" : "fail");

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined a11y-check-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = r.na ? "help" : r.pass ? "check_circle" : "cancel";
    item.appendChild(icon);

    const body = document.createElement("div");
    body.className = "a11y-check-body";
    const h3 = document.createElement("h3");
    h3.textContent = r.title;
    const p = document.createElement("p");
    p.textContent = r.detail;
    body.appendChild(h3);
    body.appendChild(p);
    item.appendChild(body);

    frag.appendChild(item);
  }
  checkListEl.appendChild(frag);
}

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  resultsEl.style.display = "none";
  setStatus(statusEl, "Checking…", "");
  statusEl.classList.add("visible");

  try {
    const bytes = new Uint8Array(await currentFile.arrayBuffer());
    const results = await runChecks(bytes);
    renderResults(results);
    resultsEl.style.display = "block";
    // Deliberately not a "X of Y passed" score: an n/a result (e.g. no form
    // fields to check) isn't a pass, and folding it into a single number
    // would misrepresent what was actually verified. The checklist below
    // speaks for itself.
    setStatus(statusEl, "Checked — see the results below.", "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
