// Unlock PDF page. What state a file is in and how errors read is lock-core.js; the list of files and the finished files are
// lock-ui.js; this file is the password and the work of unlocking.
import { PDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";
import { probe, friendlyError, limitsFromFlags, joinWords, pagesText } from "/assets/tools/lock-core.js";
import { readerOpens, renderRows, renderResults, download, downloadZip } from "/assets/tools/lock-ui.js";
import { safeBaseName } from "/assets/tools/page-tools.js";

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const statusEl = $("status");
const runBtn = $("runBtn");

// entries: { file, bytes, state: open | restricted | locked | unreadable, pages, limits, message, error, done, result }
const state = { entries: [], busy: false, generation: 0 };

function setMsg(message, kind = "") {
  setStatus(statusEl, message, kind);
}

const results = () => state.entries.filter((e) => e.result).map((e) => e.result);
const todo = () => state.entries.filter((e) => (e.state === "locked" || e.state === "restricted") && !e.result);

// ---------------------------------------------------------------- the files

async function addFiles(files) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) { setMsg("Please choose PDF files.", "error"); return; }
  clearStatus(statusEl);
  for (const file of pdfs) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = { file, bytes, ...(await probe(bytes, PDFDocument)) };
    if (entry.state === "restricted") {
      // what it holds back, as a second reader reports it
      try { entry.limits = limitsFromFlags((await readerOpens(bytes, "")).allowed); } catch (err) { entry.limits = []; }
    }
    state.entries.push(entry);
  }
  $("keepSorted").style.display = "none";
  document.querySelector(".related-tools-section").style.display = "";
  refresh();
}
initDropzone(dropzone, $("fileInput"), addFiles);
if (window.KeepSorted) KeepSorted.init({ currentTool: "unlock-pdf", dropzone, onFiles: addFiles });

$("clearBtn").addEventListener("click", () => {
  if (state.busy) return;
  state.generation++;
  state.entries = [];
  $("keepSorted").style.display = "none";
  $("password").value = "";
  $("fileInput").value = "";
  $("results").classList.remove("visible");
  clearStatus(statusEl);
  refresh();
});

// ---------------------------------------------------------------- the settings

function refresh() {
  const open = state.entries.filter((e) => e.state === "open").length;
  const locked = state.entries.filter((e) => e.state === "locked" && !e.result).length;
  const restricted = state.entries.filter((e) => e.state === "restricted" && !e.result).length;
  renderRows($("fileList"), state.entries, "unlock", (i) => { state.entries.splice(i, 1); refresh(); });
  $("fileList").hidden = !state.entries.length;
  dropzone.classList.toggle("compact", state.entries.length > 0);
  $("zipField").hidden = state.entries.filter((e) => e.state === "locked" || e.state === "restricted").length < 2;
  runBtn.disabled = state.busy || !todo().length;
  $("clearBtn").disabled = state.busy || !state.entries.length;

  const sum = $("summary");
  sum.classList.remove("is-error");
  const parts = [];
  if (locked) parts.push(`${locked} need${locked === 1 ? "s" : ""} a password`);
  if (restricted) parts.push(`${restricted} ${restricted === 1 ? "has" : "have"} limits only`);
  if (!state.entries.length) sum.textContent = "Add a PDF to begin.";
  else if (parts.length) sum.textContent = `${parts.join(", ")}.${open ? ` ${open} ${open === 1 ? "isn't" : "aren't"} protected.` : ""}`;
  else if (results().length) sum.textContent = `${results().length} unlocked.${open ? ` ${open} ${open === 1 ? "wasn't" : "weren't"} protected.` : ""}`;
  else { sum.textContent = open ? "Nothing here is protected, so there is nothing to unlock." : "None of these files can be unlocked."; }
  $("passwordHelp").hidden = !locked && !restricted;
}
$("password").addEventListener("input", refresh);
$("showPw").addEventListener("change", () => { $("password").type = $("showPw").checked ? "text" : "password"; });

if (window.FGPAcc) {
  FGPAcc.set("password", () => (state.entries.some((e) => e.state === "locked" && !e.result) ? ($("password").value ? "Entered" : "Needed") : "Not needed"));
  FGPAcc.set("output", () => (todo().length + results().length > 1 ? "ZIP for several" : "Keeps its name"));
}

// ---------------------------------------------------------------- unlocking

function stop(message) {
  setMsg(message, "error");
  $("summary").textContent = message; // the strip beside the button is always in view, which the status box is not on a phone
  $("summary").classList.add("is-error");
}

runBtn.addEventListener("click", async () => {
  const jobs = todo();
  if (!jobs.length || state.busy) return;
  const pw = $("password").value;
  if (!pw && jobs.every((e) => e.state === "locked")) { stop("Type the password first."); $("password").focus(); return; }
  state.busy = true;
  runBtn.disabled = true;
  const generation = ++state.generation;
  const fresh = [];
  try {
    for (const [i, entry] of jobs.entries()) {
      setMsg(jobs.length > 1 ? `Unlocking file ${i + 1} of ${jobs.length}…` : "Unlocking…");
      await new Promise((r) => setTimeout(r, 0));
      entry.error = "";
      try {
        const doc = await PDFDocument.load(entry.bytes.slice(), { password: entry.state === "locked" ? pw : "" });
        const pages = doc.getPageCount();
        const bytes = await doc.save();
        // a second reader opens the copy with no password: it must open, with nothing held back
        const seen = await readerOpens(bytes);
        if (seen.pages !== pages) throw new Error("the unlocked copy has a different number of pages");
        entry.result = { name: brandFilename("unlock-pdf", safeBaseName(stripExtension(entry.file.name), "unlocked"), "pdf"), bytes, pages, note: entry.state === "restricted" && entry.limits && entry.limits.length ? `Limits on ${joinWords(entry.limits)} removed.` : "Opens with no password." };
        entry.done = `Unlocked, ${pagesText(pages)}.`;
        fresh.push(entry.result);
      } catch (err) {
        const e = friendlyError(err);
        entry.error = e.kind === "password" ? (pw ? "That password didn't work for this file." : "Needs a password.") : e.text;
      }
      if (generation !== state.generation) return;
    }
    const all = results();
    const failed = jobs.filter((e) => e.error).length;
    if (all.length) {
      renderResults({ box: $("resultItems"), total: $("resultTotal"), zip: $("zipBtn") }, all, { tool: "unlock-pdf", zipName: safeBaseName($("zipName").value, "unlocked-pdfs"), onDownload: download });
      $("resultNote").textContent = `Each copy was opened again with no password to check it worked.${failed ? ` ${failed} file${failed === 1 ? "" : "s"} did not open, see the list: try another password and click Unlock again.` : ""}`;
      $("results").classList.add("visible");
    }
    if (fresh.length === 1) download(fresh[0]);
    else if (fresh.length > 1) downloadZip(fresh, "unlock-pdf", safeBaseName($("zipName").value, "unlocked-pdfs")); // just the ones made in this go
    if (window.KeepSorted && all.length === 1 && fresh.length === 1) {
      KeepSorted.offer({ currentTool: "unlock-pdf", blob: new Blob([fresh[0].bytes], { type: "application/pdf" }), filename: fresh[0].name, els: { section: $("keepSorted"), list: $("keepSortedList"), resetLink: $("keepSortedReset") }, relatedSection: document.querySelector(".related-tools-section") });
    }
    if (!fresh.length) stop(failed === 1 ? state.entries.find((e) => e.error).error : "None of the files opened with that password.");
    else setMsg(failed ? `Unlocked ${fresh.length}, ${failed} did not open.` : `Sorted, ${fresh.length === 1 ? "unlocked" : `${fresh.length} files unlocked`}.`, failed ? "error" : "success");
  } catch (err) {
    console.error(err);
    setMsg(`Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    state.busy = false;
    refresh();
  }
});

refresh();
