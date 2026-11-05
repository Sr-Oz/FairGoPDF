import test from "node:test";
import assert from "node:assert/strict";
import * as PDFLib from "../assets/vendor/pdf-lib.esm.min.js";
import { loadAsset } from "./load.mjs";

const core = await loadAsset("assets/tools/fill-core.js");
const { shownBox, labelFor, fontPoints, readFields, isFilled, countFilled, describeFill, nextEmpty, problemsWith, describeProblem, writeValues, dropXfa } = core;

const box = { x: 0, y: 0, width: 600, height: 800 };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("on an upright page a field's box is measured from the top left", () => {
  const b = shownBox([60, 700, 360, 720], box, 0);
  assert.ok(close(b.x, 0.1) && close(b.y, 1 - 720 / 800) && close(b.w, 0.5) && close(b.h, 20 / 800));
});

test("on every rotation the box lands inside the page and keeps its size", () => {
  for (const rot of [0, 90, 180, 270]) {
    const b = shownBox([100, 200, 220, 230], box, rot);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9, `rotation ${rot}`);
    const turned = rot % 180 !== 0;
    // a 120 x 30 point field is 120 wide and 30 tall in the shown page, or the other way about when the page is turned
    const shownW = turned ? 800 : 600;
    const shownH = turned ? 600 : 800;
    assert.ok(close(b.w * shownW, turned ? 30 : 120) && close(b.h * shownH, turned ? 120 : 30), `rotation ${rot}`);
  }
});

test("a page turned 90 puts the page's own bottom-left at the shown top-left", () => {
  const b = shownBox([0, 0, 50, 20], box, 90);
  assert.ok(close(b.x, 0) && close(b.y, 0));
});

test("a crop box that does not start at the origin moves the field with it", () => {
  const b = shownBox([36, 20, 136, 40], { x: 36, y: 20, width: 500, height: 700 }, 0);
  assert.ok(close(b.x, 0) && close(b.y, 1 - 20 / 700) && close(b.w, 0.2));
});

test("labels come from the tooltip, or from the field's own name", () => {
  assert.equal(labelFor("applicant.address[0]"), "Address");
  assert.equal(labelFor("date_of_birth"), "Date of birth");
  assert.equal(labelFor("firstName"), "First name");
  assert.equal(labelFor("x", "  Your   full name "), "Your full name");
  assert.equal(labelFor("", ""), "Field");
  assert.ok(labelFor("a", "y".repeat(200)).length <= 80);
});

test("the form's own text size is used when it fits, otherwise the box decides", () => {
  assert.equal(fontPoints(10, 20, false), 10);
  assert.ok(close(fontPoints(0, 20, false), 12.4));
  assert.equal(fontPoints(51, 60, true), 11);
  assert.ok(close(fontPoints(17, 12, false), 7.44));
  assert.equal(fontPoints(0, 60, false), 14);
});

// what pdf.js says about widgets, trimmed to what the code reads
const w = (over) => ({ subtype: "Widget", annotationFlags: 4, hidden: false, readOnly: false, required: false, alternativeText: "", defaultAppearanceData: { fontSize: 0 }, ...over });
const sample = () => [
  {
    box, rotation: 0,
    annotations: [
      w({ fieldName: "applicant.name", fieldType: "Tx", rect: [200, 735, 500, 757], fieldValue: "" }),
      w({ fieldName: "agree", fieldType: "Btn", checkBox: true, exportValue: "Yes", fieldValue: "Off", rect: [200, 556, 218, 574] }),
      w({ fieldName: "contact", fieldType: "Btn", radioButton: true, buttonValue: "Phone", fieldValue: "Email", rect: [200, 516, 216, 532] }),
      w({ fieldName: "contact", fieldType: "Btn", radioButton: true, buttonValue: "Email", fieldValue: "Email", rect: [260, 516, 276, 532] }),
      w({ fieldName: "state", fieldType: "Ch", combo: true, fieldValue: ["VIC"], options: [{ exportValue: "WA", displayValue: "WA" }, { exportValue: "VIC", displayValue: "VIC" }], rect: [200, 475, 320, 497] }),
      w({ fieldName: "interests", fieldType: "Ch", combo: false, multiSelect: true, fieldValue: [], options: [{ exportValue: "Art", displayValue: "Art" }, { exportValue: "Music", displayValue: "Music" }], rect: [200, 380, 320, 450] }),
      w({ fieldName: "send", fieldType: "Btn", pushButton: true, rect: [0, 0, 10, 10] }),
      w({ fieldName: "sig", fieldType: "Sig", rect: [0, 0, 10, 10] }),
      w({ fieldName: "secret", fieldType: "Tx", hidden: true, rect: [0, 0, 10, 10] }),
      w({ fieldName: "must", fieldType: "Tx", required: true, rect: [200, 295, 400, 317], fieldValue: "" }),
    ],
  },
  { box, rotation: 0, annotations: [w({ fieldName: "applicant.name", fieldType: "Tx", rect: [200, 695, 500, 717], fieldValue: "" }), w({ fieldName: "notes", fieldType: "Tx", multiLine: true, rect: [200, 600, 500, 660], fieldValue: "" })] },
];

test("fields are read in the order they sit on the pages, a field on two pages once", () => {
  const { fields, signatures, ignored } = readFields(sample());
  assert.deepEqual(fields.map((f) => f.name), ["applicant.name", "agree", "contact", "state", "interests", "must", "notes"]);
  assert.equal(signatures, 1);
  assert.equal(ignored, 1);
  const name = fields[0];
  assert.deepEqual(name.pages, [0, 1]);
  assert.equal(name.widgets.length, 2);
  assert.equal(name.label, "Name");
});

test("each kind of field starts with what the form already holds", () => {
  const f = Object.fromEntries(readFields(sample()).fields.map((x) => [x.name, x]));
  assert.equal(f.agree.initial, false);
  assert.equal(f.contact.initial, "Email");
  assert.deepEqual(f.contact.options.map((o) => o.value), ["Phone", "Email"]);
  assert.equal(f.state.kind, "choice");
  assert.equal(f.state.initial, "VIC");
  assert.equal(f.interests.kind, "list");
  assert.deepEqual(f.interests.initial, []);
  assert.equal(f.notes.kind, "multiline");
  assert.equal(f.must.required, true);
});

test("counting what is filled leaves out the read-only fields and notes what is required", () => {
  const { fields } = readFields(sample());
  const values = new Map([["applicant.name", "Jane"], ["agree", true], ["contact", "Email"], ["state", "VIC"]]);
  const c = countFilled(fields, values);
  assert.deepEqual(c, { filled: 4, total: 7, requiredLeft: 1 });
  assert.equal(describeFill(c), "4 of 7 fields filled, 1 required left.");
  assert.equal(describeFill({ filled: 1, total: 1, requiredLeft: 0 }), "1 of 1 field filled.");
  assert.equal(describeFill({ filled: 0, total: 0, requiredLeft: 0 }), "No fields to fill.");
  const ro = [{ name: "a", kind: "text", readOnly: true, widgets: [] }];
  assert.equal(countFilled(ro, new Map()).total, 0);
});

test("a tick, a text, a list and a blank are told apart", () => {
  assert.equal(isFilled({ kind: "checkbox" }, true), true);
  assert.equal(isFilled({ kind: "checkbox" }, false), false);
  assert.equal(isFilled({ kind: "text" }, "  "), false);
  assert.equal(isFilled({ kind: "text" }, "a"), true);
  assert.equal(isFilled({ kind: "list" }, []), false);
  assert.equal(isFilled({ kind: "list" }, ["x"]), true);
});

test("the next empty field goes round the form", () => {
  const { fields } = readFields(sample());
  const values = new Map([["applicant.name", "Jane"]]);
  assert.equal(nextEmpty(fields, values, "applicant.name").name, "agree");
  assert.equal(nextEmpty(fields, values, "notes").name, "agree"); // goes round
  assert.equal(nextEmpty(fields, values, null).name, "agree");
  const all = new Map(fields.map((f) => [f.name, f.kind === "checkbox" ? true : f.kind === "list" ? ["Art"] : "x"]));
  assert.equal(nextEmpty(fields, all, "agree"), null);
});

test("text the form's font can't set, or that is too long, is caught before saving", () => {
  const fields = [{ name: "a", kind: "text", label: "Name", maxLen: 5, widgets: [] }, { name: "b", kind: "multiline", label: "Notes", maxLen: 0, widgets: [] }];
  const p = problemsWith(fields, new Map([["a", "toolong"], ["b", "Hēmi"]]));
  assert.deepEqual(p.map((x) => [x.name, x.why]), [["a", "long"], ["b", "chars"]]);
  assert.match(describeProblem(p[1]), /Notes/);
  assert.deepEqual(problemsWith(fields, new Map([["a", "ok"], ["b", "José €5"]])), []);
  // line breaks are fine in a field that takes several lines, not in one that takes a single line
  assert.deepEqual(problemsWith(fields, new Map([["b", "Unit 4\n12 High St\r\nPerth"]])), []);
  assert.equal(problemsWith(fields, new Map([["a", "a\nb"]]))[0].why, "chars");
});

// a real form, written with the real library
async function makeForm() {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  form.createTextField("name").addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  form.createTextField("note").addToPage(page, { x: 50, y: 650, width: 200, height: 20 });
  form.getTextField("note").setText("keep me");
  const lines = form.createTextField("lines"); lines.enableMultiline(); lines.addToPage(page, { x: 300, y: 600, width: 200, height: 60 });
  form.createCheckBox("agree").addToPage(page, { x: 50, y: 600, width: 16, height: 16 });
  const radio = form.createRadioGroup("contact");
  radio.addOptionToPage("Phone", page, { x: 50, y: 560, width: 16, height: 16 });
  radio.addOptionToPage("Email", page, { x: 100, y: 560, width: 16, height: 16 });
  const dd = form.createDropdown("state"); dd.addOptions(["WA", "VIC"]); dd.addToPage(page, { x: 50, y: 500, width: 100, height: 20 });
  const ol = form.createOptionList("pets"); ol.addOptions(["Cat", "Dog", "Fish"]); ol.enableMultiselect(); ol.addToPage(page, { x: 50, y: 400, width: 100, height: 60 });
  return PDFLib.PDFDocument.load(await doc.save());
}
const fieldsFor = () => [
  { name: "name", kind: "text", label: "Name", initial: "", widgets: [], options: [] },
  { name: "note", kind: "text", label: "Note", initial: "keep me", widgets: [], options: [] },
  { name: "agree", kind: "checkbox", label: "Agree", initial: false, widgets: [], options: [] },
  { name: "contact", kind: "radio", label: "Contact", initial: "", widgets: [], options: [] },
  { name: "state", kind: "choice", label: "State", initial: "", widgets: [], options: [] },
  { name: "pets", kind: "list", label: "Pets", initial: [], widgets: [], options: [], multiSelect: true },
];

test("values go back into the form, and only what changed is touched", async () => {
  const doc = await makeForm();
  const form = doc.getForm();
  const values = new Map([["name", "Jane Citizen"], ["note", "keep me"], ["agree", true], ["contact", "Email"], ["state", "VIC"], ["pets", ["Cat", "Fish"]]]);
  const r = writeValues(form, fieldsFor(), values);
  assert.deepEqual(r.failed, []);
  assert.equal(r.changed, 5); // the note was not touched
  const again = await PDFLib.PDFDocument.load(await doc.save());
  const f = again.getForm();
  assert.equal(f.getTextField("name").getText(), "Jane Citizen");
  assert.equal(f.getTextField("note").getText(), "keep me");
  assert.equal(f.getCheckBox("agree").isChecked(), true);
  assert.equal(f.getRadioGroup("contact").getSelected(), "Email");
  assert.deepEqual(f.getDropdown("state").getSelected(), ["VIC"]);
  assert.deepEqual(f.getOptionList("pets").getSelected().sort(), ["Cat", "Fish"]);
});

test("a many-lined field that sizes its own text is given the size shown on the page", async () => {
  const doc = await makeForm();
  const lines = { name: "lines", kind: "multiline", label: "Lines", initial: "", widgets: [{ size: 11 }], options: [] };
  const r = writeValues(doc.getForm(), [lines], new Map([["lines", "One\nTwo\nThree"]]));
  assert.deepEqual(r.failed, []);
  const again = await PDFLib.PDFDocument.load(await doc.save());
  const t = again.getForm().getTextField("lines");
  assert.equal(t.getText(), "One\nTwo\nThree");
  assert.match(t.acroField.getDefaultAppearance(), /\b11 Tf\b/);
});

test("a field cleared again is cleared in the form", async () => {
  const doc = await makeForm();
  const form = doc.getForm();
  const fields = fieldsFor();
  fields[1].initial = "keep me";
  const r = writeValues(form, fields, new Map([["note", ""]]));
  assert.equal(r.changed, 1);
  assert.equal(form.getTextField("note").getText(), undefined);
});

test("a field the form does not have is reported, and the others still go in", async () => {
  const doc = await makeForm();
  const fields = fieldsFor();
  fields.push({ name: "ghost", kind: "text", label: "Ghost", initial: "", widgets: [], options: [] });
  const r = writeValues(doc.getForm(), fields, new Map([["name", "A"], ["ghost", "B"]]));
  assert.equal(r.changed, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].name, "ghost");
});

test("read-only fields are never written", async () => {
  const doc = await makeForm();
  const fields = fieldsFor();
  fields[0].readOnly = true;
  const r = writeValues(doc.getForm(), fields, new Map([["name", "Nope"]]));
  assert.equal(r.changed, 0);
  assert.equal(doc.getForm().getTextField("name").getText(), undefined);
});

test("a dynamic copy of the form (XFA) is taken out so it cannot show old answers", async () => {
  const doc = await makeForm();
  const form = doc.getForm();
  assert.equal(dropXfa(form, PDFLib.PDFName), false);
  form.acroForm.dict.set(PDFLib.PDFName.of("XFA"), doc.context.obj([]));
  assert.equal(dropXfa(form, PDFLib.PDFName), true);
  assert.equal(form.acroForm.dict.has(PDFLib.PDFName.of("XFA")), false);
});
