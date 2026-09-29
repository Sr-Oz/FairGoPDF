import { renderTablePdf } from "/assets/tools/doc-pdf-render.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const inputText = document.getElementById("inputText");
const pageSizeSelect = document.getElementById("pageSize");
const landscapeToggle = document.getElementById("landscapeToggle");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv");
  if (!file) {
    setStatus(statusEl, "Please choose a .csv file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  inputText.value = await file.text();
  clearStatus(statusEl);
});

clearBtn.addEventListener("click", () => {
  inputText.value = "";
  fileInput.value = "";
  clearStatus(statusEl);
});

// A small hand-written CSV parser (not a naive split on commas) so quoted
// fields can contain commas, line breaks, and escaped ("") quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

runBtn.addEventListener("click", async () => {
  const csvText = inputText.value;
  if (!csvText.trim()) {
    setStatus(statusEl, "Paste or add some CSV first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building PDF…", "");
  statusEl.classList.add("visible");

  try {
    const rows = parseCsv(csvText);
    if (!rows.length) throw new Error("no rows found");

    const doc = await renderTablePdf(rows, pageSizeSelect.value, landscapeToggle.checked);
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, "table.pdf");
    setStatus(statusEl, `Sorted — created a ${doc.getPageCount()}-page PDF (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
