// Fill PDF Form: the rules (what a form's fields are, where they sit on the page as shown, what counts as filled, which text the
// PDF's own font can set, how values go back into the form), kept apart from the page so they can be tested. No DOM and no PDF
// library in here; the form that values are written to is passed in.
import { pdfSafe } from "/assets/tools/sign-core.js";

// ---------------------------------------------------------------- where a field sits

// A field's rectangle (the page's own coordinates, as pdf.js reports it: [x1, y1, x2, y2]) as a box on the page the way a viewer
// shows it (crop box, with /Rotate applied), measured from the top left as fractions of the shown page: { x, y, w, h }.
export function shownBox(rect, box, rotation = 0) {
  const rot = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const [ax, ay, bx, by] = rect;
  const corner = (px, py) => {
    const s = (px - box.x) / box.width;
    const t = (py - box.y) / box.height;
    if (rot === 90) return [t, s];
    if (rot === 180) return [1 - s, t];
    if (rot === 270) return [1 - t, 1 - s];
    return [s, 1 - t];
  };
  const [u1, v1] = corner(ax, ay);
  const [u2, v2] = corner(bx, by);
  return { x: Math.min(u1, u2), y: Math.min(v1, v2), w: Math.abs(u2 - u1), h: Math.abs(v2 - v1) };
}

// ---------------------------------------------------------------- reading the form

// "applicant.address[0]" -> "Address", "date_of_birth" -> "Date of birth", "firstName" -> "First name"
export function labelFor(name, tip) {
  const t = String(tip || "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 80 ? `${t.slice(0, 79)}…` : t;
  const last = String(name || "").split(".").pop().replace(/\[\d+\]$/, "");
  const words = last.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  if (!words) return "Field";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase().replace(/\bi\b/g, "I");
}

// Where text sits in the page's own points. A form's stated size is used when it is a sensible one for the box; otherwise the box
// decides (about two thirds of its height on one line, a steady 11 on several).
export function fontPoints(declared, heightPts, multiline) {
  const fits = declared >= 4 && declared <= 28 && declared <= heightPts * 0.9;
  if (fits) return declared;
  return multiline ? 11 : Math.min(Math.max(heightPts * 0.62, 6), 14);
}

const kindOf = (a) => {
  if (a.fieldType === "Tx") return a.multiLine ? "multiline" : "text";
  if (a.fieldType === "Ch") return a.combo ? "choice" : "list";
  if (a.fieldType === "Btn") return a.checkBox ? "checkbox" : a.radioButton ? "radio" : "button";
  if (a.fieldType === "Sig") return "signature";
  return "other";
};

// Pull the fields out of what pdf.js says about each page's widgets.
//   pages: [{ annotations, box: {x, y, width, height}, rotation }]   (annotations are pdf.js's)
// -> { fields, signatures, ignored }   fields: in reading order, each
//   { name, kind: text | multiline | checkbox | radio | choice | list, label, required, readOnly, password, maxLen, comb, multiSelect,
//     options: [{ value, label }], initial, widgets: [{ page, x, y, w, h, value, size }], pages }
//   `initial` is what the form already holds: a string, true/false for a tick, or an array for a multiple-choice list
export function readFields(pages) {
  const byName = new Map();
  let signatures = 0;
  let ignored = 0;
  pages.forEach((pg, pageIndex) => {
    for (const a of pg.annotations || []) {
      if (a.subtype !== "Widget" || !a.fieldName) continue;
      if (a.hidden || (a.annotationFlags & 0x2) || (a.annotationFlags & 0x20)) continue; // hidden, or not for viewing
      const kind = kindOf(a);
      if (kind === "signature") { signatures++; continue; }
      if (kind === "button" || kind === "other") { ignored++; continue; }
      if (!Array.isArray(a.rect) || a.rect.length < 4) continue;
      let f = byName.get(a.fieldName);
      if (!f) {
        f = { name: a.fieldName, kind, label: labelFor(a.fieldName, a.alternativeText), required: !!a.required, readOnly: !!a.readOnly, password: !!a.password, maxLen: a.maxLen > 0 ? a.maxLen : 0, comb: !!a.comb, multiSelect: !!a.multiSelect, options: [], initial: "", widgets: [], pages: [] };
        if (kind === "checkbox") f.initial = a.fieldValue != null && a.fieldValue !== "Off" && a.fieldValue !== "" && a.fieldValue !== false;
        else if (kind === "radio") f.initial = a.fieldValue != null && a.fieldValue !== "Off" ? String(a.fieldValue) : "";
        else if (kind === "choice" || kind === "list") {
          f.options = (a.options || []).map((o) => ({ value: String(o.exportValue ?? o.displayValue ?? ""), label: String(o.displayValue ?? o.exportValue ?? "") }));
          const fv = Array.isArray(a.fieldValue) ? a.fieldValue.map(String) : a.fieldValue ? [String(a.fieldValue)] : [];
          f.initial = f.multiSelect ? fv : fv[0] || "";
        } else f.initial = a.fieldValue == null ? "" : Array.isArray(a.fieldValue) ? a.fieldValue.join("\n") : String(a.fieldValue);
        byName.set(a.fieldName, f);
      }
      const box = shownBox(a.rect, pg.box, pg.rotation);
      const heightPts = Math.abs(a.rect[3] - a.rect[1]);
      f.widgets.push({ page: pageIndex, ...box, value: kind === "radio" ? String(a.buttonValue ?? a.exportValue ?? "") : "", size: fontPoints(a.defaultAppearanceData ? a.defaultAppearanceData.fontSize : 0, heightPts, kind === "multiline") });
      if (!f.pages.includes(pageIndex)) f.pages.push(pageIndex);
      // a radio button's own on-value, so a group's options are the values of its buttons
      if (kind === "radio" && !f.options.some((o) => o.value === f.widgets[f.widgets.length - 1].value)) {
        const v = f.widgets[f.widgets.length - 1].value;
        f.options.push({ value: v, label: v });
      }
    }
  });
  const fields = [...byName.values()];
  const first = (f) => f.widgets[0];
  fields.sort((a, b) => first(a).page - first(b).page || Math.round((first(a).y - first(b).y) * 100) || first(a).x - first(b).x);
  return { fields, signatures, ignored };
}

// ---------------------------------------------------------------- what has been filled

export function isFilled(field, value) {
  if (field.kind === "checkbox") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? "").trim() !== "";
}

// the fields a person can fill: the form's read-only ones are left alone
export const fillable = (fields) => fields.filter((f) => !f.readOnly);

export function countFilled(fields, values) {
  const own = fillable(fields);
  let filled = 0;
  let requiredLeft = 0;
  for (const f of own) {
    const done = isFilled(f, values.get(f.name));
    if (done) filled++;
    else if (f.required) requiredLeft++;
  }
  return { filled, total: own.length, requiredLeft };
}

export function describeFill({ filled, total, requiredLeft }) {
  if (!total) return "No fields to fill.";
  const base = `${filled} of ${total} field${total === 1 ? "" : "s"} filled`;
  return requiredLeft ? `${base}, ${requiredLeft} required left.` : `${base}.`;
}

// the first empty field after `after` (a field name) in reading order, going round to the start
export function nextEmpty(fields, values, after) {
  const own = fillable(fields);
  const start = Math.max(0, own.findIndex((f) => f.name === after) + 1);
  return [...own.slice(start), ...own.slice(0, start)].find((f) => !isFilled(f, values.get(f.name))) || null;
}

// ---------------------------------------------------------------- checking before saving

// What would stop a field being saved: text the form's font can't set, or text over the field's limit.
export function problemsWith(fields, values) {
  const out = [];
  for (const f of fillable(fields)) {
    if (f.kind !== "text" && f.kind !== "multiline") continue;
    const v = String(values.get(f.name) ?? "");
    if (!v) continue;
    if (!pdfSafe(f.kind === "multiline" ? v.replace(/\r\n|\r|\n/g, " ") : v)) out.push({ name: f.name, label: f.label, why: "chars" });
    else if (f.maxLen && v.length > f.maxLen) out.push({ name: f.name, label: f.label, why: "long" });
  }
  return out;
}

export function describeProblem(p) {
  return p.why === "chars" ? `"${p.label}" has a character this form's font can't show (such as a macron or a non-Latin letter).` : `"${p.label}" is longer than the form allows.`;
}

// ---------------------------------------------------------------- writing it back

// Put the values into the form (a pdf-lib form). Only fields whose value changed from what the form held are touched, so the rest of
// the form is left exactly as it was. Returns { changed, failed: [{ name, label, reason }] }.
export function writeValues(form, fields, values) {
  let changed = 0;
  const failed = [];
  for (const f of fillable(fields)) {
    const v = values.has(f.name) ? values.get(f.name) : f.initial;
    const same = Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(f.initial) : v === f.initial;
    if (same) continue;
    try {
      if (f.kind === "text" || f.kind === "multiline") {
        const t = form.getTextField(f.name);
        // a field that sizes its own text would fill a many-lined box with a few huge letters, so it gets the size shown on the page
        if (f.kind === "multiline" && f.widgets[0]) t.setFontSize(f.widgets[0].size);
        if (String(v) === "") t.setText(undefined); else t.setText(String(v));
      } else if (f.kind === "checkbox") {
        const c = form.getCheckBox(f.name);
        if (v) c.check(); else c.uncheck();
      } else if (f.kind === "radio") {
        const r = form.getRadioGroup(f.name);
        if (v) r.select(String(v)); else r.clear();
      } else if (f.kind === "choice") {
        const d = form.getDropdown(f.name);
        if (v) d.select(String(v)); else d.clear();
      } else if (f.kind === "list") {
        const l = form.getOptionList(f.name);
        const picked = Array.isArray(v) ? v : v ? [v] : [];
        if (picked.length) l.select(picked); else l.clear();
      }
      changed++;
    } catch (err) {
      failed.push({ name: f.name, label: f.label, reason: String((err && err.message) || err) });
    }
  }
  return { changed, failed };
}

// A form can carry a second, dynamic copy of itself (XFA) that some viewers read instead of the fields. Left in, it would show the
// old answers over the new ones. This takes it out; returns whether there was one.
export function dropXfa(form, PDFName) {
  const dict = form.acroForm.dict;
  const key = PDFName.of("XFA");
  if (!dict.has(key)) return false;
  dict.delete(key);
  return true;
}
