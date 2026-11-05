// Fill PDF Form page. The rules (where a field sits on the page as shown, what counts as filled, what the form's font can set, writing the
// answers back) are in fill-core.js; this file is the page around them: the page drawn with the form's fields laid over it as real
// inputs, the list of fields, and saving.
import { PDFLib, pdfjsLib, loadPdfJsDoc, breathe } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { safeBaseName } from "/assets/tools/page-tools.js";
import { shownSize } from "/assets/tools/sign-core.js";
import { readFields, fillable, isFilled, countFilled, describeFill, nextEmpty, problemsWith, describeProblem, writeValues, dropXfa } from "/assets/tools/fill-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const stage = $("fillStage");
const pageCanvas = $("pageCanvas");
const layer = $("fieldLayer");
const runBtn = $("runBtn");

// fields: from readFields. values: what each field holds now, by field name. pages: [{ box, rotation, size }] for each page
const state = { file: null, pj: null, count: 0, page: 0, pages: [], fields: [], values: new Map(), signatures: 0, ignored: 0, current: null, dirty: false, token: 0, result: null, generation: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

const clone = (v) => (Array.isArray(v) ? [...v] : v);
const initialValues = () => new Map(state.fields.map((f) => [f.name, clone(f.initial)]));
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

// ---------------------------------------------------------------- the page and its fields

function setUnit() {
  const p = state.pages[state.page];
  if (p && stage.clientWidth) layer.style.setProperty("--u", `${stage.clientWidth / p.size.w}px`);
}
if (window.ResizeObserver) new ResizeObserver(setUnit).observe(stage);

async function showPage(index) {
  const token = ++state.token;
  state.page = Math.min(Math.max(0, index), state.count - 1);
  $("pageNum").value = String(state.page + 1);
  $("prevPageBtn").disabled = state.page <= 0;
  $("nextPageBtn").disabled = state.page >= state.count - 1;
  const page = await state.pj.getPage(state.page + 1);
  const width = Math.min(3200, Math.round((stage.clientWidth || 760) * dpr()));
  const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // the form's own fields are left out of the picture: they are laid over it as inputs, and would show twice
  await page.render({ canvasContext: canvas.getContext("2d"), viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
  if (token !== state.token) return;
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext("2d").drawImage(canvas, 0, 0);
  setUnit();
  buildLayer();
}

function sync(f, except) {
  const v = state.values.get(f.name);
  layer.querySelectorAll(`[data-f="${state.fields.indexOf(f)}"]`).forEach((el) => {
    if (el === except) return;
    if (el.type === "checkbox") el.checked = v === true;
    else if (el.type === "radio") el.checked = v === el.dataset.value;
    else if (el.tagName === "SELECT" && el.multiple) for (const o of el.options) o.selected = Array.isArray(v) && v.includes(o.value);
    else el.value = Array.isArray(v) ? v[0] || "" : v;
  });
}

function mark(f) {
  const needed = f.required && !isFilled(f, state.values.get(f.name));
  layer.querySelectorAll(`[data-f="${state.fields.indexOf(f)}"]`).forEach((el) => (el.closest(".fill-tick") || el).classList.toggle("is-needed", needed));
}

function changed(f, el, value) {
  const was = isFilled(f, state.values.get(f.name));
  state.values.set(f.name, value);
  state.dirty = true;
  state.current = f.name;
  sync(f, el);
  mark(f);
  if (was !== isFilled(f, value)) renderList();
  refreshPanel();
}

function place(el, w, f) {
  el.style.left = `${w.x * 100}%`;
  el.style.top = `${w.y * 100}%`;
  el.style.width = `${w.w * 100}%`;
  el.style.height = `${w.h * 100}%`;
  el.style.fontSize = `calc(var(--u, 1px) * ${w.size})`;
  el.dataset.f = String(state.fields.indexOf(f));
}

function makeInput(f, w) {
  const value = state.values.get(f.name);
  let el;
  if (f.kind === "text" || f.kind === "multiline") {
    el = document.createElement(f.kind === "multiline" ? "textarea" : "input");
    if (f.kind === "text") el.type = f.password ? "password" : "text";
    if (f.maxLen) el.maxLength = f.maxLen;
    el.value = value;
    el.autocomplete = "off";
    el.spellcheck = f.kind === "multiline";
    el.className = "fill-in";
    el.addEventListener("input", () => changed(f, el, el.value));
  } else if (f.kind === "choice" || f.kind === "list") {
    el = document.createElement("select");
    el.className = "fill-in";
    if (f.kind === "list") { el.size = 2; el.multiple = f.multiSelect; }
    if (f.kind === "choice") el.appendChild(new Option("", ""));
    const have = new Set(f.options.map((o) => o.value));
    const options = [...f.options];
    for (const v of [].concat(value)) if (v && !have.has(v)) options.push({ value: v, label: v });
    for (const o of options) el.appendChild(new Option(o.label, o.value));
    if (f.multiSelect) for (const o of el.options) o.selected = value.includes(o.value);
    else el.value = value;
    el.addEventListener("change", () => changed(f, el, f.multiSelect ? [...el.selectedOptions].map((o) => o.value) : el.value));
  } else {
    // a tick or a radio button: the input is invisible and a drawn box sits under it, so it can look like the form's own
    const wrap = document.createElement("label");
    wrap.className = `fill-tick${f.kind === "radio" ? " radio" : ""}`;
    el = document.createElement("input");
    el.type = f.kind === "radio" ? "radio" : "checkbox";
    wrap.append(el, document.createElement("span"));
    if (f.kind === "radio") {
      el.dataset.value = w.value;
      el.name = `fill-${state.fields.indexOf(f)}`;
      el.checked = value === w.value;
      // a radio button that is already on can be turned off by clicking it again
      el.addEventListener("click", () => {
        const on = state.values.get(f.name) === w.value;
        if (on) el.checked = false;
        changed(f, el, on ? "" : w.value);
      });
    } else {
      el.checked = value === true;
      el.addEventListener("change", () => changed(f, el, el.checked));
    }
    place(wrap, w, f);
    el.dataset.f = wrap.dataset.f;
    el.setAttribute("aria-label", f.label);
    return wrap;
  }
  el.setAttribute("aria-label", f.label);
  if (f.required) el.setAttribute("aria-required", "true");
  el.addEventListener("focus", () => { state.current = f.name; renderList(); });
  place(el, w, f);
  return el;
}

function buildLayer() {
  layer.innerHTML = "";
  const frag = document.createDocumentFragment();
  // a read-only field is left to the picture of the page: pdf.js draws those itself, and an input over it would show them twice
  for (const f of state.fields) {
    if (f.readOnly) continue;
    for (const w of f.widgets) if (w.page === state.page) frag.appendChild(makeInput(f, w));
  }
  layer.appendChild(frag);
  for (const f of state.fields) if (f.required) mark(f);
}

async function jumpTo(f) {
  const w = f.widgets[0];
  if (w.page !== state.page) await showPage(w.page);
  const el = layer.querySelector(`[data-f="${state.fields.indexOf(f)}"]`);
  if (!el) return;
  state.current = f.name;
  el.focus({ preventScroll: true });
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", inline: "center", behavior: calm ? "auto" : "smooth" });
  renderList();
}

// ---------------------------------------------------------------- the list of fields

function renderList() {
  const list = $("fieldList");
  const keep = list.scrollTop;
  list.innerHTML = "";
  for (const f of fillable(state.fields)) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(f.name === state.current));
    const done = isFilled(f, state.values.get(f.name));
    b.classList.toggle("is-done", done);
    const name = document.createElement("span");
    name.className = "fl-name";
    name.textContent = f.label;
    const meta = document.createElement("span");
    meta.className = "fl-meta";
    meta.textContent = done ? "Filled" : f.required ? "Required" : `Page ${f.widgets[0].page + 1}`;
    b.append(name, meta);
    b.addEventListener("click", () => jumpTo(f));
    li.appendChild(b);
    list.appendChild(li);
  }
  list.scrollTop = keep;
}

function refreshPanel() {
  const has = !!state.pj;
  const some = has && state.fields.length > 0;
  runBtn.disabled = !some;
  $("clearBtn").disabled = !has;
  $("nextEmptyBtn").disabled = !some;
  $("resetBtn").disabled = !some || !state.dirty;
  const sum = $("summary");
  sum.classList.remove("is-error");
  sum.textContent = !has ? "Add a PDF form to begin." : some ? describeFill(countFilled(state.fields, state.values)) : "This PDF has no fillable fields.";
  const bits = [];
  const ro = state.fields.filter((f) => f.readOnly).length;
  if (ro) bits.push(`${ro} read-only field${ro === 1 ? " is" : "s are"} left as ${ro === 1 ? "it is" : "they are"}.`);
  if (state.signatures) bits.push(`${state.signatures} signature field${state.signatures === 1 ? " is" : "s are"} left for Sign PDF.`);
  $("fieldNote").textContent = bits.join(" ");
  $("fieldNote").hidden = !bits.length;
}

$("nextEmptyBtn").addEventListener("click", () => {
  const f = nextEmpty(state.fields, state.values, state.current);
  if (!f) { setMsg("Every field is filled in.", "success"); return; }
  clearStatus(statusEl);
  jumpTo(f);
});
$("highlight").addEventListener("change", () => stage.classList.toggle("plain", !$("highlight").checked));
$("resetBtn").addEventListener("click", () => {
  state.values = initialValues();
  state.dirty = false;
  buildLayer();
  renderList();
  refreshPanel();
  setMsg("Put back what the form had.");
});

if (window.FGPAcc) {
  FGPAcc.set("fields", () => (state.fields.length ? `${countFilled(state.fields, state.values).filled} of ${fillable(state.fields).length} filled` : "Add a form"));
  FGPAcc.set("output", () => ($("flattenCheck").checked ? "Flattened" : "Keep it editable"));
}

// ---------------------------------------------------------------- opening a form

async function loadFile(file) {
  const generation = ++state.generation;
  setMsg("Reading your form…");
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  const pj = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { pj.loadingTask.destroy(); return; }
  const pages = [];
  const reading = [];
  for (let i = 1; i <= pj.numPages; i++) {
    const page = await pj.getPage(i);
    const [x1, y1, x2, y2] = page.view;
    const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    pages.push({ box, rotation: page.rotate || 0, size: shownSize(box, page.rotate || 0) });
    reading.push({ annotations: await page.getAnnotations({ intent: "display" }), box, rotation: page.rotate || 0 });
    if (i % 8 === 0) { setMsg(`Reading your form, page ${i} of ${pj.numPages}…`); await breathe(); if (generation !== state.generation) { pj.loadingTask.destroy(); return; } }
  }
  const { fields, signatures, ignored } = readFields(reading);
  Object.assign(state, { file, pj, count: pj.numPages, pages, fields, signatures, ignored, current: null, dirty: false, result: null });
  state.values = initialValues();
  $("pageNum").max = String(state.count);
  $("pageTotal").textContent = String(state.count);
  $("pagerPages").hidden = state.count < 2;
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("prefix").value = safeBaseName(stripExtension(file.name), "filled");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  const some = fields.length > 0;
  $("fillWrap").hidden = !some;
  $("noFields").hidden = some;
  if (!some) {
    $("noFieldsText").textContent = pj.isPureXfa
      ? "This is a dynamic (XFA) form, a kind only Adobe's own reader can fill in. Its fields can't be reached here."
      : "Only fields that are already in a PDF can be filled in here. You can still write on this PDF with PDF Editor, or add fields to it with PDF Form Builder.";
  }
  state.page = 0;
  if (some) {
    $("zoom").value = "1";
    applyZoom();
    layer.innerHTML = "";
    await showPage(0);
  }
  clearStatus(statusEl);
  renderList();
  refreshPanel();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setMsg("Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setMsg(err && err.name === "PasswordException" ? "This PDF is password protected. Remove the password with Unlock PDF first, then bring it back here." : `Could not read that PDF: ${String(err.message || "unknown error").replace(/[.\s]+$/, "")}.`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "fill-pdf-form", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  state.generation++;
  state.token++;
  if (state.pj && state.pj.loadingTask) state.pj.loadingTask.destroy();
  Object.assign(state, { file: null, pj: null, count: 0, fields: [], values: new Map(), signatures: 0, ignored: 0, current: null, dirty: false, result: null });
  layer.innerHTML = "";
  $("fieldList").innerHTML = "";
  $("fillWrap").hidden = true;
  $("noFields").hidden = true;
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  refreshPanel();
});

$("prevPageBtn").addEventListener("click", () => showPage(state.page - 1));
$("nextPageBtn").addEventListener("click", () => showPage(state.page + 1));
$("pageNum").addEventListener("change", () => {
  const n = parseInt($("pageNum").value, 10);
  showPage(Number.isFinite(n) ? n - 1 : state.page);
});

// Zoom: the page is made wider than its box and the box scrolls, so a form's small text is easy to read and to tap on a phone
function applyZoom() {
  const z = Number($("zoom").value) || 1;
  stage.style.width = z === 1 ? "" : `${z * 100}%`;
  stage.style.maxWidth = z === 1 ? "" : "none";
}
$("zoom").addEventListener("change", () => { applyZoom(); if (state.pj) showPage(state.page); });

// ---------------------------------------------------------------- saving

runBtn.addEventListener("click", async () => {
  if (!state.file || !state.fields.length) return;
  const problems = problemsWith(state.fields, state.values);
  if (problems.length) {
    const why = `${describeProblem(problems[0])}${problems.length > 1 ? ` ${problems.length - 1} more need the same fix.` : ""}`;
    setMsg(why, "error");
    $("summary").textContent = why; // the strip beside the button is always in view, which the status box is not on a phone
    $("summary").classList.add("is-error");
    const f = state.fields.find((x) => x.name === problems[0].name);
    if (f) jumpTo(f);
    return;
  }
  runBtn.disabled = true;
  setMsg("Saving…");
  try {
    const doc = await loadEditable(state.file);
    const form = doc.getForm();
    const xfa = dropXfa(form, PDFLib.PDFName);
    const { changed: n, failed } = writeValues(form, state.fields, state.values);
    let flattened = $("flattenCheck").checked;
    if (flattened) {
      try { form.flatten(); } catch (err) { console.error(err); flattened = false; }
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const outName = brandFilename("fill-pdf-form", safeBaseName($("prefix").value, "filled"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);
    const left = countFilled(state.fields, state.values);
    const notes = [`${n} field${n === 1 ? "" : "s"} changed${flattened ? ", then flattened so the answers can't be edited" : ""}.`];
    if ($("flattenCheck").checked && !flattened) notes.push("This form could not be flattened, so it was saved with its fields still editable.");
    if (left.requiredLeft) notes.push(`${left.requiredLeft} required field${left.requiredLeft === 1 ? " is" : "s are"} still empty.`);
    if (failed.length) notes.push(`${failed.length} field${failed.length === 1 ? "" : "s"} could not be saved: ${failed.slice(0, 3).map((x) => x.label).join(", ")}${failed.length > 3 ? ", and more" : ""}.`);
    if (xfa) notes.push("The form's dynamic (XFA) copy was removed so viewers show your answers.");
    notes.push("Open the copy and check it before you send it. Totals and date formats that the form works out with its own scripts are not recalculated here.");
    $("resultTotal").textContent = `${state.count} page${state.count === 1 ? "" : "s"}, ${formatBytes(blob.size)}`;
    $("resultNote").textContent = notes.join(" ");
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "fill-pdf-form",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setMsg(`Sorted, saved (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setMsg(err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    refreshPanel();
  }
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

refreshPanel();
