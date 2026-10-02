import { PDFLib } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const formFieldsEl = document.getElementById("formFields");
const flattenCheck = document.getElementById("flattenCheck");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let currentFile = null;
let currentBytes = null;

function fieldRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  label.style.marginBottom = "4px";
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

async function loadForm(bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes.slice());
  const form = doc.getForm();
  const fields = form.getFields();

  formFieldsEl.innerHTML = "";

  if (fields.length === 0) {
    const msg = document.createElement("p");
    msg.className = "help-text";
    msg.textContent = "No fillable fields found in this PDF.";
    formFieldsEl.appendChild(msg);
    return;
  }

  for (const field of fields) {
    const name = field.getName();

    if (field instanceof PDFLib.PDFTextField) {
      const input = document.createElement("input");
      input.type = "text";
      input.style.width = "100%";
      input.dataset.fieldName = name;
      input.dataset.fieldType = "text";
      try { input.value = field.getText() || ""; } catch (e) { /* ignore */ }
      formFieldsEl.appendChild(fieldRow(name, input));
    } else if (field instanceof PDFLib.PDFCheckBox) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.style.flexDirection = "row";
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "8px";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.fieldName = name;
      input.dataset.fieldType = "checkbox";
      input.checked = field.isChecked();
      label.appendChild(input);
      label.appendChild(document.createTextNode(name));
      wrap.appendChild(label);
      formFieldsEl.appendChild(wrap);
    } else if (field instanceof PDFLib.PDFRadioGroup) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.textContent = name;
      wrap.appendChild(label);
      const optionsWrap = document.createElement("div");
      optionsWrap.className = "radio-group";
      const selected = field.getSelected();
      for (const opt of field.getOptions()) {
        const optLabel = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `radio-${name}`;
        radio.value = opt;
        radio.dataset.fieldName = name;
        radio.dataset.fieldType = "radio";
        radio.checked = opt === selected;
        optLabel.appendChild(radio);
        optLabel.appendChild(document.createTextNode(" " + opt));
        optionsWrap.appendChild(optLabel);
      }
      wrap.appendChild(optionsWrap);
      formFieldsEl.appendChild(wrap);
    } else if (field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFOptionList) {
      const select = document.createElement("select");
      select.dataset.fieldName = name;
      select.dataset.fieldType = "dropdown";
      const selected = field.getSelected() || [];
      for (const opt of field.getOptions()) {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = opt;
        optionEl.selected = selected.includes(opt);
        select.appendChild(optionEl);
      }
      formFieldsEl.appendChild(fieldRow(name, select));
    }
    // PDFButton and other exotic field types are not editable data fields — skipped intentionally.
  }
}

async function handleFiles(files) {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  try {
    currentBytes = new Uint8Array(await pdf.arrayBuffer());
    await loadForm(currentBytes);
    editor.style.display = "block";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
}

initDropzone(dropzone, fileInput, handleFiles);

if (window.KeepSorted) {
  KeepSorted.init({ currentTool: "fill-pdf-form", dropzone, onFiles: handleFiles });
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

saveBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  saveBtn.disabled = true;
  setStatus(statusEl, "Saving…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const form = doc.getForm();

    const seenRadioNames = new Set();

    formFieldsEl.querySelectorAll("[data-field-name]").forEach((el) => {
      const name = el.dataset.fieldName;
      const type = el.dataset.fieldType;
      if (type === "text") {
        form.getTextField(name).setText(el.value);
      } else if (type === "checkbox") {
        const cb = form.getCheckBox(name);
        if (el.checked) cb.check(); else cb.uncheck();
      } else if (type === "radio") {
        if (el.checked) {
          form.getRadioGroup(name).select(el.value);
          seenRadioNames.add(name);
        }
      } else if (type === "dropdown") {
        form.getDropdown(name).select(el.value);
      }
    });

    if (flattenCheck.checked) form.flatten();

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const outName = brandFilename("fill-pdf-form", stripExtension(currentFile.name), "pdf");
    triggerDownload(blob, outName);
    if (window.KeepSorted) {
      KeepSorted.offer({
        currentTool: "fill-pdf-form",
        blob,
        filename: outName,
        els: {
          section: document.getElementById("keepSorted"),
          list: document.getElementById("keepSortedList"),
          resetLink: document.getElementById("keepSortedReset"),
        },
        relatedSection: document.querySelector(".related-tools-section"),
      });
    }
    setStatus(statusEl, `Sorted — saved (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    saveBtn.disabled = false;
  }
});
