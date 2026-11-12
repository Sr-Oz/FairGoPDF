// Rotate PDF page. The rules (quarter turns, placing a page that is turned by any angle, finding the tilt of a scan) are in
// rotate-core.js; this file is the page around them.
import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, breathe } from "/assets/tools/pdf-common.js";
import { OpenProblem, loadEditable } from "/assets/tools/open-pdf.js";
import { parsePageSpec, compactPages, safeBaseName } from "/assets/tools/page-tools.js";
import { turnBy, placeTurned, darkPoints, estimateSkew, describeTurns } from "/assets/tools/rotate-core.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const pageGrid = $("pageGrid");
const statusEl = $("status");
const progressEl = $("progress");
const runBtn = $("runBtn");

// turns: page -> 0, 90, 180 or 270, what was asked for (on top of what the PDF says); base: page -> its picture, upright as seen
const state = { file: null, doc: null, count: 0, selected: new Set(), turns: new Map(), base: new Map(), focus: 1, stage: null, found: new Map(), generation: 0, run: null, result: null };

function setProgress(f) { setProgressBar(progressEl, $("progressFill"), f); }

// ---------------------------------------------------------------- pictures

function turnCanvas(base, deg) {
  if (!deg) return base;
  const sideways = deg % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = sideways ? base.height : base.width;
  c.height = sideways ? base.width : base.height;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(base, -base.width / 2, -base.height / 2);
  return c;
}

let renderChain = Promise.resolve();
let observer = null;

function placeThumb(thumb) {
  const n = Number(thumb.dataset.page);
  const base = state.base.get(n);
  if (!base) return;
  const t = state.turns.get(n) || 0;
  const canvas = turnCanvas(base, t);
  const shown = canvas === base ? (() => { const c = document.createElement("canvas"); c.width = base.width; c.height = base.height; c.getContext("2d").drawImage(base, 0, 0); return c; })() : canvas;
  shown.setAttribute("role", "img");
  shown.setAttribute("aria-label", `Page ${n} preview${t ? `, turned ${t} degrees` : ""}`);
  const old = thumb.querySelector("canvas, .thumb-ph");
  if (old) old.replaceWith(shown);
  thumb.classList.toggle("has-turn", !!t);
  thumb.querySelector(".turn-tag").textContent = t ? `${t}°` : "";
}

function renderThumb(thumb, generation) {
  if (thumb.dataset.rendered) return;
  thumb.dataset.rendered = "1";
  renderChain = renderChain.then(async () => {
    if (generation !== state.generation) return;
    try {
      const n = Number(thumb.dataset.page);
      const canvas = await renderPageThumbCanvas(state.doc, n, 200);
      if (generation !== state.generation) return;
      state.base.set(n, canvas);
      placeThumb(thumb);
    } catch (err) {
      // the placeholder stays; the page still turns
    }
  });
}

function buildGrid(ratio) {
  if (observer) observer.disconnect();
  const generation = state.generation;
  pageGrid.innerHTML = "";
  observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); renderThumb(e.target, generation); } }), { rootMargin: "600px" })
    : null;
  for (let i = 1; i <= state.count; i++) {
    const thumb = document.createElement("div");
    thumb.className = "page-thumb";
    thumb.dataset.page = String(i);
    thumb.innerHTML = `<span class="page-num">${i}</span><div class="thumb-ph" style="aspect-ratio:${ratio}"></div><span class="turn-tag"></span>`;
    thumb.addEventListener("click", () => {
      if (state.selected.has(i)) state.selected.delete(i); else state.selected.add(i);
      state.focus = i;
      selectionChanged(true);
      showStage();
    });
    pageGrid.appendChild(thumb);
    if (observer) observer.observe(thumb); else renderThumb(thumb, generation);
  }
}

// ---------------------------------------------------------------- the page shown large

const angleNow = () => Math.max(-45, Math.min(45, Number($("angleNumber").value) || 0));

// the angle a page will be straightened by, as far as is known now
function angleFor(n) {
  if (!state.selected.has(n)) return 0;
  if ($("angleMode").value === "manual") return angleNow();
  const f = state.found.get(`${n}:${state.turns.get(n) || 0}`);
  return f ? f.angle : 0;
}

async function showStage() {
  if (!state.doc) return;
  const n = state.focus;
  const generation = state.generation;
  if (!state.stage || state.stage.n !== n) {
    const canvas = await renderPageThumbCanvas(state.doc, n, 560);
    if (generation !== state.generation || state.focus !== n) return;
    state.stage = { n, canvas };
  }
  $("stageWrap").hidden = false;
  layoutStage();
  if ($("angleMode").value === "detect" && state.selected.has(n)) {
    await detectFor(n);
    if (generation === state.generation && state.focus === n) layoutStage();
  }
}

function layoutStage() {
  if (!state.stage) return;
  const { n, canvas } = state.stage;
  const t = state.turns.get(n) || 0;
  const a = angleFor(n);
  const grow = $("grow").value === "grow";
  const place = placeTurned({ w: canvas.width, h: canvas.height, base: t, angle: a, grow });
  const k = Math.min(1, 520 / Math.max(place.pageW, place.pageH));
  const sheet = $("sheet");
  sheet.style.width = `${place.pageW * k}px`;
  sheet.style.height = `${place.pageH * k}px`;
  sheet.style.background = $("corner").value === "black" ? "#000" : "#fff";
  sheet.classList.toggle("has-grid", $("grid").value === "on");
  const target = $("stageCanvas");
  if (target.dataset.n !== String(n)) {
    target.width = canvas.width;
    target.height = canvas.height;
    target.getContext("2d").drawImage(canvas, 0, 0);
    target.dataset.n = String(n);
  }
  target.style.width = `${canvas.width * k}px`;
  target.style.height = `${canvas.height * k}px`;
  target.style.transform = `translate(-50%, -50%) rotate(${t + a}deg)`;
  const found = state.found.get(`${n}:${t}`);
  $("stageNote").textContent = `Page ${n}${t ? `, turned ${t}°` : ""}${a ? `, straightened by ${a}°` : ""}${$("angleMode").value === "detect" && state.selected.has(n) && found && !found.found ? ", no clear lines of text to straighten by" : ""}.`;
}

// ---------------------------------------------------------------- finding the tilt

async function detectFor(n) {
  const t = state.turns.get(n) || 0;
  const key = `${n}:${t}`;
  if (state.found.has(key)) return state.found.get(key);
  const base = await renderPageThumbCanvas(state.doc, n, 900);
  const c = turnCanvas(base, t); // the tilt is read on the page as it will be seen, after any turn
  const img = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  const result = estimateSkew(darkPoints(img.data, c.width, c.height, { step: Math.max(1, Math.floor(c.width / 700)) }));
  state.found.set(key, result);
  return result;
}

$("detectBtn").addEventListener("click", async () => {
  if (!state.doc) return;
  $("detectBtn").disabled = true;
  $("detectNote").textContent = "Reading the page…";
  try {
    const r = await detectFor(state.focus);
    if (r.found) {
      setAngle(r.angle);
      $("detectNote").textContent = `Page ${state.focus} is tilted by about ${r.angle}°, so the angle is set to match.`;
    } else {
      $("detectNote").textContent = `No clear lines of text on page ${state.focus}. Set the angle by eye against the grid instead.`;
    }
  } finally {
    $("detectBtn").disabled = false;
  }
});

// ---------------------------------------------------------------- opening a PDF

async function loadFile(file) {
  const generation = ++state.generation;
  if (state.run) state.run.stopped = true;
  setStatus(statusEl, "Reading the PDF…", "");
  if (state.doc) state.doc.loadingTask.destroy();
  const doc = await loadPdfJsDoc(new Uint8Array(await file.arrayBuffer()));
  if (generation !== state.generation) { doc.loadingTask.destroy(); return; }
  Object.assign(state, { file, doc, count: doc.numPages, selected: new Set(Array.from({ length: doc.numPages }, (_, i) => i + 1)), turns: new Map(), base: new Map(), found: new Map(), focus: 1, stage: null, result: null });
  const v = (await doc.getPage(1)).getViewport({ scale: 1 });
  buildGrid((v.width / v.height).toFixed(4));
  $("fileBar").textContent = `${file.name} · ${state.count} page${state.count === 1 ? "" : "s"} · ${formatBytes(file.size)}`;
  $("fileBar").hidden = false;
  $("gridWrap").hidden = false;
  $("stageCanvas").dataset.n = "";
  $("prefix").value = safeBaseName(stripExtension(file.name), "rotated");
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  dropzone.classList.add("compact");
  clearStatus(statusEl);
  selectionChanged(true);
  $("detectBtn").disabled = false;
  showStage();
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) { setStatus(statusEl, "Please choose a PDF file.", "error"); return; }
  try {
    await loadFile(pdf);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err && err.name === "PasswordException" ? "This PDF is password protected. Remove the password with Unlock PDF first, then bring it back here." : `Could not read that PDF: ${String(err.message || "unknown error").replace(/[.\s]+$/, "")}. If it needs a password, remove it with Unlock PDF first.`, "error");
  }
}
initDropzone(dropzone, $("fileInput"), handleFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "rotate-pdf-freely", dropzone, onFiles: handleFiles });

$("clearBtn").addEventListener("click", () => {
  if (state.run) return;
  if (state.doc) state.doc.loadingTask.destroy();
  state.generation++;
  Object.assign(state, { file: null, doc: null, count: 0, selected: new Set(), turns: new Map(), base: new Map(), found: new Map(), stage: null, result: null });
  pageGrid.innerHTML = "";
  $("gridWrap").hidden = true;
  $("stageWrap").hidden = true;
  $("fileBar").hidden = true;
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  dropzone.classList.remove("compact");
  clearStatus(statusEl);
  $("rangeInput").value = "";
  setAngle(0);
  updatePlan();
});

// ---------------------------------------------------------------- choosing pages

function syncRangeInput() {
  $("rangeInput").value = compactPages([...state.selected]);
  $("rangeNote").textContent = "";
  $("rangeNote").classList.remove("is-error");
  $("rangeInput").setAttribute("aria-invalid", "false");
}

function selectionChanged(fromThumbs) {
  if (fromThumbs) syncRangeInput();
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => el.classList.toggle("selected", state.selected.has(Number(el.dataset.page))));
  updatePlan();
}

$("rangeInput").addEventListener("input", () => {
  const text = $("rangeInput").value;
  const note = $("rangeNote");
  if (!text.trim()) {
    state.selected = new Set();
    note.textContent = "";
  } else {
    const r = parsePageSpec(text, state.count);
    note.textContent = r.error || "";
    note.classList.toggle("is-error", !!r.error);
    $("rangeInput").setAttribute("aria-invalid", String(!!r.error));
    if (r.error) return;
    state.selected = new Set(r.pages);
    note.textContent = `${r.pages.length} of ${state.count} pages`;
  }
  selectionChanged(false);
  showStage();
});

for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("click", () => {
    const all = Array.from({ length: state.count }, (_, i) => i + 1);
    const pick = b.dataset.pick;
    state.selected = new Set(pick === "all" ? all : pick === "none" ? [] : pick === "odd" ? all.filter((n) => n % 2) : pick === "even" ? all.filter((n) => n % 2 === 0) : all.filter((n) => !state.selected.has(n)));
    selectionChanged(true);
    showStage();
  });
}

// ---------------------------------------------------------------- turning and straightening

for (const b of document.querySelectorAll("[data-turn]")) {
  b.addEventListener("click", () => {
    for (const n of state.selected) {
      if (b.dataset.turn === "reset") state.turns.delete(n);
      else state.turns.set(n, turnBy(state.turns.get(n) || 0, Number(b.dataset.turn)));
      if (!state.turns.get(n)) state.turns.delete(n);
    }
    pageGrid.querySelectorAll(".page-thumb").forEach(placeThumb);
    updatePlan();
    state.found = new Map(); // a turned page has lines in new places
    layoutStage();
    showStage();
  });
}

function setAngle(value) {
  const v = Math.max(-45, Math.min(45, Math.round((Number(value) || 0) * 10) / 10));
  $("angleSlider").value = String(v);
  $("angleNumber").value = String(v);
  $("angleVal").textContent = String(v);
  updatePlan();
  layoutStage();
}
$("angleSlider").addEventListener("input", () => setAngle($("angleSlider").value));
$("angleNumber").addEventListener("input", () => setAngle($("angleNumber").value));
for (const id of ["grid", "grow", "corner"]) $(id).addEventListener("change", () => { updatePlan(); layoutStage(); });
$("angleMode").addEventListener("change", () => {
  $("block-manual").hidden = $("angleMode").value !== "manual";
  $("block-detect").hidden = $("angleMode").value !== "detect";
  updatePlan();
  showStage();
});

// ---------------------------------------------------------------- the plan, shown before anything is made

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function changes() {
  const turned = [...state.turns.entries()].filter(([, t]) => t);
  const straighten = $("angleMode").value === "detect" ? state.selected.size > 0 : angleNow() !== 0 && state.selected.size > 0;
  return { turned, straighten };
}

function updatePlan() {
  const have = state.count > 0;
  const { turned, straighten } = changes();
  runBtn.disabled = !have || !!state.run || (!turned.length && !straighten);
  $("clearBtn").disabled = !state.file || !!state.run;
  const s = $("summary");
  s.classList.remove("is-error");
  if (!have) { s.textContent = "Add a PDF to begin."; return; }
  if (!state.selected.size && !turned.length) { s.textContent = "Pick at least one page."; s.classList.add("is-error"); return; }
  const parts = [];
  if (turned.length) parts.push(`${plural(turned.length, "page", "pages")} turned`);
  if (straighten) parts.push($("angleMode").value === "detect" ? `${plural(state.selected.size, "page", "pages")} straightened by their own tilt` : `${plural(state.selected.size, "page", "pages")} straightened by ${angleNow()}°`);
  s.textContent = parts.length ? parts.join(", ") + "." : "Turn a page or set an angle to begin.";
}

if (window.FGPAcc) {
  FGPAcc.set("pages", () => (!state.count ? "All pages" : state.selected.size === state.count ? `All ${state.count} pages` : state.selected.size ? compactPages([...state.selected]) : "No pages"));
  FGPAcc.set("turn", () => (state.turns.size ? describeTurns(state.turns, state.count) : "No turns"));
  FGPAcc.set("straighten", () => ($("angleMode").value === "detect" ? "Found for each page" : angleNow() ? `${angleNow()}°` : "Not straightened"));
  FGPAcc.set("output", () => ($("grow").value === "grow" ? "Page grows" : "Keeps its size"));
}

// ---------------------------------------------------------------- making the PDF

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

runBtn.addEventListener("click", async () => {
  if (!state.doc || state.run) return;
  const job = { stopped: false, generation: state.generation };
  state.run = job;
  runBtn.disabled = true;
  $("stopBtn").hidden = false;
  $("stopBtn").disabled = false;
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  const detect = $("angleMode").value === "detect";
  const grow = $("grow").value === "grow";
  const corner = $("corner").value === "black" ? PDFLib.rgb(0, 0, 0) : PDFLib.rgb(1, 1, 1);
  const manual = angleNow();
  const turns = new Map(state.turns);
  const selected = new Set(state.selected);
  const tally = { straightened: [], untouched: [], lostLinks: 0 };
  const stale = () => job.generation !== state.generation;

  try {
    // 1. the angle for each page: typed, or read from the page
    const work = [];
    const pages = [...new Set([...turns.keys(), ...(manual || detect ? selected : [])])].sort((a, b) => a - b);
    for (const [i, n] of pages.entries()) {
      if (job.stopped || stale()) break;
      let f = 0;
      if (selected.has(n)) {
        if (detect) {
          setStatus(statusEl, `Reading page ${n} for its tilt (${i + 1} of ${pages.length})…`, "");
          setProgress(i / pages.length / 2);
          await breathe();
          const r = await detectFor(n);
          f = r.found ? r.angle : 0;
          if (!r.found) tally.untouched.push(n);
        } else f = manual;
      }
      if (turns.get(n) || f) work.push({ n, t: turns.get(n) || 0, f });
    }
    if (job.stopped || stale()) { if (!stale()) setStatus(statusEl, "Stopped. Nothing was changed.", ""); return; }
    if (!work.length) { setStatus(statusEl, "Nothing needed turning, so the PDF was left as it is.", ""); return; }

    // 2. the changes, made in a copy of the PDF itself so everything else in it stays as it is
    const src = await loadEditable(state.file);
    for (const [i, { n, t, f }] of work.entries()) {
      if (job.stopped || stale()) break;
      setStatus(statusEl, `Turning page ${n} (${i + 1} of ${work.length})…`, "");
      setProgress(0.5 + (i / work.length) / 2);
      await breathe();
      const page = src.getPage(n - 1);
      const r0 = page.getRotation().angle;
      if (!f) {
        page.setRotation(PDFLib.degrees(turnBy(r0, t))); // a quarter turn changes only how the page is shown
        continue;
      }
      const { width: w, height: h } = page.getSize();
      const annots = page.node.Annots && page.node.Annots();
      if (annots && annots.size() > 0) tally.lostLinks++;
      const embedded = await src.embedPage(page);
      const place = placeTurned({ w, h, base: turnBy(r0, t), angle: f, grow });
      const fresh = src.insertPage(n - 1, [place.pageW, place.pageH]);
      fresh.drawRectangle({ x: 0, y: 0, width: place.pageW, height: place.pageH, color: corner });
      // the page itself is white under its own content, turned with it, so a dark corner colour shows only in the corners
      if (corner.red < 1 || corner.green < 1 || corner.blue < 1) fresh.drawRectangle({ x: place.x, y: place.y, width: w, height: h, rotate: PDFLib.radians(place.theta), color: PDFLib.rgb(1, 1, 1) });
      fresh.drawPage(embedded, { x: place.x, y: place.y, rotate: PDFLib.radians(place.theta) });
      src.removePage(n); // the original has moved up one
      tally.straightened.push([n, f]);
    }
    if (job.stopped || stale()) { if (!stale()) setStatus(statusEl, "Stopped. Nothing was changed.", ""); return; }

    setStatus(statusEl, "Saving…", "");
    await breathe();
    const blob = new Blob([await src.save()], { type: "application/pdf" });
    const outName = brandFilename("rotate-pdf-freely", safeBaseName($("prefix").value, "rotated"), "pdf");
    state.result = { blob, outName };
    triggerDownload(blob, outName);

    $("resultTotal").textContent = `${plural(src.getPageCount(), "page", "pages")}, ${formatBytes(blob.size)}`;
    const box = $("noteLists");
    box.innerHTML = "";
    const turned = new Map(work.filter((x) => x.t).map((x) => [x.n, x.t]));
    const changed = [];
    if (turned.size) changed.push(`${describeTurns(turned, state.count)}; a quarter turn changes how the page is shown and nothing is redrawn`);
    if (tally.straightened.length) {
      const shown = tally.straightened.slice(0, 6).map(([n, a]) => `page ${n} by ${a}°`).join(", ");
      changed.push(`${plural(tally.straightened.length, "page was", "pages were")} straightened and redrawn: ${shown}${tally.straightened.length > 6 ? ` and ${tally.straightened.length - 6} more` : ""}`);
    }
    const lost = [];
    if (tally.untouched.length) lost.push(`${plural(tally.untouched.length, "page", "pages")} had no clear lines of text to find a tilt from, so ${tally.untouched.length === 1 ? "it was" : "they were"} not straightened`);
    if (tally.lostLinks) lost.push(`${plural(tally.lostLinks, "straightened page", "straightened pages")} had links or form fields, which are not carried over`);
    for (const s of [list("Changed", changed), list("Not done", lost)]) if (s) box.appendChild(s);
    $("results").classList.add("visible");
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "rotate-pdf-freely",
        blob,
        filename: outName,
        els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Sorted, ${plural(work.length, "page", "pages")} changed (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, err instanceof OpenProblem ? err.message : `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
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
  setStatus(statusEl, "Stopping…", "");
});

$("downloadBtn").addEventListener("click", () => { if (state.result) triggerDownload(state.result.blob, state.result.outName); });

updatePlan();
