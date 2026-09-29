import { renderTablePdf } from "/assets/tools/doc-pdf-render.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const controls = document.getElementById("controls");
const actionsRow = document.getElementById("actionsRow");
const sheetSelect = document.getElementById("sheetSelect");
const pageSizeSelect = document.getElementById("pageSize");
const landscapeToggle = document.getElementById("landscapeToggle");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let workbook = null;

initDropzone(dropzone, fileInput, async (files) => {
  const file = files.find((f) => /\.(xlsx|xls|ods)$/i.test(f.name));
  if (!file) {
    setStatus(statusEl, "Please choose an .xlsx, .xls or .ods file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = file;
  try {
    setStatus(statusEl, "Reading spreadsheet…", "");
    statusEl.classList.add("visible");
    const data = new Uint8Array(await file.arrayBuffer());
    workbook = window.XLSX.read(data, { type: "array" });
    sheetSelect.innerHTML = "";
    workbook.SheetNames.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sheetSelect.appendChild(opt);
    });
    controls.style.display = "flex";
    actionsRow.style.display = "flex";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that file: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  workbook = null;
  controls.style.display = "none";
  actionsRow.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!workbook) return;
  runBtn.disabled = true;
  setStatus(statusEl, "Building PDF…", "");
  statusEl.classList.add("visible");

  try {
    const sheet = workbook.Sheets[sheetSelect.value];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
      .map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))))
      .filter((row) => row.some((cell) => cell !== ""));
    if (!rows.length) throw new Error("that sheet looks empty");

    const doc = await renderTablePdf(rows, pageSizeSelect.value, landscapeToggle.checked);
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}.pdf`);
    setStatus(statusEl, `Sorted — created a ${doc.getPageCount()}-page PDF (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
