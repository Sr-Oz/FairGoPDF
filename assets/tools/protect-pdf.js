import { PDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const fileSummary = document.getElementById("fileSummary");
const userPasswordInput = document.getElementById("userPassword");
const ownerPasswordInput = document.getElementById("ownerPassword");
const allowPrinting = document.getElementById("allowPrinting");
const allowCopying = document.getElementById("allowCopying");
const allowModifying = document.getElementById("allowModifying");
const allowForms = document.getElementById("allowForms");
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
    if (check.isEncrypted) {
      setStatus(statusEl, "This PDF is already password protected. Use Unlock PDF first if you want to change its password.", "error");
      statusEl.classList.add("visible");
      editor.style.display = "none";
      return;
    }

    currentFile = pdf;
    currentBytes = bytes;
    fileSummary.textContent = `${pdf.name} (${formatBytes(pdf.size)}, ${check.getPageCount()} page${check.getPageCount() > 1 ? "s" : ""})`;
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
  userPasswordInput.value = "";
  ownerPasswordInput.value = "";
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const userPassword = userPasswordInput.value;
  if (!userPassword) {
    setStatus(statusEl, "Enter a password that will be needed to open the PDF.", "error");
    statusEl.classList.add("visible");
    userPasswordInput.focus();
    return;
  }

  const ownerPassword = ownerPasswordInput.value.trim() || userPassword;

  runBtn.disabled = true;
  setStatus(statusEl, "Encrypting…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFDocument.load(currentBytes.slice());
    doc.encrypt({
      userPassword,
      ownerPassword,
      algorithm: "AES-256",
      permissions: {
        printing: allowPrinting.checked ? "highResolution" : false,
        copying: allowCopying.checked,
        modifying: allowModifying.checked,
        fillingForms: allowForms.checked,
        annotating: allowModifying.checked,
        documentAssembly: allowModifying.checked,
        contentAccessibility: true,
      },
    });
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-protected.pdf`);
    setStatus(statusEl, `Sorted — your PDF is now password protected (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
