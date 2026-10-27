import { PDFLib } from "/assets/tools/pdf-common.js";
import { PDFDocument as DecryptingPDFDocument } from "/assets/vendor/cantoo-pdf-lib.esm.min.js";

// Opens a PDF for copying pages out of it, for Merge PDF and Split PDF.
//
// Many PDFs (certificates, bank statements) are "encrypted" only to stop editing and open with no password. pdf-lib refuses
// those, so they are opened with the decrypting library (the one Unlock PDF uses) and used as an unlocked copy.
// A PDF that really needs a password is named, so the visitor knows which one to unlock first.
export class OpenProblem extends Error {}

export async function loadEditable(file) {
  const bytes = await file.arrayBuffer();
  try {
    return await PDFLib.PDFDocument.load(bytes);
  } catch (err) {
    if (!/encrypted/i.test(err.message || "")) throw new OpenProblem(`${file.name} couldn't be read as a PDF (${err.message || "unknown problem"}).`);
  }
  try {
    const open = await DecryptingPDFDocument.load(bytes.slice(0), { password: "" });
    return await PDFLib.PDFDocument.load(await open.save());
  } catch (err) {
    throw new OpenProblem(`${file.name} is password protected. Remove its password with Unlock PDF first, then try again.`);
  }
}
