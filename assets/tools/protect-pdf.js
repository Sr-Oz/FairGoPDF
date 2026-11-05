// Protect PDF page. What state a file is in, how strong a password is, what the permission choices mean and how errors read is
// lock-core.js; the list of files and the finished files are lock-ui.js; this file is the settings and the work of protecting.
import { PDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";
import { probe, friendlyError, strengthOf, suggestPassword, makeOwnerPassword, checkPassword, permissionsFor, limitsOf, limitsFromFlags, joinWords, pagesText } from "/assets/tools/lock-core.js";
import { readerOpens, needsPassword, renderRows, renderResults, download, downloadZip } from "/assets/tools/lock-ui.js";
import { safeBaseName } from "/assets/tools/page-tools.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const runBtn = $("runBtn");

// entries: { file, bytes, state: open | restricted | locked | unreadable, pages, message, error }
const state = { entries: [], results: [], busy: false, generation: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
  statusEl.classList.add("visible");
}

const choices = () => ({ printing: $("printing").value, copy: $("allowCopy").checked, edit: $("allowEdit").checked, annotate: $("allowNotes").checked, assemble: $("allowPages").checked });
const workable = () => state.entries.filter((e) => e.state !== "unreadable");

// ---------------------------------------------------------------- the files

async function addFiles(files) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) { setMsg("Please choose PDF files.", "error"); return; }
  clearStatus(statusEl);
  for (const file of pdfs) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = await probe(bytes, PDFDocument);
    state.entries.push({ file, bytes, ...info });
  }
  $("results").classList.remove("visible");
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  refresh();
}
initDropzone(dropzone, $("fileInput"), addFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "protect-pdf", dropzone, onFiles: addFiles });

function clearAll() {
  state.generation++;
  Object.assign(state, { entries: [], results: [] });
  for (const id of ["userPassword", "confirmPassword", "ownerPassword", "currentPassword"]) $(id).value = "";
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  $("ownerBox").hidden = true;
  $("keepSorted").style.display = "none";
  clearStatus(statusEl);
  refresh();
}
$("clearBtn").addEventListener("click", () => { if (!state.busy) clearAll(); });

// ---------------------------------------------------------------- the settings

function refresh() {
  const list = workable();
  const locked = state.entries.some((e) => e.state === "locked");
  $("currentField").hidden = !locked;
  $("currentHelp").hidden = !locked;
  $("zipField").hidden = list.length < 2;
  renderRows($("fileList"), state.entries, "protect", (i) => { state.entries.splice(i, 1); refresh(); });
  $("fileList").hidden = !state.entries.length;
  dropzone.classList.toggle("compact", state.entries.length > 0);
  runBtn.disabled = state.busy || !list.length;
  $("clearBtn").disabled = state.busy || !state.entries.length;

  const pw = $("userPassword").value;
  const s = $("strength");
  const sg = pw ? strengthOf(pw) : null;
  s.textContent = sg ? `Strength: ${sg.label}.${sg.advice ? ` ${sg.advice}` : ""}` : "";
  s.hidden = !sg;
  const warn = pw ? checkPassword(pw, undefined, $("algorithm").value).warn : "";
  $("pwWarn").textContent = warn || "";
  $("pwWarn").hidden = !warn;

  const limits = limitsOf(choices());
  $("ownerHelp").textContent = !limits.length
    ? "Everything is allowed, so no owner password is needed. Leave this blank."
    : $("ownerPassword").value
      ? "This password lets you change the limits later."
      : "Leave this blank and a strong owner password is made for you and shown after protecting. Without one, whoever has the opening password could lift the limits.";

  const sum = $("summary");
  sum.classList.remove("is-error");
  const n = list.length;
  if (!state.entries.length) sum.textContent = "Add a PDF to begin.";
  else if (!n) { sum.textContent = "None of these files can be protected."; sum.classList.add("is-error"); }
  else if (!pw) sum.textContent = `${n} file${n === 1 ? "" : "s"} ready. Choose a password.`;
  else sum.textContent = `${n} file${n === 1 ? "" : "s"} will be locked with ${$("algorithm").value}${limits.length ? `, holding back ${joinWords(limits)}` : ""}.`;
}

for (const id of ["userPassword", "confirmPassword", "ownerPassword", "currentPassword", "printing", "allowCopy", "allowEdit", "allowNotes", "allowPages", "algorithm"]) {
  $(id).addEventListener("input", refresh);
  $(id).addEventListener("change", refresh);
}

$("showPw").addEventListener("change", () => {
  for (const id of ["userPassword", "confirmPassword", "ownerPassword", "currentPassword"]) $(id).type = $("showPw").checked ? "text" : "password";
});

$("suggestBtn").addEventListener("click", () => {
  const p = suggestPassword();
  $("userPassword").value = p;
  $("confirmPassword").value = p;
  $("showPw").checked = true;
  $("showPw").dispatchEvent(new Event("change"));
  refresh();
  setMsg("A password was filled in for you. Copy it somewhere safe before you protect the files: nobody can get it back for you.");
});

$("copyOwner").addEventListener("click", async () => {
  const text = $("ownerShown").textContent;
  try { await navigator.clipboard.writeText(text); $("copyOwner").textContent = "Copied"; } catch (err) { window.getSelection().selectAllChildren($("ownerShown")); $("copyOwner").textContent = "Selected, press copy"; }
  setTimeout(() => { $("copyOwner").textContent = "Copy"; }, 2500);
});

if (window.FGPAcc) {
  FGPAcc.set("password", () => ($("userPassword").value ? strengthOf($("userPassword").value).label : "Choose one"));
  FGPAcc.set("limits", () => { const n = limitsOf(choices()).length; return n ? `${n} limit${n === 1 ? "" : "s"}` : "Everything allowed"; });
  FGPAcc.set("output", () => $("algorithm").value);
}

// ---------------------------------------------------------------- protecting

function stop(message) {
  setMsg(message, "error");
  $("summary").textContent = message; // the strip beside the button is always in view, which the status box is not on a phone
  $("summary").classList.add("is-error");
}

runBtn.addEventListener("click", async () => {
  const list = workable();
  if (!list.length || state.busy) return;
  const algorithm = $("algorithm").value;
  const pw = $("userPassword").value;
  const bad = checkPassword(pw, $("confirmPassword").value, algorithm);
  if (bad.error) { stop(bad.error); $(pw ? "confirmPassword" : "userPassword").focus(); return; }
  const current = $("currentPassword").value;
  if (list.some((e) => e.state === "locked") && !current) { stop("One of the files already has a password. Type it under Password so it can be changed."); $("currentPassword").focus(); return; }
  const c = choices();
  const limits = limitsOf(c);
  const typedOwner = $("ownerPassword").value;
  const generated = !typedOwner && limits.length > 0;
  const owner = typedOwner || (limits.length ? makeOwnerPassword() : pw);
  const ownerBad = typedOwner ? checkPassword(typedOwner, undefined, algorithm) : {};
  if (ownerBad.error) { stop(ownerBad.error.replace("Choose a password to open the PDF.", "Choose an owner password or leave it blank.")); $("ownerPassword").focus(); return; }

  state.busy = true;
  runBtn.disabled = true;
  $("results").classList.remove("visible");
  state.results = [];
  list.forEach((e) => { e.error = ""; e.done = ""; });
  const generation = ++state.generation;
  try {
    for (const [i, entry] of list.entries()) {
      setMsg(list.length > 1 ? `Protecting file ${i + 1} of ${list.length}…` : "Protecting…");
      await new Promise((r) => setTimeout(r, 0));
      try {
        const doc = entry.state === "open" ? await PDFDocument.load(entry.bytes.slice()) : await PDFDocument.load(entry.bytes.slice(), { password: entry.state === "locked" ? current : "" });
        const pages = doc.getPageCount();
        doc.encrypt({ userPassword: pw, ownerPassword: owner, algorithm, permissions: permissionsFor(c) });
        const bytes = await doc.save();
        // a second reader opens the result: it must refuse without the password, and open with it
        if (!(await needsPassword(bytes))) throw new Error("the finished file opens without a password");
        const seen = await readerOpens(bytes, pw);
        if (seen.pages !== pages) throw new Error("the finished file has a different number of pages");
        const held = limitsFromFlags(seen.allowed);
        state.results.push({ name: brandFilename("protect-pdf", safeBaseName(stripExtension(entry.file.name), "protected"), "pdf"), bytes, pages, note: held.length ? `Opens only with the password. Holds back ${joinWords(held)}.` : "Opens only with the password." });
        entry.done = `Protected, ${pagesText(pages)}.`;
      } catch (err) {
        const e = friendlyError(err);
        entry.error = e.kind === "password" ? "The current password didn't work for this file." : e.text;
      }
      if (generation !== state.generation) return;
    }
    const failed = list.filter((e) => e.error).length;
    if (state.results.length) {
      renderResults({ box: $("resultItems"), total: $("resultTotal"), zip: $("zipBtn") }, state.results, { tool: "protect-pdf", zipName: safeBaseName($("zipName").value, "protected-pdfs"), onDownload: download });
      $("ownerShown").textContent = generated ? owner : "";
      $("ownerBox").hidden = !generated;
      $("resultNote").textContent = `Each file was opened again to check: it needs the password, and it opens with it. If the password is lost, nobody can recover the file.${failed ? ` ${failed} file${failed === 1 ? "" : "s"} could not be protected, see the list.` : ""}`;
      $("results").classList.add("visible");
      if (state.results.length === 1) download(state.results[0]);
      else downloadZip(state.results, "protect-pdf", safeBaseName($("zipName").value, "protected-pdfs"));
      if (window.KeepSorted && state.results.length === 1) {
        KeepSorted.offer({ currentTool: "protect-pdf", blob: new Blob([state.results[0].bytes], { type: "application/pdf" }), filename: state.results[0].name, els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") }, relatedSection: document.querySelector(".related-tools-section") });
      }
      setMsg(failed ? `Protected ${state.results.length}, ${failed} could not be.` : `Sorted, ${state.results.length === 1 ? "protected" : `${state.results.length} files protected`}.`, failed ? "error" : "success");
    } else {
      setMsg("None of the files could be protected, see the list.", "error");
    }
  } catch (err) {
    console.error(err);
    setMsg(`Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    state.busy = false;
    refresh();
  }
});

refresh();
