// Excel to PDF page. The layout rules (widths, fitting, wrapping, pagination, print areas, wording) are in sheet-core.js;
// this file reads the workbook, draws the pages with pdf-lib and builds the page around them.
import { PDFLib, breathe } from "/assets/tools/pdf-common.js";
import { subsetTtf } from "/assets/tools/ttf-subset.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { summariseMissing } from "/assets/tools/docx-prep-core.js";
import { MARGINS, SIZE_LABELS, pageGeometry, excelWidthPt, naturalWidths, planColumns, wrapText, paginate, parsePrintArea, fillColour, buildNotes } from "/assets/tools/sheet-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const progressEl = $("progress");
const progressFill = $("progressFill");
const runBtn = $("runBtn");
const cancelBtn = $("cancelBtn");

const FONT_BASE = "/assets/vendor/docx/fonts/";
const BASE_SIZE = 10;
const state = { file: null, workbook: null, printAreas: new Map(), abort: null, result: null };

function setProgress(fraction) { setProgressBar(progressEl, progressFill, fraction); }
const show = (message, kind = "") => { setStatus(statusEl, message, kind); statusEl.classList.add("visible"); };

// ---------------------------------------------------------------- reading the file

async function handleFiles(files) {
  const file = files.find((f) => /\.(xlsx|xls|ods)$/i.test(f.name));
  if (!file) {
    show("Please choose an .xlsx, .xls or .ods file.", "error");
    return;
  }
  try {
    show("Reading the spreadsheet…");
    const data = new Uint8Array(await file.arrayBuffer());
    const workbook = window.XLSX.read(data, { type: "array", cellStyles: true });
    state.file = file;
    state.workbook = workbook;
    state.result = null;
    state.printAreas = readPrintAreas(workbook);
    buildSheetList(workbook);
    $("printAreaField").hidden = state.printAreas.size === 0;
    $("fileBar").textContent = `${file.name} · ${formatBytes(file.size)} · ${workbook.SheetNames.length} sheet${workbook.SheetNames.length === 1 ? "" : "s"}`;
    $("fileBar").hidden = false;
    $("results").classList.remove("visible");
    $("keepSorted").style.display = "none";
    document.querySelector(".related-tools-section").style.display = "";
    dropzone.classList.add("compact");
    clearStatus(statusEl);
    updateSummary();
  } catch (err) {
    console.error(err);
    show(`Could not read that file: ${err.message || "unknown error"}`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "excel-to-pdf", dropzone, onFiles: handleFiles });

// the print area Excel saved for each sheet, by sheet name
function readPrintAreas(workbook) {
  const found = new Map();
  for (const n of (workbook.Workbook && workbook.Workbook.Names) || []) {
    if (!/^_xlnm\.Print_Area$/i.test(n.Name || "")) continue;
    const area = parsePrintArea(n.Ref || "");
    const name = Number.isInteger(n.Sheet) ? workbook.SheetNames[n.Sheet] : area && area.sheet;
    if (area && name) found.set(name, area);
  }
  return found;
}

function buildSheetList(workbook) {
  const box = $("sheetList");
  box.innerHTML = "";
  workbook.SheetNames.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "qr-field qr-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `sheet-${i}`;
    input.checked = true;
    input.dataset.name = name;
    input.addEventListener("change", updateSummary);
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = name;
    row.append(input, label);
    box.appendChild(row);
  });
}

const chosenSheets = () => [...$("sheetList").querySelectorAll("input:checked")].map((i) => i.dataset.name);

for (const b of document.querySelectorAll("[data-sheets]")) {
  b.addEventListener("click", () => {
    for (const i of $("sheetList").querySelectorAll("input")) i.checked = b.dataset.sheets === "all";
    updateSummary();
  });
}

function updateSummary() {
  const n = chosenSheets().length;
  runBtn.disabled = !state.workbook || n === 0 || !!state.abort;
  $("summary").textContent = !state.workbook ? "Add a spreadsheet to begin." : n === 0 ? "Tick at least one sheet." : `${n} sheet${n === 1 ? "" : "s"}, ${SIZE_LABELS[$("pageSize").value]}.`;
  $("summary").classList.toggle("is-error", !!state.workbook && n === 0);
}
$("pageSize").addEventListener("change", updateSummary);
// what the closed Sheets row says
if (window.FGPAcc) {
  FGPAcc.set("sheets", () => {
    const all = $("sheetList").querySelectorAll("input").length;
    const on = chosenSheets().length;
    return !all ? "" : on === all ? (all === 1 ? "The sheet" : `All ${all} sheets`) : `${on} of ${all} sheets`;
  });
}

// ---------------------------------------------------------------- one sheet as plain data

const cellKey = (r, c) => window.XLSX.utils.encode_cell({ r, c });

// Everything the layout needs from a sheet, with hidden rows and columns taken out. `clean` makes text safe for the font.
function readSheet(name, ws, opts, clean, counts) {
  if (!ws || !ws["!ref"]) return null;
  let range = window.XLSX.utils.decode_range(ws["!ref"]);
  const area = opts.usePrintArea ? state.printAreas.get(name) : null;
  if (area) {
    range = { s: { r: area.r1, c: area.c1 }, e: { r: area.r2, c: area.c2 } };
    counts.printArea.push(name);
  }
  const cols = ws["!cols"] || [];
  const rows = ws["!rows"] || [];
  const colIdx = [];
  const rowIdx = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (!opts.hidden && cols[c] && cols[c].hidden) counts.hiddenCols++; else colIdx.push(c);
  }
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (!opts.hidden && rows[r] && rows[r].hidden) counts.hiddenRows++; else rowIdx.push(r);
  }
  const cell = (r, c, count = false) => {
    const x = ws[cellKey(r, c)];
    if (!x) return null;
    let text = x.t === "z" ? "" : x.w !== undefined ? String(x.w) : x.v !== undefined && x.v !== null ? String(x.v) : "";
    if (count && x.f && x.t === "z") counts.noValue++; // a formula that was never calculated and saved
    text = clean(text);
    const fill = x.s && x.s.patternType === "solid" && x.s.fgColor ? fillColour(x.s.fgColor.rgb) : null;
    const link = x.l && x.l.Target && /^(https?:|mailto:|tel:)/i.test(x.l.Target) ? x.l.Target : null;
    return text || fill || (x.f && x.t === "z") ? { text, num: x.t === "n" || x.t === "d", fill, link } : null;
  };
  // leave out the empty rows and columns at the end that Excel keeps because they were once formatted
  const has = (r, c) => !!cell(r, c);
  if (!area) {
    while (rowIdx.length && !colIdx.some((c) => has(rowIdx[rowIdx.length - 1], c))) rowIdx.pop();
    while (colIdx.length && !rowIdx.some((r) => has(r, colIdx[colIdx.length - 1]))) colIdx.pop();
  }
  if (!rowIdx.length || !colIdx.length) return null;
  const cells = rowIdx.map((r) => colIdx.map((c) => cell(r, c, true)));
  const rpos = new Map(rowIdx.map((r, i) => [r, i]));
  const cpos = new Map(colIdx.map((c, i) => [c, i]));
  // merged cells, in positions among the visible rows and columns
  const merges = new Map(); // "row,col" of the top-left -> { rs, cs }
  const covered = new Set();
  for (const m of ws["!merges"] || []) {
    const rs = rowIdx.filter((r) => r >= m.s.r && r <= m.e.r).map((r) => rpos.get(r));
    const cs = colIdx.filter((c) => c >= m.s.c && c <= m.e.c).map((c) => cpos.get(c));
    if (!rs.length || !cs.length || (rs.length === 1 && cs.length === 1)) continue;
    // the top-left cell of the merge must be visible, or the text would be nowhere
    if (!rpos.has(m.s.r) || !cpos.has(m.s.c)) continue;
    merges.set(`${rs[0]},${cs[0]}`, { rs: rs.length, cs: cs.length });
    for (const r of rs) for (const c of cs) if (r !== rs[0] || c !== cs[0]) covered.add(`${r},${c}`);
  }
  return {
    name,
    cells,
    merges,
    covered,
    excelWidths: colIdx.map((c) => excelWidthPt(cols[c] || {})),
    excelHeights: rowIdx.map((r) => (rows[r] && Number.isFinite(rows[r].hpt) ? rows[r].hpt : null)),
  };
}

// ---------------------------------------------------------------- fonts

async function loadFont(file) {
  const bytes = await (await fetch(`${FONT_BASE}${file}.ttf`)).arrayBuffer();
  return { bytes, parsed: window.fontkit.create(new Uint8Array(bytes)) };
}

// ---------------------------------------------------------------- drawing

const grey = PDFLib.rgb(0.45, 0.45, 0.45);
const lineGrey = PDFLib.rgb(0.62, 0.62, 0.62);
const black = PDFLib.rgb(0, 0, 0);

// Lays out one sheet and draws it. Returns the pages it added and what it had to do to make it fit.
async function drawSheet(pdf, fonts, sheet, o, tick) {
  const { regular, bold } = fonts;
  const margin = MARGINS[o.margin];
  const pad0 = 4;
  const rowsN = sheet.cells.length;
  const colsN = sheet.cells[0].length;
  const measure = (font, size) => (t) => font.widthOfTextAtSize(t, size);

  // widths the columns would like
  const contentWidths = Array.from({ length: colsN }, () => 0);
  if (!sheet.excelWidths.some(Boolean)) {
    const m = measure(regular, BASE_SIZE);
    for (let r = 0; r < Math.min(rowsN, 400); r++) {
      for (let c = 0; c < colsN; c++) {
        const cell = sheet.cells[r][c];
        if (!cell || !cell.text) continue;
        const line = cell.text.split(/\n/).reduce((a, b) => (b.length > a.length ? b : a), "").slice(0, 120);
        contentWidths[c] = Math.max(contentWidths[c], m(line) + pad0 * 2 + 2);
      }
    }
  }
  const natural = naturalWidths(sheet.excelWidths, contentWidths);
  const { pageW, pageH } = pageGeometry(o.size, o.orientation, natural.reduce((a, b) => a + b, 0), margin);
  const availW = pageW - 2 * margin;
  const plan = planColumns(natural, availW, o.wide);
  const scale = plan.scale;
  const size = Math.max(5, BASE_SIZE * scale);
  const pad = pad0 * scale;
  const lineH = size * 1.25;
  const topReserve = o.sheetName ? 18 : 0;
  const bottomReserve = o.pageNumbers ? 18 : 0;
  const bodyH = pageH - 2 * margin - topReserve - bottomReserve;
  const maxLines = Math.max(1, Math.floor((bodyH - 2 * pad) / lineH));
  const headerCount = Math.min(o.header, rowsN);
  const added = [];
  let clipped = 0;

  for (const [gi, group] of plan.groups.entries()) {
    const widths = group.map((i) => Math.min(natural[i] * scale, availW));
    const gx = [0];
    widths.forEach((w, k) => gx.push(gx[k] + w));
    const gpos = new Map(group.map((c, k) => [c, k]));
    // each cell's box in this group: how many group columns a merge covers here
    const spanW = (r, c, merge) => {
      if (!merge) return widths[gpos.get(c)];
      let w = 0;
      for (let k = c; k < c + merge.cs; k++) if (gpos.has(k)) w += widths[gpos.get(k)];
      return w;
    };

    // row heights, which depend on the widths of this group
    const lines = new Map();
    const heights = [];
    for (let r = 0; r < rowsN; r++) {
      if (r % 200 === 0) await tick();
      let h = 0;
      for (const c of group) {
        const cell = sheet.cells[r][c];
        if (!cell || !cell.text || sheet.covered.has(`${r},${c}`)) continue;
        const merge = sheet.merges.get(`${r},${c}`);
        const w = spanW(r, c, merge) - 2 * pad;
        const font = r < headerCount ? bold : regular;
        let ls = wrapText(cell.text, Math.max(w, 1), measure(font, size));
        if (ls.length > maxLines) { ls = ls.slice(0, maxLines); clipped++; }
        lines.set(`${r},${c}`, ls);
        if (!merge || merge.rs === 1) h = Math.max(h, ls.length * lineH + 2 * pad);
      }
      const set = sheet.excelHeights[r] ? sheet.excelHeights[r] * scale : 0;
      heights.push(Math.min(bodyH, Math.max(h, set, lineH + 2 * pad)));
    }

    const pages = paginate(heights, bodyH, headerCount);
    for (const [pi, pg] of pages.entries()) {
      await tick();
      const page = pdf.addPage([pageW, pageH]);
      added.push({ page, label: sheet.name + (plan.groups.length > 1 ? ` (columns, part ${gi + 1} of ${plan.groups.length})` : ""), pw: pageW });
      const x0 = margin;
      let y = pageH - margin - topReserve;
      const order = pg.repeat ? [...Array.from({ length: headerCount }, (_, i) => i), ...pg.rows] : pg.rows;
      const inPage = new Map(order.map((r, i) => [r, i]));
      for (const r of order) {
        const h = heights[r];
        const isHeader = r < headerCount;
        group.forEach((c, k) => {
          const merge = sheet.merges.get(`${r},${c}`);
          if (sheet.covered.has(`${r},${c}`)) return;
          const cell = sheet.cells[r][c];
          let w = spanW(r, c, merge);
          let boxH = h;
          if (merge && merge.rs > 1) {
            boxH = 0;
            for (let rr = r; rr < r + merge.rs; rr++) if (inPage.has(rr) && inPage.get(rr) === inPage.get(r) + (rr - r)) boxH += heights[rr];
          }
          const x = x0 + gx[k];
          const fill = cell && cell.fill ? PDFLib.rgb(cell.fill.r, cell.fill.g, cell.fill.b) : isHeader ? PDFLib.rgb(0.93, 0.93, 0.9) : null;
          if (fill) page.drawRectangle({ x, y: y - boxH, width: w, height: boxH, color: fill });
          if (o.lines === "grid") page.drawRectangle({ x, y: y - boxH, width: w, height: boxH, borderColor: lineGrey, borderWidth: 0.4 });
          else if (o.lines === "rows") page.drawLine({ start: { x, y: y - boxH }, end: { x: x + w, y: y - boxH }, thickness: 0.4, color: lineGrey });
          const ls = lines.get(`${r},${c}`);
          if (cell && ls) {
            const font = isHeader ? bold : regular;
            ls.forEach((line, li) => {
              if (!line) return;
              const lw = font.widthOfTextAtSize(line, size);
              const tx = cell.num && !isHeader ? x + w - pad - lw : x + pad;
              page.drawText(line, { x: Math.max(x + 1, tx), y: y - pad - size * 0.9 - li * lineH, size, font, color: black });
            });
            if (cell.link) {
              const annot = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y - boxH, x + w, y], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFLib.PDFString.of(cell.link) } });
              page.node.addAnnot(pdf.context.register(annot));
            }
          }
        });
        y -= h;
      }
    }
  }
  return { added, shrunk: scale < 0.999 && plan.groups.length === 1, split: plan.groups.length > 1, clipped };
}

// ---------------------------------------------------------------- the conversion

async function convert(signal) {
  const checkpoint = async () => { await breathe(); if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  const o = {
    size: $("pageSize").value,
    orientation: $("orientation").value,
    margin: $("margin").value,
    wide: $("wide").value,
    header: Number($("header").value),
    lines: $("lines").value,
    hidden: $("hidden").checked,
    usePrintArea: !$("printAreaField").hidden && $("printArea").checked,
    sheetName: $("sheetName").checked,
    pageNumbers: $("pageNumbers").checked,
  };
  show("Loading the font…");
  const [reg, bld] = await Promise.all([loadFont("LiberationSans-Regular"), loadFont("LiberationSans-Bold")]);
  await checkpoint();

  // read the sheets, making their text safe for the font and noting which characters are used
  const used = new Set([..." 0123456789Page of…()-,"]);
  const missing = [];
  const clean = (text) => {
    let out = "";
    for (const ch of text.replace(/\t/g, " ")) {
      if (ch === "\n" || ch === "\r") { out += "\n"; continue; }
      if (/\s/.test(ch)) { out += " "; continue; }
      if (reg.parsed.hasGlyphForCodePoint(ch.codePointAt(0))) { out += ch; used.add(ch); } else missing.push(ch);
    }
    return out.replace(/\r/g, "").trim();
  };
  const counts = { hiddenRows: 0, hiddenCols: 0, noValue: 0, printArea: [], shrunk: [], split: [], empty: [], missing: "" };
  const sheets = [];
  show("Reading the sheets…");
  for (const name of chosenSheets()) {
    await checkpoint();
    const sheet = readSheet(name, state.workbook.Sheets[name], o, clean, counts);
    if (sheet) sheets.push(sheet); else counts.empty.push(name);
  }
  if (!sheets.length) throw new Error("the sheets you chose have nothing to show");
  for (const ch of state.file.name) if (reg.parsed.hasGlyphForCodePoint(ch.codePointAt(0))) used.add(ch);
  for (const s of sheets) for (const ch of s.name) if (reg.parsed.hasGlyphForCodePoint(ch.codePointAt(0))) used.add(ch);

  // embed only the letters that are used
  show("Building the PDF…");
  const pdf = await PDFLib.PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  const embed = async (f) => {
    const ids = new Set();
    for (const ch of used) ids.add(f.parsed.glyphForCodePoint(ch.codePointAt(0)).id);
    return pdf.embedFont(subsetTtf(f.bytes, ids), { subset: false });
  };
  const fonts = { regular: await embed(reg), bold: await embed(bld) };

  const all = [];
  let done = 0;
  const totalRows = sheets.reduce((n, s) => n + s.cells.length, 0);
  for (const sheet of sheets) {
    await checkpoint();
    show(`Laying out ${sheet.name}…`);
    const r = await drawSheet(pdf, fonts, sheet, o, async () => { setProgress(Math.min(0.95, done / totalRows)); await checkpoint(); });
    done += sheet.cells.length;
    if (r.shrunk) counts.shrunk.push(sheet.name);
    if (r.split) counts.split.push(sheet.name);
    all.push(...r.added);
  }

  // the foot of each page, now that the number of pages is known
  if (o.sheetName || o.pageNumbers) {
    const margin = MARGINS[o.margin];
    all.forEach(({ page, label, pw }, i) => {
      const ph = page.getHeight();
      if (o.sheetName) page.drawText(label, { x: margin, y: ph - margin - 9, size: 9, font: fonts.bold, color: grey });
      if (o.pageNumbers) {
        const right = `Page ${i + 1} of ${all.length}`;
        page.drawText(right, { x: pw - margin - fonts.regular.widthOfTextAtSize(right, 8), y: margin - 4, size: 8, font: fonts.regular, color: grey });
        const name = state.file.name.replace(/[^\x20-\x7E -ɏ]/g, "").slice(0, 60);
        if (name) page.drawText(name, { x: margin, y: margin - 4, size: 8, font: fonts.regular, color: grey });
      }
    });
  }
  counts.missing = summariseMissing(missing);
  pdf.setTitle(stripExtension(state.file.name));
  pdf.setCreator("Fair Go PDF");
  pdf.setProducer("Fair Go PDF");
  show("Saving…");
  await checkpoint();
  const bytes = await pdf.save();
  return { bytes, pages: all.length, notes: buildNotes(counts) };
}

function list(title, items) {
  if (!items.length) return null;
  const box = document.createElement("div");
  const h = document.createElement("h3");
  h.className = "note-title";
  h.textContent = title;
  const ul = document.createElement("ul");
  ul.className = "note-list";
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text.charAt(0).toUpperCase() + text.slice(1) + ".";
    ul.appendChild(li);
  }
  box.append(h, ul);
  return box;
}

runBtn.addEventListener("click", async () => {
  if (!state.workbook || state.abort) return;
  const job = new AbortController();
  state.abort = job;
  const file = state.file;
  runBtn.disabled = true;
  cancelBtn.hidden = false;
  cancelBtn.disabled = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  setProgress(0);
  try {
    const { bytes, pages, notes } = await convert(job.signal);
    if (file !== state.file) return; // another file was added meanwhile
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("excel-to-pdf", safeBaseName(stripExtension(file.name), "spreadsheet"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    $("resultTotal").textContent = `${pages} page${pages === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    const box = $("noteLists");
    box.innerHTML = "";
    for (const s of [list("Changed to fit", notes.adjusted), list("Not carried over", notes.lost)]) if (s) box.appendChild(s);
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "excel-to-pdf",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    show(`Sorted, a ${pages}-page PDF (${formatBytes(blob.size)}) is ready.`, "success");
  } catch (err) {
    if (err.name === "AbortError") {
      show("Cancelled. Nothing was changed.");
    } else {
      console.error(err);
      show(`Something went wrong: ${err.message || "unknown error"}`, "error");
    }
  } finally {
    setProgress(null);
    cancelBtn.hidden = true;
    if (state.abort === job) state.abort = null;
    updateSummary();
  }
});

cancelBtn.addEventListener("click", () => {
  if (!state.abort) return;
  cancelBtn.disabled = true;
  show("Cancelling…");
  state.abort.abort();
});

$("downloadBtn").addEventListener("click", () => {
  if (state.result) triggerDownload(state.result.blob, state.result.outName);
});

updateSummary();
