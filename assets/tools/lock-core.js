// Protect PDF and Unlock PDF: the rules (what state a file is in, how strong a password is, what the permission choices mean, what
// to say when something fails), kept apart from the pages so they can be tested. No DOM in here, and the PDF library is passed in.
import { generateChars, secureRand } from "/assets/tools/password-core.js";

// ---------------------------------------------------------------- what state a file is in

// What a PDF is like to open: "open" (no protection), "restricted" (opens without a password, but limits what a reader may do),
// "locked" (needs a password) or "unreadable". PDFDocument is the decrypting pdf-lib.
// -> { state, pages, message }
export async function probe(bytes, PDFDocument) {
  let encrypted;
  try {
    const doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    encrypted = doc.isEncrypted;
    if (!encrypted) return { state: "open", pages: doc.getPageCount() };
  } catch (err) {
    return { state: "unreadable", message: "This doesn't open as a PDF." };
  }
  try {
    const doc = await PDFDocument.load(bytes.slice(), { password: "" });
    return { state: "restricted", pages: doc.getPageCount() };
  } catch (err) {
    const e = friendlyError(err);
    return e.kind === "password" ? { state: "locked" } : { state: "unreadable", message: e.text };
  }
}

// a message for something that went wrong while opening or saving
// -> { kind: "password" | "chars" | "unsupported" | "broken", text }
export function friendlyError(err) {
  const m = String((err && err.message) || err || "");
  if (/password incorrect|needs password/i.test(m)) return { kind: "password", text: "That password didn't work." };
  if (/invalid characters/i.test(m)) return { kind: "chars", text: "The password has a character this kind of encryption can't use." };
  if (/is encrypted/i.test(m) || /unsupported/i.test(m)) return { kind: "unsupported", text: "This file uses a kind of protection that can't be opened here." };
  return { kind: "broken", text: `This file couldn't be processed (${m.replace(/[.\s]+$/, "") || "unknown problem"}).` };
}

// ---------------------------------------------------------------- passwords

const COMMON = ["password", "passw0rd", "qwerty", "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "abc123", "football", "sunshine", "princess", "master", "login"];
const RUNS = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

// A rough guide to how hard a password is to guess, in bits: the size of the alphabet used, times its length, with repeats,
// keyboard and number runs and the commonest passwords counting for much less. A guide, not a promise.
export function estimateBits(password) {
  const pw = String(password || "");
  if (!pw) return 0;
  const lower = pw.toLowerCase();
  const plain = lower.replace(/[^a-z]/g, "");
  if (COMMON.some((w) => plain === w || lower === w)) return 10;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const chars = [...pw];
  const distinct = new Set(chars).size;
  let effective = distinct + (chars.length - distinct) * 0.25;
  // every three characters of a run (abc, 123, qwe) count as one
  let runChars = 0;
  for (const run of RUNS) for (let i = 0; i + 3 <= run.length; i++) { if (lower.includes(run.slice(i, i + 4))) runChars++; }
  effective = Math.max(1, effective - runChars * 0.6);
  return Math.floor(effective * Math.log2(Math.max(pool, 2)));
}

const TIERS = [
  { below: 28, id: "weak", label: "Weak", advice: "Easy to guess. Add more words or characters." },
  { below: 45, id: "fair", label: "Fair", advice: "Longer would be safer. Three or four random words works well." },
  { below: 65, id: "good", label: "Good", advice: "" },
  { below: Infinity, id: "strong", label: "Strong", advice: "" },
];
export const strengthOf = (password) => {
  const bits = estimateBits(password);
  return { bits, ...TIERS.find((t) => bits < t.below) };
};

// A strong password to suggest: 16 letters and numbers and a few symbols, with nothing that is easy to misread.
export function suggestPassword() {
  const r = generateChars({ length: 16, upper: true, lower: true, numbers: true, symbols: "-_+=!#", startsWithLetter: false, noRepeat: false, minPerClass: 1, filters: { ambiguous: true } });
  return r.value;
}

const OWNER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function makeOwnerPassword(length = 24) {
  let out = "";
  for (let i = 0; i < length; i++) out += OWNER_ALPHABET[secureRand(OWNER_ALPHABET.length)];
  return out;
}

// What is wrong with the password as typed. -> { error } to stop, { warn } to mention, or {}
export function checkPassword(password, confirm, algorithm = "AES-256") {
  if (!password) return { error: "Choose a password to open the PDF." };
  if (confirm !== undefined && confirm !== password) return { error: "The two passwords don't match." };
  if (algorithm !== "AES-256" && [...password].some((c) => c.charCodeAt(0) > 255)) return { error: "This older kind of encryption only takes plain Latin letters, numbers and symbols. Use AES-256, or change the password." };
  if ([...password].some((c) => c.charCodeAt(0) > 127)) return { warn: "Accents and other special letters can be typed differently on another device or reader. Letters, numbers and common symbols are the safest." };
  if (password !== password.trim()) return { warn: "The password starts or ends with a space. It has to be typed exactly that way to open the file." };
  return {};
}

// ---------------------------------------------------------------- what people may do

export const PRINTING = { high: "Allowed", low: "Low quality only", none: "Not allowed" };

// the choices on the page -> the library's permissions
//   choices: { printing: "high" | "low" | "none", copy, edit, annotate, assemble }
export function permissionsFor(c) {
  return {
    printing: c.printing === "high" ? "highResolution" : c.printing === "low" ? "lowResolution" : false,
    copying: !!c.copy,
    modifying: !!c.edit,
    annotating: !!c.annotate,
    fillingForms: !!c.annotate,
    documentAssembly: !!c.assemble,
    contentAccessibility: true, // screen readers are always let through
  };
}

// what the choices hold back, in words
export function limitsOf(c) {
  const out = [];
  if (c.printing === "none") out.push("printing");
  else if (c.printing === "low") out.push("high quality printing");
  if (!c.copy) out.push("copying text");
  if (!c.edit) out.push("editing");
  if (!c.annotate) out.push("annotating");
  if (!c.assemble) out.push("changing pages");
  return out;
}

export const joinWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] || "");

// what a file already holds back, from the flags a reader reports as allowed (pdf.js's permission numbers); null means no protection
export function limitsFromFlags(allowed) {
  if (!allowed) return [];
  const has = (n) => allowed.includes(n);
  const out = [];
  if (!has(4)) out.push("printing");
  else if (!has(2048)) out.push("high quality printing");
  if (!has(16)) out.push("copying text");
  if (!has(8)) out.push("editing");
  if (!has(32) && !has(256)) out.push("annotating");
  if (!has(1024)) out.push("changing pages");
  return out;
}

// ---------------------------------------------------------------- wording

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const pagesText = (n) => plural(n, "page", "pages");

// what a file in the list says about itself
export function stateLine(entry, tool) {
  const pages = entry.pages ? `${pagesText(entry.pages)} · ` : "";
  if (entry.error) return entry.error;
  if (entry.done) return entry.done;
  switch (entry.state) {
    case "open": return tool === "unlock" ? "Not protected, so there is nothing to unlock." : `${pages}Ready to protect.`;
    case "restricted": return tool === "unlock" ? `${pages}Opens without a password${entry.limits && entry.limits.length ? `, but holds back ${joinWords(entry.limits)}` : ", but has limits set"}.` : `${pages}Has limits but no opening password. It will get the new protection.`;
    case "locked": return tool === "unlock" ? "Needs a password." : "Already has a password. Type it under Password so it can be changed.";
    default: return entry.message || "This doesn't open as a PDF.";
  }
}
