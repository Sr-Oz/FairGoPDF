// What Protect PDF and Unlock PDF share on the page: the list of files with what each is like, the list of finished files with a
// ZIP for several, and checking a finished file by opening it with a second, independent PDF reader (pdf.js).
import { pdfjsLib } from "/assets/tools/pdf-common.js";
import { stateLine } from "/assets/tools/lock-core.js";
import * as fflate from "/assets/vendor/fflate.min.js";

// Open bytes with pdf.js. -> { pages, allowed } where allowed is the reader's list of permitted actions (null when not protected);
// throws with .name "PasswordException" when a password is needed or wrong.
export async function readerOpens(bytes, password) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(), password });
  try {
    const doc = await task.promise;
    return { pages: doc.numPages, allowed: await doc.getPermissions() };
  } finally {
    task.destroy();
  }
}

export const needsPassword = async (bytes) => {
  try { await readerOpens(bytes); return false; } catch (err) { return err && err.name === "PasswordException"; }
};

// The files added, one row each. entries: [{ file, state, pages, limits, message, error, done }]
export function renderRows(listEl, entries, tool, onRemove) {
  listEl.innerHTML = "";
  entries.forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = "lock-row";
    const bad = !!entry.error || entry.state === "unreadable";
    li.innerHTML = `<div class="info"><div class="ci-name">${escapeHtml(entry.file.name)}</div><div class="ci-line ${bad ? "ci-bigger" : "ci-muted"}">${escapeHtml(stateLine(entry, tool))}</div></div>`;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "remove";
    x.textContent = "✕";
    x.setAttribute("aria-label", `Remove ${entry.file.name}`);
    x.addEventListener("click", () => onRemove(i));
    li.appendChild(x);
    listEl.appendChild(li);
  });
}

// The finished files, one row each with its own Download, and a ZIP for two or more.
//   els: { box, total, zip }; results: [{ name, bytes, pages, note }]
export function renderResults(els, results, { tool, zipName, onDownload }) {
  const total = results.reduce((n, r) => n + r.bytes.length, 0);
  els.total.textContent = `${results.length} file${results.length === 1 ? "" : "s"}, ${formatBytes(total)}`;
  els.zip.hidden = results.length < 2;
  els.zip.onclick = () => downloadZip(results, tool, zipName);
  els.box.innerHTML = "";
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "result-item";
    row.innerHTML = `<div class="info"><div class="ci-name">${escapeHtml(r.name)}</div><div class="ci-line ci-muted">${r.pages} page${r.pages === 1 ? "" : "s"} · ${formatBytes(r.bytes.length)}</div>${r.note ? `<div class="ci-note">${escapeHtml(r.note)}</div>` : ""}</div>`;
    const dl = document.createElement("button");
    dl.className = "btn small";
    dl.type = "button";
    dl.textContent = "Download";
    dl.addEventListener("click", () => onDownload(r));
    row.appendChild(dl);
    els.box.appendChild(row);
  }
}

// the pages are already compressed inside, so storing the files is as small as deflating them and much quicker
export function downloadZip(results, tool, zipName) {
  const entries = {};
  for (const r of results) entries[r.name] = r.bytes;
  triggerDownload(new Blob([fflate.zipSync(entries, { level: 0 })], { type: "application/zip" }), brandFilename(tool, zipName, "zip"));
}

export const download = (r) => triggerDownload(new Blob([r.bytes], { type: "application/pdf" }), r.name);
