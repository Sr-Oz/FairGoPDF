// QR Code Generator page. What the code says comes from qr-content.js, how it looks from qr-style.js, and the drawing from
// qr-code-styling (self-hosted in /assets/vendor). Everything happens in the browser; nothing is sent anywhere.
import { h, icon } from "/assets/tools/dom-helpers.js";
import { TYPES, encode, defaultValues } from "/assets/tools/qr-content.js";
import {
  DEFAULT_STYLE, TEMPLATES, DOT_TYPES, CORNER_SQUARE_TYPES, CORNER_DOT_TYPES, ICONS,
  iconDataUrl, normaliseHex, scanWarnings, toOptions, applyTemplate,
} from "/assets/tools/qr-style.js";

const QRCodeStyling = window.QRCodeStyling;
const SAMPLE = "https://fairgopdf.au/qr-code-generator/";
const PREVIEW_SIZE = 300;

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

const state = {
  type: "url",
  values: Object.fromEntries(TYPES.map((t) => [t.id, defaultValues(t.id)])),
  style: applyTemplate({ ...DEFAULT_STYLE, icon: { ...DEFAULT_STYLE.icon } }, TEMPLATES[0]), // Fair Go teal, the brand colours
  template: TEMPLATES[0].id,
  tab: "content",
};


function currentEncoded() {
  return encode(state.type, state.values[state.type]);
}

// ---------------------------------------------------------------- tabs

const TAB_IDS = ["content", "style", "templates"];
function showTab(id, focus = false) {
  state.tab = id;
  for (const t of TAB_IDS) {
    const tab = $(`tab-${t}`), panel = $(`panel-${t}`);
    const on = t === id;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    if (on && focus) tab.focus();
  }
  if (id === "templates") renderTemplates();
}
TAB_IDS.forEach((t, i) => {
  $(`tab-${t}`).addEventListener("click", () => showTab(t));
  $(`tab-${t}`).addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) { e.preventDefault(); showTab(TAB_IDS[(i + step + TAB_IDS.length) % TAB_IDS.length], true); }
  });
});

// ---------------------------------------------------------------- content tab

function buildTypes() {
  const wrap = $("qrTypes");
  wrap.replaceChildren(...TYPES.map((t) => h("button", {
    type: "button", class: "qr-type", "data-type": t.id, "aria-pressed": String(t.id === state.type),
    onclick: () => { state.type = t.id; buildTypes(); buildForm(); schedule(); },
  }, icon(t.icon), h("span", { text: t.label }))));
}

function fieldVisible(field, values) {
  if (!field.showWhen) return true;
  return Object.entries(field.showWhen).every(([key, allowed]) => allowed.includes(values[key]));
}

function buildForm() {
  const type = TYPES.find((t) => t.id === state.type);
  const values = state.values[state.type];
  const form = $("qrForm");
  const nodes = type.fields.map((f) => {
    const id = `qr-${state.type}-${f.key}`;
    let control;
    if (f.type === "textarea") {
      control = h("textarea", { id, rows: f.rows || 3, placeholder: f.placeholder, maxlength: 1500 });
      control.value = values[f.key];
    } else if (f.type === "select") {
      control = h("select", { id }, f.options.map(([v, label]) => h("option", { value: v, text: label })));
      control.value = values[f.key];
    } else if (f.type === "checkbox") {
      control = h("input", { id, type: "checkbox" });
      control.checked = !!values[f.key];
    } else {
      control = h("input", { id, type: f.type === "url" ? "text" : f.type, placeholder: f.placeholder, inputmode: f.inputmode || (f.type === "url" ? "url" : undefined), autocomplete: f.autocomplete || "off", spellcheck: "false" });
      control.value = values[f.key];
    }
    const onInput = () => {
      values[f.key] = f.type === "checkbox" ? control.checked : control.value;
      if (f.type === "select") applyVisibility();
      schedule();
    };
    control.addEventListener(f.type === "select" || f.type === "checkbox" ? "change" : "input", onInput);
    const label = h("label", { for: id, text: f.label + (f.required ? " *" : "") });
    return {
      field: f,
      node: h("div", { class: `qr-field${f.wide || f.type === "textarea" || f.type === "select" ? " qr-wide" : ""}${f.type === "checkbox" ? " qr-check" : ""}` },
        f.type === "checkbox" ? [control, label] : [label, control]),
    };
  });
  function applyVisibility() {
    nodes.forEach(({ field, node }) => { node.hidden = !fieldVisible(field, values); });
  }
  form.replaceChildren(...nodes.map((n) => n.node));
  applyVisibility();
  const hint = {
    whatsapp: "Use the full international number, for example +61 400 000 000.",
    social: "You can also paste the whole profile address instead of a username.",
    lostfound: "Anyone who scans this code will see what you type here, so use a phone number or email you are happy to share. Test it before you print it on a tag.",
    app: "A code can point to one store only. For both, make one code for each, or point a single code at a page of your own that links to both.",
  }[type.id] || "";
  $("qrHint").textContent = hint;
  $("qrHint").hidden = !hint;
}

// ---------------------------------------------------------------- style tab

const COLOUR_FIELDS = [
  ["dotsColour", "dotsGradient", "Dots"],
  ["cornersSquareColour", "cornersSquareGradient", "Corner squares"],
  ["cornersDotColour", "cornersDotGradient", "Corner dots"],
  ["background", null, "Background"],
];

function buildStyleTab() {
  const colours = $("qrColours");
  colours.replaceChildren(...COLOUR_FIELDS.map(([key, gradKey, label]) => {
    const text = h("input", { type: "text", id: `col-${key}`, maxlength: 7, spellcheck: "false", autocomplete: "off", "aria-label": `${label} colour as a hex code` });
    const picker = h("input", { type: "color", id: `pick-${key}`, "aria-label": `${label} colour picker` });
    const apply = (hex) => {
      state.style[key] = hex;
      if (gradKey) state.style[gradKey] = null;
      state.template = null;
      syncStyleUI();
      schedule();
    };
    text.addEventListener("input", () => {
      const hex = normaliseHex(text.value);
      text.setAttribute("aria-invalid", String(!hex));
      if (hex) apply(hex);
    });
    text.addEventListener("blur", () => { text.value = state.style[key]; text.removeAttribute("aria-invalid"); });
    picker.addEventListener("input", () => apply(picker.value));
    return h("div", { class: "qr-colour" }, h("label", { for: `col-${key}`, text: label }), h("div", { class: "qr-colour-input" }, picker, text));
  }));

  const shapes = [["dotsType", "Dot style", DOT_TYPES], ["cornersSquareType", "Corner square style", CORNER_SQUARE_TYPES], ["cornersDotType", "Corner dot style", CORNER_DOT_TYPES]];
  $("qrShapes").replaceChildren(...shapes.map(([key, label, options]) => {
    const select = h("select", { id: `shape-${key}` }, options.map(([v, l]) => h("option", { value: v, text: l })));
    select.addEventListener("change", () => { state.style[key] = select.value; state.template = null; syncStyleUI(); schedule(); });
    return h("div", { class: "qr-field" }, h("label", { for: `shape-${key}`, text: label }), select);
  }));

  const choices = [["", "None"], ...ICONS];
  $("qrIcons").replaceChildren(...choices.map(([id, label]) => {
    const btn = h("button", {
      type: "button", class: "qr-icon-btn", "data-icon": id, title: label,
      onclick: () => { state.style.icon = id ? { kind: "builtin", id, dataUrl: "" } : { kind: "none", id: "", dataUrl: "" }; syncStyleUI(); schedule(); },
    }, id ? h("img", { src: iconDataUrl(id, "#5a6b64"), alt: "", width: 24, height: 24 }) : h("span", { text: "None" }), h("span", { class: "visually-hidden", text: label }));
    return btn;
  }));

  $("qrLogoFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      state.style.icon = { kind: "upload", id: "", dataUrl: await shrinkImage(file, 480) };
      clearStatus(statusEl);
      syncStyleUI();
      schedule();
    } catch (err) {
      showError("That file couldn't be read as an image. Try a PNG, JPG, SVG or WebP.");
    }
  });
  $("qrLogoRemove").addEventListener("click", () => { state.style.icon = { kind: "none", id: "", dataUrl: "" }; syncStyleUI(); schedule(); });
  $("qrIconSize").addEventListener("input", () => { state.style.iconSize = Number($("qrIconSize").value) / 100; syncStyleUI(); schedule(); });
  $("qrErrorLevel").addEventListener("change", () => { state.style.errorLevel = $("qrErrorLevel").value; schedule(); });
  $("qrSameColour").addEventListener("click", () => {
    const s = state.style;
    s.cornersSquareColour = s.cornersDotColour = s.dotsColour;
    s.cornersSquareGradient = s.cornersDotGradient = s.dotsGradient;
    state.template = null;
    syncStyleUI();
    schedule();
  });
}

// Reads a picture and returns a PNG data URL no bigger than `max` pixels, so a large photo doesn't bloat the code or the SVG
async function shrinkImage(file, max) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

function syncStyleUI() {
  const s = state.style;
  for (const [key, gradKey] of COLOUR_FIELDS) {
    const text = $(`col-${key}`), picker = $(`pick-${key}`);
    if (document.activeElement !== text) text.value = s[key];
    picker.value = s[key];
    text.classList.toggle("is-gradient", !!(gradKey && s[gradKey]));
  }
  $("qrGradientNote").hidden = !(s.dotsGradient || s.cornersSquareGradient || s.cornersDotGradient);
  for (const key of ["dotsType", "cornersSquareType", "cornersDotType"]) $(`shape-${key}`).value = s[key];
  const iconId = s.icon.kind === "builtin" ? s.icon.id : "";
  document.querySelectorAll(".qr-icon-btn").forEach((b) => b.setAttribute("aria-pressed", String(s.icon.kind !== "upload" && b.dataset.icon === iconId)));
  const hasIcon = s.icon.kind !== "none";
  $("qrLogoRemove").hidden = s.icon.kind !== "upload";
  $("qrIconSizeField").hidden = !hasIcon;
  $("qrIconSize").value = Math.round(s.iconSize * 100);
  $("qrIconSizeVal").textContent = Math.round(s.iconSize * 100);
  $("qrErrorLevel").value = s.errorLevel;
  $("qrErrorLevel").disabled = hasIcon;
  $("qrErrorNote").hidden = !hasIcon;
  $("qrLogoName").textContent = s.icon.kind === "upload" ? "Your logo is in use" : "";
}

// ---------------------------------------------------------------- templates tab

function renderTemplates() {
  const { text } = currentEncoded();
  const data = text || SAMPLE;
  const grid = $("qrTemplates");
  grid.replaceChildren(...TEMPLATES.map((t) => {
    const holder = h("div", { class: "qr-template-art" });
    const style = applyTemplate(state.style, t);
    try { new QRCodeStyling(toOptions({ ...style, icon: state.style.icon }, data, 140, "svg")).append(holder); } catch (err) { /* too much data for a thumbnail: leave it blank */ }
    return h("button", {
      type: "button", class: "qr-template", "aria-pressed": String(state.template === t.id),
      onclick: () => { state.style = applyTemplate(state.style, t); state.template = t.id; syncStyleUI(); renderTemplates(); schedule(); },
    }, holder, h("span", { text: t.name }));
  }));
}

// ---------------------------------------------------------------- preview and download

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(render, 90);
}

function showError(message) {
  setStatus(statusEl, message, "error");
  statusEl.classList.add("visible");
}

function render() {
  const { text, problems } = currentEncoded();
  const stage = $("qrStage");
  const sample = !text;
  stage.classList.toggle("is-sample", sample);
  stage.replaceChildren();
  let tooLong = false;
  try {
    new QRCodeStyling(toOptions(state.style, sample ? SAMPLE : text, PREVIEW_SIZE, "svg")).append(stage);
  } catch (err) {
    tooLong = true;
    stage.replaceChildren();
  }
  const notes = [];
  if (tooLong) notes.push("That is too much to fit in one QR code. Shorten it a little.");
  notes.push(...problems);
  if (!sample) notes.push(...scanWarnings(state.style));
  $("qrNote").textContent = notes.join(" ");
  $("qrNote").classList.toggle("is-warning", notes.length > 0);
  $("qrSampleNote").hidden = !sample;
  $("downloadBtn").disabled = sample || tooLong;
  if (state.tab === "templates") renderTemplates();
}

async function download() {
  const { text } = currentEncoded();
  if (!text) return;
  const ext = $("qrFormat").value;
  const size = Number($("qrSize").value);
  const button = $("downloadBtn");
  button.disabled = true;
  try {
    const code = new QRCodeStyling(toOptions(state.style, text, size, ext === "svg" ? "svg" : "canvas"));
    const blob = await code.getRawData(ext);
    if (!blob) throw new Error("no image");
    triggerDownload(blob, brandFilename("qr-code-generator", `qr-${state.type}`, ext === "jpeg" ? "jpg" : ext));
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    showError("Couldn't make that file. Try another format or a smaller size.");
  } finally {
    button.disabled = false;
  }
}
$("downloadBtn").addEventListener("click", download);

// ---------------------------------------------------------------- start

buildTypes();
buildForm();
buildStyleTab();
syncStyleUI();
showTab("content");
render();
