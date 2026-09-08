import { PDFLib, loadPdfJsDoc, renderPageThumbCanvas, renderPageToCanvasAtScale } from "/assets/tools/pdf-common.js";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const pageGrid = document.getElementById("pageGrid");
const stage = document.getElementById("formStage");
const editPanel = document.getElementById("fieldEditPanel");
const nameField = document.getElementById("nameField");
const fieldNameInput = document.getElementById("fieldName");
const textOptions = document.getElementById("textOptions");
const textDefaultInput = document.getElementById("textDefault");
const textMultilineInput = document.getElementById("textMultiline");
const checkboxOptions = document.getElementById("checkboxOptions");
const checkboxDefaultInput = document.getElementById("checkboxDefault");
const radioOptions = document.getElementById("radioOptions");
const radioGroupNameInput = document.getElementById("radioGroupName");
const radioOptionValueInput = document.getElementById("radioOptionValue");
const dropdownOptions = document.getElementById("dropdownOptions");
const dropdownValuesInput = document.getElementById("dropdownValues");
const confirmFieldBtn = document.getElementById("confirmFieldBtn");
const deleteFieldBtn = document.getElementById("deleteFieldBtn");
const cancelFieldBtn = document.getElementById("cancelFieldBtn");
const fieldListEl = document.getElementById("fieldList");
const clearPageBtn = document.getElementById("clearPageBtn");
const fieldSummary = document.getElementById("fieldSummary");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PREVIEW_WIDTH = 700;
const FIELD_TYPE_LABELS = { text: "Text field", checkbox: "Checkbox", radio: "Radio button", dropdown: "Dropdown" };
const FIELD_TYPE_ICONS = { text: "text_fields", checkbox: "check_box", radio: "radio_button_checked", dropdown: "arrow_drop_down_circle" };

let currentFile = null;
let currentBytes = null;
let pdfJsDoc = null;
let pageCount = 0;
let selectedPageIndex = 0;
let activeFieldType = "text";

let nextFieldId = 1;

// pageIndex (0-based) -> array of field objects.
// Common: { id, type, x, y, w, h } in PDF point space (origin bottom-left).
// text: { name, defaultValue, multiline }
// checkbox: { name, checkedDefault }
// radio: { groupName, optionValue }
// dropdown: { name, options: [] }
const fields = new Map();

let stageScale = 1;
let baseCanvas = null;
let dragStartPx = null;
let pendingRectPt = null;
let editingField = null;

initDropzone(dropzone, fileInput, async (files) => {
  const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    setStatus(statusEl, "Please choose a PDF file.", "error");
    statusEl.classList.add("visible");
    return;
  }
  currentFile = pdf;
  currentBytes = new Uint8Array(await pdf.arrayBuffer());
  fields.clear();

  try {
    setStatus(statusEl, "Rendering pages…", "");
    statusEl.classList.add("visible");
    pdfJsDoc = await loadPdfJsDoc(currentBytes.slice());
    pageCount = pdfJsDoc.numPages;
    pageGrid.innerHTML = "";
    selectedPageIndex = 0;

    for (let i = 1; i <= pageCount; i++) {
      const canvas = await renderPageThumbCanvas(pdfJsDoc, i, 160);
      const thumb = document.createElement("div");
      thumb.className = "page-thumb" + (i === 1 ? " selected" : "");
      thumb.dataset.pageIndex = String(i - 1);
      thumb.innerHTML = `<span class="page-num">${i}</span><span class="form-badge"></span>`;
      thumb.appendChild(canvas);
      thumb.addEventListener("click", () => selectPage(i - 1));
      pageGrid.appendChild(thumb);
    }

    editor.style.display = "block";
    clearStatus(statusEl);
    await selectPage(0);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not read that PDF: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

document.querySelectorAll("[data-field-type]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFieldType = btn.dataset.fieldType;
    document.querySelectorAll("[data-field-type]").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

async function selectPage(index) {
  closeEditPanel();
  selectedPageIndex = index;
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.pageIndex) === index);
  });

  const page = await pdfJsDoc.getPage(index + 1);
  const viewport1 = page.getViewport({ scale: 1 });
  stageScale = PREVIEW_WIDTH / viewport1.width;

  baseCanvas = await renderPageToCanvasAtScale(pdfJsDoc, index + 1, stageScale);
  stage.width = baseCanvas.width;
  stage.height = baseCanvas.height;
  redrawStage();
  renderFieldList();
}

function redrawStage(liveRectPx) {
  if (!baseCanvas) return;
  const ctx = stage.getContext("2d");
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);

  const pageFields = fields.get(selectedPageIndex) || [];
  pageFields.forEach((field) => {
    const box = ptRectToPx(field);
    ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
    ctx.strokeStyle = "#2563eb";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = "#2563eb";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(fieldLabel(field), box.x + 4, box.y + 14);
    ctx.restore();
    field._box = box;
  });

  if (liveRectPx) {
    ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
    ctx.strokeStyle = "#2563eb";
    ctx.fillRect(liveRectPx.x, liveRectPx.y, liveRectPx.w, liveRectPx.h);
    ctx.strokeRect(liveRectPx.x, liveRectPx.y, liveRectPx.w, liveRectPx.h);
  }
  ctx.setLineDash([]);
}

function fieldLabel(field) {
  if (field.type === "radio") return field.groupName ? `${field.groupName}: ${field.optionValue}` : "radio";
  return field.name || FIELD_TYPE_LABELS[field.type];
}

function ptRectToPx(r) {
  const x = r.x * stageScale;
  const w = r.w * stageScale;
  const h = r.h * stageScale;
  const y = stage.height - r.y * stageScale - h;
  return { x, y, w, h };
}

function pxRectToPt(xPx, yPx, wPx, hPx) {
  const x = xPx / stageScale;
  const w = wPx / stageScale;
  const h = hPx / stageScale;
  const y = (stage.height - yPx) / stageScale - h;
  return { x, y, w, h };
}

function stagePoint(e) {
  const rect = stage.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (stage.width / rect.width),
    y: (e.clientY - rect.top) * (stage.height / rect.height),
  };
}

function hitTestField(px, py) {
  const pageFields = fields.get(selectedPageIndex) || [];
  for (let i = pageFields.length - 1; i >= 0; i--) {
    const b = pageFields[i]._box;
    if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return pageFields[i];
  }
  return null;
}

stage.addEventListener("pointerdown", (e) => {
  if (!baseCanvas) return;
  const p = stagePoint(e);
  const hit = hitTestField(p.x, p.y);
  if (hit) {
    openEditPanel(hit, false);
    return;
  }
  dragStartPx = p;
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener("pointermove", (e) => {
  if (!dragStartPx) return;
  const p = stagePoint(e);
  const x = Math.min(dragStartPx.x, p.x);
  const y = Math.min(dragStartPx.y, p.y);
  const w = Math.abs(p.x - dragStartPx.x);
  const h = Math.abs(p.y - dragStartPx.y);
  redrawStage({ x, y, w, h });
});

stage.addEventListener("pointerup", (e) => {
  if (!dragStartPx) return;
  const p = stagePoint(e);
  const xPx = Math.min(dragStartPx.x, p.x);
  const yPx = Math.min(dragStartPx.y, p.y);
  const wPx = Math.abs(p.x - dragStartPx.x);
  const hPx = Math.abs(p.y - dragStartPx.y);
  dragStartPx = null;

  if (wPx < 8 || hPx < 8) {
    redrawStage();
    return;
  }

  pendingRectPt = pxRectToPt(xPx, yPx, wPx, hPx);
  openEditPanel(null, true, activeFieldType);
});

function showTypeOptions(type) {
  nameField.style.display = type === "radio" ? "none" : "block";
  textOptions.style.display = type === "text" ? "block" : "none";
  checkboxOptions.style.display = type === "checkbox" ? "block" : "none";
  radioOptions.style.display = type === "radio" ? "block" : "none";
  dropdownOptions.style.display = type === "dropdown" ? "block" : "none";
}

function openEditPanel(field, isNew, newType) {
  editingField = isNew ? null : field;
  editPanel.classList.add("visible");
  deleteFieldBtn.style.display = isNew ? "none" : "inline-flex";

  const type = isNew ? newType : field.type;
  showTypeOptions(type);

  if (isNew) {
    fieldNameInput.value = "";
    textDefaultInput.value = "";
    textMultilineInput.checked = false;
    checkboxDefaultInput.checked = false;
    radioGroupNameInput.value = "";
    radioOptionValueInput.value = "";
    dropdownValuesInput.value = "";
  } else {
    pendingRectPt = { x: field.x, y: field.y, w: field.w, h: field.h };
    if (type === "text") {
      fieldNameInput.value = field.name || "";
      textDefaultInput.value = field.defaultValue || "";
      textMultilineInput.checked = !!field.multiline;
    } else if (type === "checkbox") {
      fieldNameInput.value = field.name || "";
      checkboxDefaultInput.checked = !!field.checkedDefault;
    } else if (type === "radio") {
      radioGroupNameInput.value = field.groupName || "";
      radioOptionValueInput.value = field.optionValue || "";
    } else if (type === "dropdown") {
      fieldNameInput.value = field.name || "";
      dropdownValuesInput.value = (field.options || []).join(", ");
    }
    redrawStage();
  }
  editPanel.dataset.type = type;
}

function closeEditPanel() {
  editPanel.classList.remove("visible");
  editingField = null;
  pendingRectPt = null;
  redrawStage();
}

function effectiveName(field) {
  return field.type === "radio" ? field.groupName : field.name;
}

function isNameTaken(name, type, excludeId) {
  for (const list of fields.values()) {
    for (const f of list) {
      if (f.id === excludeId) continue;
      if (effectiveName(f) !== name) continue;
      if (type === "radio" && f.type === "radio") continue;
      return true;
    }
  }
  return false;
}

confirmFieldBtn.addEventListener("click", () => {
  const type = editPanel.dataset.type;
  const rect = pendingRectPt;

  if (type === "radio") {
    const groupName = radioGroupNameInput.value.trim();
    const optionValue = radioOptionValueInput.value.trim();
    if (!groupName || !optionValue) {
      setStatus(statusEl, "Enter both a group name and this option's value.", "error");
      statusEl.classList.add("visible");
      return;
    }
    if (isNameTaken(groupName, "radio", editingField?.id)) {
      setStatus(statusEl, `"${groupName}" is already used by a different field type.`, "error");
      statusEl.classList.add("visible");
      return;
    }
    applyField({ type, groupName, optionValue, ...rect });
  } else {
    const name = fieldNameInput.value.trim();
    if (!name) {
      setStatus(statusEl, "Enter a field name.", "error");
      statusEl.classList.add("visible");
      return;
    }
    if (isNameTaken(name, type, editingField?.id)) {
      setStatus(statusEl, `"${name}" is already used by another field.`, "error");
      statusEl.classList.add("visible");
      return;
    }
    if (type === "text") {
      applyField({ type, name, defaultValue: textDefaultInput.value, multiline: textMultilineInput.checked, ...rect });
    } else if (type === "checkbox") {
      applyField({ type, name, checkedDefault: checkboxDefaultInput.checked, ...rect });
    } else if (type === "dropdown") {
      const options = dropdownValuesInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length < 1) {
        setStatus(statusEl, "Enter at least one dropdown option.", "error");
        statusEl.classList.add("visible");
        return;
      }
      applyField({ type, name, options, ...rect });
    }
  }
  clearStatus(statusEl);
  closeEditPanel();
  renderFieldList();
});

function applyField(data) {
  if (editingField) {
    Object.assign(editingField, data);
  } else {
    if (!fields.has(selectedPageIndex)) fields.set(selectedPageIndex, []);
    fields.get(selectedPageIndex).push({ id: nextFieldId++, ...data });
  }
  updateBadgesAndSummary();
}

deleteFieldBtn.addEventListener("click", () => {
  if (!editingField) return;
  const list = fields.get(selectedPageIndex) || [];
  fields.set(selectedPageIndex, list.filter((f) => f !== editingField));
  closeEditPanel();
  updateBadgesAndSummary();
  renderFieldList();
});

cancelFieldBtn.addEventListener("click", closeEditPanel);

clearPageBtn.addEventListener("click", () => {
  closeEditPanel();
  fields.delete(selectedPageIndex);
  redrawStage();
  updateBadgesAndSummary();
  renderFieldList();
});

function renderFieldList() {
  const pageFields = fields.get(selectedPageIndex) || [];
  fieldListEl.innerHTML = "";
  pageFields.forEach((field) => {
    const row = document.createElement("div");
    row.className = "field-list-row";
    row.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">${FIELD_TYPE_ICONS[field.type]}</span>
      <span class="field-name">${escapeHtml(fieldLabel(field))}</span>
      <span class="field-type-tag">${FIELD_TYPE_LABELS[field.type]}</span>
      <button class="btn secondary small" type="button" data-edit>Edit</button>
      <button class="btn secondary small" type="button" data-delete>Delete</button>
    `;
    row.querySelector("[data-edit]").addEventListener("click", () => openEditPanel(field, false));
    row.querySelector("[data-delete]").addEventListener("click", () => {
      const list = fields.get(selectedPageIndex) || [];
      fields.set(selectedPageIndex, list.filter((f) => f !== field));
      updateBadgesAndSummary();
      redrawStage();
      renderFieldList();
    });
    fieldListEl.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateBadgesAndSummary() {
  pageGrid.querySelectorAll(".page-thumb").forEach((el) => {
    const idx = Number(el.dataset.pageIndex);
    el.classList.toggle("has-fields", fields.has(idx) && fields.get(idx).length > 0);
  });
  const markedPages = Array.from(fields.values()).filter((r) => r.length > 0).length;
  const totalFields = Array.from(fields.values()).reduce((sum, r) => sum + r.length, 0);
  fieldSummary.textContent = markedPages
    ? `${totalFields} field${totalFields > 1 ? "s" : ""} added across ${markedPages} page${markedPages > 1 ? "s" : ""}.`
    : "No fields added yet.";
}

clearBtn.addEventListener("click", () => {
  currentFile = null;
  currentBytes = null;
  pdfJsDoc = null;
  pageCount = 0;
  fields.clear();
  nextFieldId = 1;
  closeEditPanel();
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const markedPages = Array.from(fields.entries()).filter(([, l]) => l.length > 0);
  if (markedPages.length === 0) {
    setStatus(statusEl, "Add at least one field first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building form…", "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.load(currentBytes.slice());
    const pages = doc.getPages();
    const form = doc.getForm();
    const radioGroups = new Map();
    let totalFields = 0;

    for (const [pageIndex, pageFields] of fields.entries()) {
      const page = pages[pageIndex];
      if (!page) continue;
      for (const field of pageFields) {
        totalFields++;
        if (field.type === "radio") {
          if (!radioGroups.has(field.groupName)) radioGroups.set(field.groupName, []);
          radioGroups.get(field.groupName).push({ page, x: field.x, y: field.y, w: field.w, h: field.h, optionValue: field.optionValue });
          continue;
        }
        if (field.type === "text") {
          const tf = form.createTextField(field.name);
          if (field.multiline) tf.enableMultiline();
          if (field.defaultValue) tf.setText(field.defaultValue);
          tf.addToPage(page, { x: field.x, y: field.y, width: field.w, height: field.h });
        } else if (field.type === "checkbox") {
          const cb = form.createCheckBox(field.name);
          cb.addToPage(page, { x: field.x, y: field.y, width: field.w, height: field.h });
          if (field.checkedDefault) cb.check();
        } else if (field.type === "dropdown") {
          const dd = form.createDropdown(field.name);
          dd.addOptions(field.options);
          dd.addToPage(page, { x: field.x, y: field.y, width: field.w, height: field.h });
        }
      }
    }

    for (const [groupName, options] of radioGroups.entries()) {
      const rg = form.createRadioGroup(groupName);
      for (const opt of options) {
        rg.addOptionToPage(opt.optionValue, opt.page, { x: opt.x, y: opt.y, width: opt.w, height: opt.h });
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, `${stripExtension(currentFile.name)}-form.pdf`);
    setStatus(statusEl, `Sorted — added ${totalFields} field${totalFields > 1 ? "s" : ""} (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
