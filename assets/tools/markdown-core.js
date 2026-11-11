// Convert to Markdown: the parts that turn data into Markdown text, kept apart from the page so they can be tested.
// No DOM and no libraries in here. The page reads the file (PDF, Word, Excel, ZIP and so on) and passes plain data in.

// What the tool reads, by file extension. `kind` is how the page handles it.
export const FORMATS = [
  { kind: "pdf", label: "PDF", exts: ["pdf"] },
  { kind: "docx", label: "Word", exts: ["docx"] },
  { kind: "pptx", label: "PowerPoint", exts: ["pptx"] },
  { kind: "xlsx", label: "Excel", exts: ["xlsx", "xlsm", "xls", "ods"] },
  { kind: "csv", label: "CSV and TSV", exts: ["csv", "tsv"] },
  { kind: "html", label: "HTML", exts: ["html", "htm", "xhtml"] },
  { kind: "epub", label: "EPUB", exts: ["epub"] },
  { kind: "rtf", label: "Rich Text", exts: ["rtf"] },
  { kind: "json", label: "JSON", exts: ["json"] },
  { kind: "xml", label: "XML", exts: ["xml"] },
  { kind: "text", label: "Plain text", exts: ["txt", "text", "log"] },
  { kind: "zip", label: "ZIP", exts: ["zip"] },
];

export const extensionOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

export function detectFormat(name) {
  const ext = extensionOf(name);
  return FORMATS.find((f) => f.exts.includes(ext))?.kind || null;
}

// ---------------------------------------------------------------- small pieces

const normaliseNewlines = (s) => String(s).replace(/\r\n?/g, "\n");

// A code fence long enough that nothing inside the code can close it early.
export function fence(code, lang = "") {
  const longest = Math.max(0, ...(code.match(/`+/g) || []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${code.replace(/\n+$/, "")}\n${ticks}`;
}

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const lower = e.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower[1] === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// ---------------------------------------------------------------- tables

const cellText = (v) => String(v ?? "").replace(/\r\n?|\n/g, "<br>").replace(/\|/g, "\\|").trim();

// Rows of cells to a Markdown table. The first row becomes the header. Rows and columns with nothing in them at the end are
// dropped, short rows are padded, and a table longer than maxRows is cut with a note saying so.
export function tableToMarkdown(rows, { maxRows = Infinity } = {}) {
  const grid = rows.map((r) => r.map(cellText));
  while (grid.length && grid[grid.length - 1].every((c) => c === "")) grid.pop();
  if (!grid.length) return "";
  let width = Math.max(...grid.map((r) => r.length));
  while (width > 1 && grid.every((r) => (r[width - 1] ?? "") === "")) width--;
  const total = grid.length;
  const shown = grid.slice(0, Math.max(2, maxRows + 1)); // the header row does not count against the limit
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const out = [line(shown[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...shown.slice(1).map(line)];
  if (shown.length < total) out.push("", `*Showing the first ${(shown.length - 1).toLocaleString("en-AU")} of ${(total - 1).toLocaleString("en-AU")} rows.*`);
  return out.join("\n");
}

// Worksheets as [{ name, rows }] to one section each.
export function sheetsToMarkdown(sheets, opts) {
  const parts = [];
  for (const { name, rows } of sheets) {
    const table = tableToMarkdown(rows, opts);
    if (table) parts.push(`## ${name}\n\n${table}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- CSV, TSV, JSON, XML, text

// Comma, semicolon or tab, whichever the first line uses most outside quotes (Excel in many countries saves CSV with semicolons).
export function detectDelimiter(text) {
  const first = text.replace(/^﻿/, "").split(/\r\n?|\n/, 1)[0];
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

// Quoted fields can hold the delimiter, line breaks and "" for a quote mark.
export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\r") { /* the \n that follows ends the row; a lone \r is dropped */ }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export const csvToMarkdown = (text, opts) => tableToMarkdown(parseDelimited(text), opts);

export function jsonToMarkdown(text) {
  let value;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new Error("that isn't valid JSON");
  }
  return fence(JSON.stringify(value, null, 2), "json");
}

export const xmlToMarkdown = (text) => fence(normaliseNewlines(text).replace(/^﻿/, "").trim(), "xml");

export const textToMarkdown = (text) => normaliseNewlines(text).replace(/^﻿/, "").replace(/[ \t]+$/gm, "").trim();

// ---------------------------------------------------------------- PowerPoint

// A .pptx is a ZIP of XML files. `files` is the unzipped result: { "ppt/slides/slide1.xml": Uint8Array, ... }.
// Reads each slide's title, text, bullets (with their depth), tables, picture descriptions and speaker notes.

const utf8 = (bytes) => new TextDecoder("utf-8").decode(bytes);
const attr = (tag, name) => decodeEntities((new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1] ?? "");

// The text of one paragraph: its runs joined, with line breaks as spaces.
function paragraphText(xml) {
  return decodeEntities(
    xml.replace(/<a:br\s*\/?>/g, " ").replace(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:t\s*\/>|<[^>]+>/g, (m, t) => (t === undefined ? "" : t)),
  ).replace(/\s+/g, " ").trim();
}

const paragraphsOf = (xml) => (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g) || []);

function tableRows(xml) {
  return (xml.match(/<a:tr[\s>][\s\S]*?<\/a:tr>/g) || []).map((tr) =>
    (tr.match(/<a:tc[\s>][\s\S]*?<\/a:tc>/g) || []).map((tc) => paragraphsOf(tc).map(paragraphText).filter(Boolean).join("\n")),
  );
}

// One shape, picture or table frame to Markdown lines, plus whether it is the slide's title.
function shapeToMarkdown(xml) {
  if (xml.startsWith("<p:graphicFrame")) {
    const table = tableToMarkdown(tableRows(xml));
    return { lines: table ? [table] : [], title: "" };
  }
  if (xml.startsWith("<p:pic")) {
    const alt = attr(/<p:cNvPr\b[^>]*>/.exec(xml)?.[0] || "", "descr");
    return { lines: alt ? [`*Picture: ${alt}*`] : [], title: "" };
  }
  const ph = /<p:ph\b[^>]*>/.exec(xml)?.[0] || "";
  const phType = attr(ph, "type");
  if (["sldNum", "dt", "ftr", "hdr"].includes(phType)) return { lines: [], title: "" };
  const isTitle = phType === "title" || phType === "ctrTitle";
  const texts = paragraphsOf(xml).map((p) => ({
    text: paragraphText(p),
    level: Number(attr(/<a:pPr\b[^>]*>/.exec(p)?.[0] || "", "lvl")) || 0,
    bullet: /<a:bu(?:Char|AutoNum)\b/.test(p),
  })).filter((p) => p.text);
  if (isTitle) return { lines: [], title: texts.map((p) => p.text).join(" ") };
  const inBody = ph !== "" && phType !== "subTitle"; // body placeholders are bulleted by the slide's layout
  const blocks = []; // a run of list items is one block; any other paragraph is its own
  let list = null;
  for (const p of texts) {
    if (p.bullet || inBody) {
      if (!list) blocks.push((list = []));
      list.push(`${"  ".repeat(p.level)}- ${p.text}`);
    } else {
      list = null;
      blocks.push(p.text);
    }
  }
  return { lines: blocks.map((b) => (Array.isArray(b) ? b.join("\n") : b)), title: "" };
}

const SHAPES = /<p:sp>[\s\S]*?<\/p:sp>|<p:sp\s[\s\S]*?<\/p:sp>|<p:pic>[\s\S]*?<\/p:pic>|<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g;

function resolveTarget(fromDir, target) {
  const parts = (target.startsWith("/") ? target.slice(1) : `${fromDir}/${target}`).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const relationships = (files, path) => {
  const rels = files[path] ? utf8(files[path]) : "";
  return (rels.match(/<Relationship\b[^>]*>/g) || []).map((tag) => ({ id: attr(tag, "Id"), type: attr(tag, "Type"), target: attr(tag, "Target") }));
};

// Slide paths in the order the presentation shows them (falling back to file-name order if the file does not say).
export function slidePaths(files) {
  const presentation = files["ppt/presentation.xml"] ? utf8(files["ppt/presentation.xml"]) : "";
  const byId = new Map(relationships(files, "ppt/_rels/presentation.xml.rels").map((r) => [r.id, r]));
  const ordered = (presentation.match(/<p:sldId\b[^>]*>/g) || [])
    .map((tag) => byId.get(attr(tag, "r:id")))
    .filter((r) => r && /\/slide$/.test(r.type))
    .map((r) => resolveTarget("ppt", r.target))
    .filter((p) => files[p]);
  if (ordered.length) return ordered;
  return Object.keys(files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
}

function notesFor(files, slidePath) {
  const dir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const relsPath = `${dir}/_rels/${slidePath.slice(slidePath.lastIndexOf("/") + 1)}.rels`;
  const rel = relationships(files, relsPath).find((r) => /\/notesSlide$/.test(r.type));
  const path = rel && resolveTarget(dir, rel.target);
  if (!path || !files[path]) return "";
  return (utf8(files[path]).match(SHAPES) || [])
    .filter((xml) => attr(/<p:ph\b[^>]*>/.exec(xml)?.[0] || "", "type") === "body")
    .flatMap((xml) => paragraphsOf(xml).map(paragraphText).filter(Boolean))
    .join("\n\n");
}

export function pptxToMarkdown(files) {
  const slides = slidePaths(files);
  if (!slides.length) throw new Error("no slides found, that isn't a PowerPoint file");
  return slides.map((path, i) => {
    const shapes = (utf8(files[path]).match(SHAPES) || []).map(shapeToMarkdown);
    const title = shapes.map((s) => s.title).find(Boolean);
    const notes = notesFor(files, path);
    return [
      `## ${title || `Slide ${i + 1}`}`,
      ...shapes.flatMap((s) => s.lines),
      ...(notes ? [`### Notes\n\n${notes}`] : []),
    ].join("\n\n");
  }).join("\n\n");
}

// ---------------------------------------------------------------- joining

// Several converted files (the contents of a ZIP) as one document, each under its own heading.
export function joinSections(items) {
  return items.map(({ name, markdown }) => `# ${name}\n\n${markdown}`).join("\n\n---\n\n");
}

export const countWords = (markdown) => (markdown.match(/\S*[\p{L}\p{N}]\S*/gu) || []).length; // table pipes and rules are not words
