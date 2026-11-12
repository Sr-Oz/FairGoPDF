// Compress PDF page. The rules (what a picture is shrunk to, which ones are left alone, the levels to try for a size, the wording) are
// in compress-core.js; this file reads the PDF, changes it and builds the page around that.
//
// The default way makes the PDF smaller from the inside: each picture is found, shrunk to the sharpness asked for and saved again
// when that is clearly smaller, unused data is removed, and the remaining data is squeezed tighter. Text, fonts, links and forms are
// untouched. The other way, turning every page into a picture, is kept as a last resort for scans.
import { PDFLib, pdfjsLib, loadPdfJsDoc, renderPageToCanvasAtScale, breathe } from "/assets/tools/pdf-common.js";
import * as fflate from "/assets/vendor/fflate.min.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { getImageObject, imageToCanvas, canvasToBytes } from "/assets/tools/pdf-image-objects.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { PRESETS, SIZE_LEVELS, planImage, worthKeeping, targetBytes, describeSaving, breakdownLines, expectation } from "/assets/tools/compress-core.js";

const { Util, OPS } = pdfjsLib;
const { PDFName, PDFRef, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFNumber } = PDFLib;
const N = (s) => PDFName.of(s);

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const progressEl = $("progress");
const runBtn = $("runBtn");

const state = { file: null, run: null, result: null, generation: 0 };
class Stopped extends Error {}

function setProgress(f) { setProgressBar(progressEl, $("progressFill"), f); }
const say = (text, kind = "") => setStatus(statusEl, text, kind);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const check = (job) => { if (job.stopped) throw new Stopped(); };

// ---------------------------------------------------------------- where the space goes

// The bytes in a PDF by kind: pictures, fonts, page content and other data, and the structure that holds them together
function breakdown(doc, total) {
  const ctx = doc.context;
  const fontStreams = new Set();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    for (const key of ["FontFile", "FontFile2", "FontFile3"]) {
      const ref = obj.get(N(key));
      if (ref instanceof PDFRef) fontStreams.add(ref.tag);
    }
  }
  const parts = { Pictures: { bytes: 0, count: 0, noun: "picture" }, Fonts: { bytes: 0, count: 0, noun: "font" }, "Page content and other data": { bytes: 0, count: 0, noun: "" }, Metadata: { bytes: 0, count: 0, noun: "" }, Structure: { bytes: 0, count: 0, noun: "" } };
  let streams = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const len = obj.contents.length;
    streams += len;
    const sub = obj.dict.get(N("Subtype"));
    const type = obj.dict.get(N("Type"));
    const part = sub && String(sub) === "/Image" ? parts.Pictures : fontStreams.has(ref.tag) ? parts.Fonts : type && String(type) === "/Metadata" ? parts.Metadata : parts["Page content and other data"];
    part.bytes += len;
    if (part.noun) part.count++;
  }
  parts.Structure.bytes = Math.max(0, total - streams);
  return parts;
}

async function showInside(file, generation) {
  $("inside").hidden = true;
  try {
    const doc = await loadEditable(file);
    if (generation !== state.generation) return;
    const parts = breakdown(doc, file.size);
    $("fileBar").textContent = `${file.name} · ${plural(doc.getPageCount(), "page", "pages")} · ${formatBytes(file.size)}`;
    $("insideTotal").textContent = formatBytes(file.size);
    $("insideList").innerHTML = breakdownLines(parts, formatBytes).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    $("insideHint").textContent = expectation(parts, file.size);
    $("inside").hidden = false;
  } catch (err) {
    if (generation !== state.generation) return;
    if (err instanceof OpenProblem) say(err.message, "error");
    else console.error(err);
  }
}

// ---------------------------------------------------------------- the pictures

const refText = (ref) => /^(\d+)R(\d*)$/.exec(ref);
const refOf = (text) => { const m = refText(text); return m ? PDFRef.of(Number(m[1]), m[2] ? Number(m[2]) : 0) : null; };

// every picture the pages draw, once each, with the largest size it is drawn at on the page
async function scanImages(pj, job, progress) {
  const found = new Map();
  for (let n = 1; n <= pj.numPages; n++) {
    check(job);
    progress(n / pj.numPages);
    await breathe();
    const page = await pj.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let seq = -1; // which picture on the page this is, by order: the names pdf.js gives them change each time the page is read
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.paintImageXObject && typeof args[0] === "string") seq++;
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = Util.transform(ctm, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.paintImageXObject && typeof args[0] === "string") {
        const img = await getImageObject(page, args[0]);
        if (!img || !img.ref || !img.width || !img.height) continue;
        const m = Util.transform(viewport.transform, ctm);
        const dispW = Math.hypot(m[0], m[1]);
        const dispH = Math.hypot(m[2], m[3]);
        const e = found.get(img.ref) || { ref: img.ref, w: img.width, h: img.height, kind: img.kind === undefined ? 2 : img.kind, dispW: 0, dispH: 0, pageNo: n, seq };
        e.dispW = Math.max(e.dispW, dispW);
        e.dispH = Math.max(e.dispH, dispH);
        found.set(img.ref, e);
      }
    }
    page.cleanup();
  }
  return found;
}

// the colour space as written, and whether it is really print colours (an ICC profile with four channels)
function colourSpaceOf(ctx, dict) {
  const cs = dict.get(N("ColorSpace"));
  if (!cs) return "";
  let text = cs.toString();
  if (cs instanceof PDFArray && String(cs.get(0)) === "/ICCBased") {
    try {
      const profile = ctx.lookup(cs.get(1));
      const channels = profile && profile.dict && profile.dict.get(N("N"));
      if (channels && Number(String(channels)) === 4) text = "/DeviceCMYK";
    } catch (err) {
      // an unreadable profile is left as the ICC text
    }
  }
  return text;
}

async function shrinkPictures(doc, pj, level, job, progress, report) {
  const ctx = doc.context;
  const found = await scanImages(pj, job, (f) => progress(f * 0.3));
  const entries = [...found.values()];
  report.images.total = entries.length;
  const byPage = new Map();
  for (const e of entries) (byPage.get(e.pageNo) || byPage.set(e.pageNo, []).get(e.pageNo)).push(e);
  const skip = (why) => report.images.skipped.set(why, (report.images.skipped.get(why) || 0) + 1);
  let done = 0;
  for (const [pageNo, list] of byPage) {
    check(job);
    const page = await pj.getPage(pageNo);
    const again = await page.getOperatorList(); // loads the pictures again, so they can be read
    const names = [];
    for (let i = 0; i < again.fnArray.length; i++) if (again.fnArray[i] === OPS.paintImageXObject && typeof again.argsArray[i][0] === "string") names.push(again.argsArray[i][0]);
    for (const e of list) {
      check(job);
      progress(0.3 + 0.7 * (done++ / Math.max(1, entries.length)));
      await breathe();
      const ref = refOf(e.ref);
      const stream = ref && ctx.lookup(ref);
      if (!stream || !stream.contents || !stream.dict) { skip("could not be read"); continue; }
      const d = stream.dict;
      if (d.has(N("Decode"))) { skip("unusual"); continue; }
      const plan = planImage({
        w: e.w, h: e.h, dispW: e.dispW, dispH: e.dispH, kind: e.kind, colourSpace: colourSpaceOf(ctx, d),
        masked: d.has(N("SMask")) || d.has(N("Mask")), stencil: String(d.get(N("ImageMask"))) === "true",
      }, level);
      if (plan.action === "skip") { skip(plan.reason); continue; }
      const img = names[e.seq] ? await getImageObject(page, names[e.seq]) : null;
      const source = img && imageToCanvas(img);
      if (!source) { skip("could not be read"); continue; }
      let canvas = source;
      if (plan.scaled) {
        canvas = document.createElement("canvas");
        canvas.width = plan.width;
        canvas.height = plan.height;
        const c = canvas.getContext("2d");
        c.fillStyle = "#fff";
        c.fillRect(0, 0, plan.width, plan.height);
        c.imageSmoothingQuality = "high";
        c.drawImage(source, 0, 0, plan.width, plan.height);
      }
      const bytes = await canvasToBytes(canvas, "image/jpeg", level.quality);
      const old = stream.contents.length;
      if (worthKeeping(old, bytes.length)) {
        const dict = ctx.obj({ Type: "XObject", Subtype: "Image", Width: canvas.width, Height: canvas.height, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode", Length: bytes.length });
        ctx.assign(ref, PDFRawStream.of(dict, bytes));
        report.images.done++;
        report.images.saved += old - bytes.length;
        if (plan.scaled) report.images.scaled++;
      } else skip("already small");
      if (canvas !== source) canvas.width = canvas.height = 0;
      source.width = source.height = 0;
    }
    page.cleanup();
  }
}

// ---------------------------------------------------------------- clean-up

// everything the document can reach from its root; anything else is data nothing uses
function removeUnreachable(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean);
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (seen.has(obj.tag)) continue;
      seen.add(obj.tag);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFStream) stack.push(obj.dict);
    else if (obj instanceof PDFDict) { for (const [, v] of obj.entries()) stack.push(v); }
    else if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i)); }
  }
  let bytes = 0;
  const doomed = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) doomed.push([ref, obj]);
  for (const [ref, obj] of doomed) {
    bytes += (obj instanceof PDFRawStream ? obj.contents.length : 0) + 30;
    ctx.delete(ref);
  }
  return bytes;
}

function removeEditorData(doc) {
  let n = 0;
  for (const page of doc.getPages()) {
    for (const key of ["Thumb", "PieceInfo"]) if (page.node.has(N(key))) { page.node.delete(N(key)); n++; }
  }
  const root = doc.catalog;
  if (root.has(N("PieceInfo"))) { root.delete(N("PieceInfo")); n++; }
  return n;
}

function removeInfo(doc) {
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setCreator("");
  if (doc.catalog.has(N("Metadata"))) doc.catalog.delete(N("Metadata"));
}

// data with no compression gets it, and data compressed lightly is compressed harder
async function squeezeStreams(doc, job) {
  const ctx = doc.context;
  let saved = 0;
  let i = 0;
  const list = [...ctx.enumerateIndirectObjects()];
  for (const [ref, obj] of list) {
    if (!(obj instanceof PDFRawStream)) continue;
    const len = obj.contents.length;
    if (len < 1024) continue;
    const d = obj.dict;
    const type = d.get(N("Type")) ? String(d.get(N("Type"))) : "";
    if (type === "/Metadata" || type === "/XRef" || type === "/ObjStm") continue;
    if (++i % 40 === 0) { check(job); await breathe(); }
    const filter = d.get(N("Filter"));
    let packed = null;
    if (!filter) {
      if (!d.has(N("DecodeParms"))) packed = fflate.zlibSync(obj.contents, { level: 9 });
    } else if (String(filter) === "/FlateDecode" && len > 4096) {
      try { packed = fflate.zlibSync(fflate.unzlibSync(obj.contents), { level: 9 }); } catch (err) { packed = null; }
    }
    if (!packed || packed.length >= len * (filter ? 0.97 : 0.95)) continue;
    d.set(N("Filter"), N("FlateDecode"));
    d.set(N("Length"), PDFNumber.of(packed.length));
    ctx.assign(ref, PDFRawStream.of(d, packed));
    saved += len - packed.length;
  }
  return saved;
}

// ---------------------------------------------------------------- one pass

async function compressOnce(file, pj, level, opts, job, progress) {
  const report = { images: { total: 0, done: 0, scaled: 0, saved: 0, skipped: new Map() }, unused: 0, editor: 0, info: false, squeezed: 0 };
  progress(0, "Opening the PDF…");
  const doc = await loadEditable(file);
  if (opts.images) {
    await shrinkPictures(doc, pj, level, job, (f) => progress(f * 0.7, "Shrinking pictures…"), report);
  }
  check(job);
  progress(0.72, "Cleaning up…");
  if (opts.editor) report.editor = removeEditorData(doc);
  if (opts.info) { removeInfo(doc); report.info = true; }
  if (opts.unused) report.unused = removeUnreachable(doc);
  if (opts.streams) { progress(0.8, "Squeezing the data…"); report.squeezed = await squeezeStreams(doc, job); }
  check(job);
  progress(0.92, "Saving…");
  await breathe();
  return { bytes: await doc.save({ useObjectStreams: true }), report };
}

// the last resort: every page drawn as a picture
async function pagesAsPictures(file, level, job, progress) {
  const pj = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  const out = await PDFLib.PDFDocument.create();
  const scale = level.dpi / 72;
  for (let i = 1; i <= pj.numPages; i++) {
    check(job);
    progress((i - 1) / pj.numPages, `Turning page ${i} of ${pj.numPages} into a picture…`);
    await breathe();
    const page = await pj.getPage(i);
    const v = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvasAtScale(pj, i, scale);
    const image = await out.embedJpg(await canvasToBytes(canvas, "image/jpeg", level.quality));
    const p = out.addPage([v.width, v.height]);
    p.drawImage(image, { x: 0, y: 0, width: v.width, height: v.height });
    canvas.width = canvas.height = 0;
  }
  pj.loadingTask.destroy();
  progress(0.95, "Saving…");
  return { bytes: await out.save(), report: null };
}

// ---------------------------------------------------------------- the page

const LEVEL_HELP = {
  balanced: "Pictures are kept at 150 dpi and 75% quality: sharp on screen and fine to print. Most files lose half or more of their size.",
  smaller: "Pictures at 110 dpi and 60% quality. Good for email and forms; fine detail in photos softens a little.",
  smallest: "Pictures at 72 dpi and 45% quality. Readable on screen, soft in print.",
  aim: "Tries gentler settings first and gets stronger until the file is under the size. If it cannot get there with pictures alone, it says so.",
  custom: "Uses the sharpness and quality you set under Pictures.",
};
const METHOD_HELP = {
  keep: "Text, fonts, links and forms stay exactly as they are. Only pictures and extra data change.",
  pictures: "Every page becomes one picture, which shrinks scans the most. Text is no longer selectable or searchable (OCR PDF can restore that), and links and forms are lost.",
};

const settings = () => ({
  level: $("level").value,
  dpi: Number($("dpi").value),
  quality: Number($("quality").value) / 100,
  method: $("method").value,
  opts: { images: $("doImages").checked, unused: $("doUnused").checked, editor: $("doEditor").checked, streams: $("doStreams").checked, info: $("doInfo").checked },
});

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  $("dpi").value = String(p.dpi);
  $("quality").value = String(Math.round(p.quality * 100));
  $("qualityVal").textContent = $("quality").value;
}

function updatePlan() {
  const s = settings();
  $("block-aim").hidden = s.level !== "aim";
  $("levelHelp").textContent = LEVEL_HELP[s.level];
  $("methodHelp").textContent = METHOD_HELP[s.method];
  const has = !!state.file;
  runBtn.disabled = !has || !!state.run;
  $("clearBtn").disabled = !has || !!state.run;
  const aim = `${$("aimSize").value} ${$("aimUnit").value}`;
  const sum = $("summary");
  sum.classList.remove("is-error");
  if (!has) sum.textContent = "Add a PDF to begin.";
  else if (s.method === "pictures") sum.textContent = `Every page becomes a picture at ${s.dpi} dpi, ${Math.round(s.quality * 100)}% quality.`;
  else if (s.level === "aim") sum.textContent = `Aims for under ${aim}.`;
  else sum.textContent = s.opts.images ? `Pictures at ${s.dpi} dpi, ${Math.round(s.quality * 100)}% quality. Text stays sharp.` : "Clean-up only. Pictures stay as they are.";
  if (has && s.level === "aim" && !(Number($("aimSize").value) > 0)) { sum.textContent = "Enter the largest size the file may be."; sum.classList.add("is-error"); runBtn.disabled = true; }
}

$("level").addEventListener("change", () => { if (PRESETS[$("level").value]) applyPreset($("level").value); updatePlan(); });
for (const id of ["dpi", "quality"]) $(id).addEventListener("input", () => {
  $("qualityVal").textContent = $("quality").value;
  if ($("level").value !== "aim") $("level").value = "custom";
  updatePlan();
});
for (const id of ["method", "doImages", "doUnused", "doEditor", "doStreams", "doInfo", "aimSize", "aimUnit"]) { $(id).addEventListener("input", updatePlan); $(id).addEventListener("change", updatePlan); }

if (window.FGPAcc) {
  FGPAcc.set("size", () => ($("level").value === "aim" ? `Under ${$("aimSize").value} ${$("aimUnit").value}` : $("level").options[$("level").selectedIndex].text.split(",")[0]));
  FGPAcc.set("pictures", () => ($("doImages").checked ? `${$("dpi").value} dpi, ${$("quality").value}%` : "Left as they are"));
  FGPAcc.set("method", () => ($("method").value === "keep" ? "Keep text sharp" : "Pages as pictures"));
  FGPAcc.set("output", () => $("prefix").value.trim() || "File name");
}

async function loadFile(file) {
  const generation = ++state.generation;
  if (state.run) state.run.stopped = true;
  state.file = file;
  state.result = null;
  $("fileBar").textContent = `${file.name} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "compressed");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  clearStatus(statusEl);
  updatePlan();
  await showInside(file, generation);
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { say("Please choose a PDF file.", "error"); return; }
  await loadFile(pdf);
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "compress-pdf", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  if (state.run) return;
  state.generation++;
  Object.assign(state, { file: null, result: null });
  $("fileBar").hidden = true;
  $("inside").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  updatePlan();
});

const list = (title, items) => {
  if (!items.length) return null;
  const box = document.createElement("div");
  const h = document.createElement("h3");
  h.className = "note-title";
  h.textContent = title;
  const ul = document.createElement("ul");
  ul.className = "note-list";
  for (const text of items) { const li = document.createElement("li"); li.textContent = text.charAt(0).toUpperCase() + text.slice(1) + "."; ul.appendChild(li); }
  box.append(h, ul);
  return box;
};

function notesFor(report, level) {
  if (!report) return { changed: ["every page was drawn as a picture, so text is no longer selectable"], left: [] };
  const changed = [];
  const left = [];
  const im = report.images;
  if (im.total) {
    changed.push(`${im.done} of ${plural(im.total, "picture", "pictures")} saved again smaller${im.done ? `, ${formatBytes(im.saved)} less${im.scaled ? ` (${im.scaled} scaled down to ${level.dpi} dpi)` : ""}` : ""}`);
    const reasons = [...im.skipped.entries()].map(([why, n]) => `${n} ${why}`);
    if (reasons.length) left.push(`${plural(im.total - im.done, "picture", "pictures")} left as ${im.total - im.done === 1 ? "it is" : "they are"}: ${reasons.join(", ")}`);
  }
  if (report.unused > 2048) changed.push(`${formatBytes(report.unused)} of data that nothing used was removed`);
  if (report.editor) changed.push(`page thumbnails and editor data were removed from ${plural(report.editor, "place", "places")}`);
  if (report.squeezed > 2048) changed.push(`${formatBytes(report.squeezed)} saved by squeezing the other data tighter`);
  if (report.info) changed.push("the title, author and other document info were removed");
  return { changed, left };
}

runBtn.addEventListener("click", async () => {
  if (!state.file || state.run) return;
  const job = { stopped: false, generation: state.generation };
  state.run = job;
  const file = state.file;
  const s = settings();
  runBtn.disabled = true;
  $("stopBtn").hidden = false;
  $("stopBtn").disabled = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  const progress = (f, text) => { setProgress(f); if (text) say(text); };
  const stale = () => job.generation !== state.generation;
  let pj = null;

  try {
    let best = null; // { bytes, report, level }
    if (s.method === "pictures") {
      const level = { dpi: s.dpi, quality: s.quality };
      best = { ...(await pagesAsPictures(file, level, job, progress)), level };
    } else {
      pj = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
      const levels = s.level === "aim" ? SIZE_LEVELS : [{ dpi: s.dpi, quality: s.quality }];
      const limit = s.level === "aim" ? targetBytes($("aimSize").value, $("aimUnit").value) : 0;
      for (const [i, level] of levels.entries()) {
        if (levels.length > 1) say(`Trying ${level.dpi} dpi (${i + 1} of ${levels.length})…`);
        const pass = await compressOnce(file, pj, level, s.opts, job, (f, t) => progress((i + f) / levels.length, t && levels.length === 1 ? t : null));
        const one = { ...pass, level };
        if (!best || one.bytes.length < best.bytes.length) best = one;
        if (!limit || one.bytes.length <= limit) { best = one; break; }
      }
    }
    if (stale()) return;
    const before = file.size;
    const after = best.bytes.length;
    const smaller = after < before * 0.99;
    const blob = new Blob([best.bytes], { type: "application/pdf" });
    const outName = brandFilename("compress-pdf", safeBaseName($("prefix").value, "compressed"), "pdf");
    state.result = { blob, outName };

    const notes = notesFor(best.report, best.level);
    const left = [...notes.left];
    if (s.level === "aim" && s.method === "keep" && after > targetBytes($("aimSize").value, $("aimUnit").value)) {
      left.push(`the smallest it could get without turning pages into pictures was ${formatBytes(after)}, over your ${$("aimSize").value} ${$("aimUnit").value}. Try "Turn every page into a picture" under Method`);
    }
    $("resultTotal").textContent = `${formatBytes(before)} to ${formatBytes(after)}, ${describeSaving(before, after)}`;
    $("downloadBtn").textContent = smaller ? "Download" : "Download anyway";
    const box = $("noteLists");
    box.innerHTML = "";
    if (!smaller) {
      const p = document.createElement("p");
      p.className = "help-text";
      p.textContent = "This PDF could not be made clearly smaller with these settings, so nothing was downloaded. It is probably already well compressed. Try Smaller or Smallest, or turn every page into a picture if it is a scan.";
      box.appendChild(p);
    }
    for (const sec of [list("Changed", notes.changed), list("Left as it is", left)]) if (sec) box.appendChild(sec);
    $("results").classList.add("visible");
    if (smaller) {
      triggerDownload(blob, outName);
      if (window.KeepSorted) {
        KeepSorted.offer({
          currentTool: "compress-pdf",
          blob,
          filename: outName,
          els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
          relatedSection: document.querySelector(".related-tools-section"),
        });
      }
      say(`Sorted, ${describeSaving(before, after)}: ${formatBytes(before)} to ${formatBytes(after)}.`, "success");
    } else {
      say("This PDF could not be made smaller with these settings.", "");
    }
  } catch (err) {
    if (err instanceof Stopped) say("Stopped. Nothing was changed.");
    else {
      console.error(err);
      say(err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
    }
  } finally {
    if (pj) pj.loadingTask.destroy();
    setProgress(null);
    $("stopBtn").hidden = true;
    if (state.run === job) state.run = null;
    updatePlan();
  }
});

$("stopBtn").addEventListener("click", () => {
  if (!state.run) return;
  state.run.stopped = true;
  $("stopBtn").disabled = true;
  say("Stopping…");
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

applyPreset("balanced");
updatePlan();
