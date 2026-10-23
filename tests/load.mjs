// Loads a site module in Node. The pages import with absolute paths ("/assets/..."), which only work in a browser, so
// this copies the module to a temp file with those paths pointed at the repo. `stubs` swaps a path for any other URL.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const require = createRequire(import.meta.url);

export async function loadAsset(rel, stubs = {}) {
  const src = (await readFile(join(ROOT, rel), "utf8")).replace(
    /(from\s+)"(\/assets\/[^"]+)"/g,
    (_, pre, path) => `${pre}"${stubs[path] ?? pathToFileURL(join(ROOT, path)).href}"`,
  );
  const file = join(await mkdtemp(join(tmpdir(), "fgp-test-")), "module.mjs");
  await writeFile(file, src);
  return import(pathToFileURL(file).href);
}

// pdf.js needs a browser; the helpers under test never call it.
const PDFJS_STUB = "data:text/javascript,export const GlobalWorkerOptions = {}; export const getDocument = () => {};";
export const loadPdfCommon = () => loadAsset("assets/tools/pdf-common.js", { "/assets/vendor/pdf.min.mjs": PDFJS_STUB });
