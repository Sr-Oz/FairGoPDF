import { PDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const fileSummary = document.getElementById("fileSummary");
const passwordField = document.getElementById("passwordField");
const passwordInput = document.getElementById("password");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }

  try {
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const check = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    currentFile = pdf;
    currentBytes = bytes;

    if (!check.isEncrypted) {
      fileSummary.textContent = `${pdf.name} isn't password protected, there's nothing to unlock.`;
      passwordField.style.display = "none";
      runBtn.disabled = true;
    } else {
      fileSummary.textContent = `${pdf.name} (${formatBytes(pdf.size)}) is password protected.`;
      passwordField.style.display = "block";
      runBtn.disabled = false;
    }
    editor.style.display = "block";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  passwordInput.value = "";
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const password = passwordInput.value;
  if (!password) {
    setStatus(statusEl, "Enter the PDF's password.", "error");
    statusEl.classList.add("visible");
    passwordInput.focus();
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Unlocking…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFDocument.load(currentBytes.slice(), { password });
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-unlocked.pdf`);
    setStatus(statusEl, `Sorted — the password has been removed (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    const message = /password incorrect/i.test(err.message || "")
      ? "Incorrect password, give it another go."
      : `Something went wrong: ${err.message || "unknown error"}`;
    setStatus(statusEl, message, "error");
  } finally {
    runBtn.disabled = false;
  }
});
