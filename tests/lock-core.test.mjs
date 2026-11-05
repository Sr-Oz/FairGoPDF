import test from "node:test";
import assert from "node:assert/strict";
import * as Std from "../assets/vendor/pdf-lib.esm.min.js";
import { PDFDocument } from "../assets/vendor/cantoo-pdf-lib.esm.min.js";
import { loadAsset } from "./load.mjs";

const core = await loadAsset("assets/tools/lock-core.js", { "/assets/tools/password-core.js": new URL("../assets/tools/password-core.js", import.meta.url).href });
const { probe, friendlyError, estimateBits, strengthOf, suggestPassword, makeOwnerPassword, checkPassword, permissionsFor, limitsOf, joinWords, limitsFromFlags, stateLine } = core;

async function makePdf() {
  const d = await PDFDocument.create();
  d.addPage([300, 300]).drawText("hello");
  d.addPage([300, 300]);
  return d;
}
async function lockedBytes(user, owner = "owner-pw", permissions, algorithm = "AES-256") {
  const d = await makePdf();
  d.encrypt({ userPassword: user, ownerPassword: owner, algorithm, permissions });
  return d.save();
}

test("a plain, a restricted and a locked file are told apart", async () => {
  const plain = new Uint8Array(await (await makePdf()).save());
  assert.deepEqual(await probe(plain, PDFDocument), { state: "open", pages: 2 });
  const restricted = await lockedBytes("", "owner-pw", { copying: false });
  assert.deepEqual(await probe(restricted, PDFDocument), { state: "restricted", pages: 2 });
  const locked = await lockedBytes("secret");
  assert.deepEqual(await probe(locked, PDFDocument), { state: "locked" });
  assert.equal((await probe(new TextEncoder().encode("not a pdf at all"), PDFDocument)).state, "unreadable");
});

test("older AES-128 files are told apart the same way", async () => {
  assert.deepEqual(await probe(await lockedBytes("secret", "o", undefined, "AES-128"), PDFDocument), { state: "locked" });
});

test("errors from the library are put in plain words", () => {
  assert.equal(friendlyError(new Error("Password incorrect")).kind, "password");
  assert.equal(friendlyError(new Error("NEEDS PASSWORD")).kind, "password");
  assert.equal(friendlyError(new Error("Password contains one or more invalid characters.")).kind, "chars");
  assert.equal(friendlyError(new Error("Input document to `PDFDocument.load` is encrypted.")).kind, "unsupported");
  const other = friendlyError(new Error("Failed to parse PDF."));
  assert.equal(other.kind, "broken");
  assert.match(other.text, /Failed to parse PDF/);
});

test("a password that was only just typed is rated by what it is made of", () => {
  assert.equal(strengthOf("").id, "weak");
  assert.equal(strengthOf("password").id, "weak");
  assert.equal(strengthOf("Password1").id, "weak");
  assert.equal(strengthOf("aaaaaaaaaaaa").id, "weak");
  assert.equal(strengthOf("12345678").id, "weak");
  assert.ok(["good", "strong"].includes(strengthOf("correct horse battery staple").id));
  assert.equal(strengthOf("k7#Qm2-vX9pLw4Zt").id, "strong");
  assert.ok(estimateBits("longer password with words") > estimateBits("short"));
});

test("a suggested password is long, plain and rated strong", () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const p = suggestPassword();
    assert.equal(p.length, 16);
    assert.match(p, /^[A-Za-z0-9\-_+=!#]+$/);
    assert.doesNotMatch(p, /[01OIlo]/); // nothing easy to misread
    assert.equal(strengthOf(p).id, "strong");
    seen.add(p);
  }
  assert.equal(seen.size, 20);
});

test("a made-up owner password is long and different each time", () => {
  const a = makeOwnerPassword();
  assert.equal(a.length, 24);
  assert.notEqual(a, makeOwnerPassword());
  assert.match(a, /^[A-Za-z0-9]+$/);
});

test("a typed password is checked before it is used", () => {
  assert.match(checkPassword("").error, /Choose a password/);
  assert.match(checkPassword("abc", "abd").error, /match/);
  assert.deepEqual(checkPassword("abc", "abc"), {});
  assert.match(checkPassword("pässwörd", "pässwörd").warn, /Accents/);
  assert.match(checkPassword(" padded ", " padded ").warn, /space/);
  assert.match(checkPassword("pässwörd✓", "pässwörd✓", "AES-128").error, /older kind/);
  assert.equal(checkPassword("plain", undefined, "AES-128").error, undefined);
});

test("the permission choices become the library's permissions", () => {
  assert.deepEqual(permissionsFor({ printing: "high", copy: true, edit: true, annotate: true, assemble: true }), { printing: "highResolution", copying: true, modifying: true, annotating: true, fillingForms: true, documentAssembly: true, contentAccessibility: true });
  const p = permissionsFor({ printing: "none", copy: false, edit: false, annotate: false, assemble: false });
  assert.equal(p.printing, false);
  assert.equal(p.copying, false);
  assert.equal(p.contentAccessibility, true);
  assert.equal(permissionsFor({ printing: "low" }).printing, "lowResolution");
});

test("what the choices hold back is listed in words", () => {
  assert.deepEqual(limitsOf({ printing: "high", copy: true, edit: true, annotate: true, assemble: true }), []);
  assert.deepEqual(limitsOf({ printing: "low", copy: false, edit: true, annotate: true, assemble: true }), ["high quality printing", "copying text"]);
  assert.equal(joinWords(["printing", "copying text", "editing"]), "printing, copying text and editing");
  assert.equal(joinWords(["editing"]), "editing");
  assert.equal(joinWords([]), "");
});

test("what a file already holds back is read from the flags a reader reports", () => {
  assert.deepEqual(limitsFromFlags(null), []);
  assert.deepEqual(limitsFromFlags([4, 8, 16, 32, 256, 512, 1024, 2048]), []);
  assert.deepEqual(limitsFromFlags([512]), ["printing", "copying text", "editing", "annotating", "changing pages"]);
  assert.deepEqual(limitsFromFlags([4, 8, 16, 32, 256, 1024]), ["high quality printing"]);
});

test("each file says where it stands", () => {
  assert.equal(stateLine({ state: "open", pages: 3 }, "protect"), "3 pages · Ready to protect.");
  assert.equal(stateLine({ state: "open" }, "unlock"), "Not protected, so there is nothing to unlock.");
  assert.match(stateLine({ state: "restricted", pages: 1, limits: ["printing", "copying text"] }, "unlock"), /holds back printing and copying text/);
  assert.match(stateLine({ state: "locked" }, "protect"), /Already has a password/);
  assert.equal(stateLine({ state: "locked", error: "That password didn't work." }, "unlock"), "That password didn't work.");
  assert.equal(stateLine({ state: "locked", done: "Unlocked." }, "unlock"), "Unlocked.");
  assert.match(stateLine({ state: "unreadable", message: "Nope." }, "unlock"), /Nope/);
});

// ---- the real thing: protect and unlock with the real library

test("a protected file needs its password, and opens with it", async () => {
  for (const algorithm of ["AES-256", "AES-128"]) {
    const bytes = await lockedBytes("open-sesame", "owner-pw", permissionsFor({ printing: "none", copy: false, edit: false, annotate: false, assemble: false }), algorithm);
    await assert.rejects(PDFDocument.load(bytes.slice(), { password: "" }), /NEEDS PASSWORD|incorrect/i);
    await assert.rejects(PDFDocument.load(bytes.slice(), { password: "wrong" }), /incorrect/i);
    assert.equal((await PDFDocument.load(bytes.slice(), { password: "open-sesame" })).getPageCount(), 2);
    assert.equal((await PDFDocument.load(bytes.slice(), { password: "owner-pw" })).getPageCount(), 2);
  }
});

test("a file that already has a password can be given a new one in one go", async () => {
  const bytes = await lockedBytes("old-pass");
  const doc = await PDFDocument.load(bytes.slice(), { password: "old-pass" });
  doc.encrypt({ userPassword: "new-pass", ownerPassword: "new-owner", algorithm: "AES-256" });
  const out = await doc.save();
  await assert.rejects(PDFDocument.load(out.slice(), { password: "old-pass" }), /incorrect/i);
  assert.equal((await PDFDocument.load(out.slice(), { password: "new-pass" })).getPageCount(), 2);
});

test("unlocking leaves a file that opens with no password at all", async () => {
  for (const os of [true, false]) {
    const d = await makePdf();
    d.encrypt({ userPassword: "secret", ownerPassword: "owner", algorithm: "AES-256" });
    const bytes = await d.save({ useObjectStreams: os });
    const doc = await PDFDocument.load(bytes.slice(), { password: "secret" });
    const out = await doc.save();
    // judged by the ordinary library, which refuses anything still encrypted
    assert.equal((await Std.PDFDocument.load(out.slice())).getPageCount(), 2, `object streams ${os}`);
  }
});

test("a file with limits only unlocks without any password", async () => {
  const bytes = await lockedBytes("", "owner-pw", { copying: false, printing: false });
  const doc = await PDFDocument.load(bytes.slice(), { password: "" });
  const out = await doc.save();
  assert.equal((await Std.PDFDocument.load(out.slice())).getPageCount(), 2);
});

test("accents and symbols work in a password with the modern encryption", async () => {
  const d = await makePdf();
  d.encrypt({ userPassword: "pässwörd✓Hēmi", ownerPassword: "o", algorithm: "AES-256" });
  const bytes = await d.save();
  assert.equal((await PDFDocument.load(bytes.slice(), { password: "pässwörd✓Hēmi" })).getPageCount(), 2);
});
