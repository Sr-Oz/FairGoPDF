# OCR engine files (self-hosted)

Everything the OCR PDF tool needs lives in this folder and is served from Fair Go PDF itself. Nothing
is fetched from a CDN or any outside server at runtime. See `LICENSES.txt` for the components and
their licences.

| File | What it is | Size |
|---|---|---|
| `paddleocr-client.mjs` | PaddleOCR.js SDK, client side only (builds the OCR config and talks to the worker) | 184 KB |
| `ocr-worker.js` | The SDK's prebuilt worker (runs OpenCV + ONNX Runtime off the main thread), copied unmodified | 11.3 MB |
| `ort-wasm-simd-threaded.mjs` / `.wasm` | ONNX Runtime Web 1.24.3 CPU WebAssembly build (not the 25 MB WebGPU one) | 12.4 MB |
| `models/PP-OCRv6_small_det_onnx_infer.tar` | Text detection model | 9.9 MB |
| `models/PP-OCRv6_small_rec_onnx_infer.tar` | Text recognition model | 21.3 MB |

First use downloads roughly 33 MB (compressed); the browser caches it afterwards (`vercel.json` sets
`Cache-Control` for `/assets/vendor/*`).

## Rebuilding / upgrading

Versions are pinned: `@paddleocr/paddleocr-js` 0.4.2, `onnxruntime-web` **1.24.3** (it must match the
ONNX Runtime JS bundled inside `ocr-worker.js`; the SDK's latest dependency range pulls a newer one).

1. `npm pack @paddleocr/paddleocr-js@0.4.2`, unpack it, and copy
   `dist/assets/worker-entry-*.js` to `ocr-worker.js`.
2. `npm pack onnxruntime-web@1.24.3`, unpack it, and copy `dist/ort-wasm-simd-threaded.mjs` and
   `dist/ort-wasm-simd-threaded.wasm` here. Use the plain (non-`jsep`) files; `assets/tools/ocr-pdf.js`
   points ONNX Runtime at them explicitly through `ortOptions.wasmPaths`.
3. Build the client with esbuild, stubbing the two heavy imports that only the worker uses:
   `echo 'export default {};' > empty.mjs`, `echo 'export { PaddleOCR } from "@paddleocr/paddleocr-js";' > entry.mjs`, then
   `esbuild entry.mjs --bundle --format=esm --minify --outfile=paddleocr-client.mjs --alias:@techstark/opencv-js=./empty.mjs --alias:onnxruntime-web=./empty.mjs --external:fs --external:path --external:crypto --external:node:*`
4. Models: download the `*_onnx_infer.tar` archives for `PP-OCRv6_small_det` and `PP-OCRv6_small_rec`
   from the PaddleOCR project's published model storage once, and commit them here. (The SDK would
   otherwise fetch them from Baidu's servers at runtime, which this site never does.)

## Security note

`ocr-worker.js` is served with its own `Content-Security-Policy` header (see `vercel.json`):
`default-src 'none'; connect-src 'self' data: blob:`. OpenCV's Emscripten glue needs `'unsafe-eval'`,
so that allowance applies to this one worker file only. The tool page itself keeps the site's normal
policy, and the browser blocks the worker from contacting any other origin.
