import test from "node:test";
import assert from "node:assert/strict";
import worker, { parseRange } from "../worker/index.js";

test("a Range header becomes the part of the file it asks for", () => {
  assert.deepEqual(parseRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(parseRange("bytes=10-", 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 }); // an end past the file is the end of it
  assert.deepEqual(parseRange("bytes=-500", 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange(" bytes=0-0 ", 100), { start: 0, end: 0 });
});

test("a range past the end of the file is refused, and a range that makes no sense is ignored", () => {
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=500-600", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=5-2", 100), null);
  assert.equal(parseRange("bytes=0-1,5-6", 100), null); // several ranges: the whole file is sent
  assert.equal(parseRange("items=0-1", 100), null);
  assert.equal(parseRange("bytes=-", 100), null);
  assert.equal(parseRange("", 100), null);
  assert.equal(parseRange(null, 100), null);
});

const FILE = Uint8Array.from({ length: 100 }, (_, i) => i);
const env = (over = {}) => ({
  ASSETS: { fetch: async () => new Response(FILE, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Length": "100", ...over } }) },
});
const ask = (headers = {}, method = "GET") => new Request("https://example.com/assets/video/hero.mp4", { method, headers });

test("a request for part of the video gets a 206 with just those bytes", async () => {
  const res = await worker.fetch(ask({ Range: "bytes=0-1" }), env());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("Content-Range"), "bytes 0-1/100");
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.equal(res.headers.get("Content-Type"), "video/mp4");
  assert.equal(res.headers.get("Content-Length"), "2");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);
  const tail = await worker.fetch(ask({ Range: "bytes=-5" }), env());
  assert.equal(tail.headers.get("Content-Range"), "bytes 95-99/100");
  assert.deepEqual([...new Uint8Array(await tail.arrayBuffer())], [95, 96, 97, 98, 99]);
});

test("a request for the whole video still gets it, now saying that ranges are understood", async () => {
  const res = await worker.fetch(ask(), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test("a range past the end is a 416, and nonsense is answered with the whole file", async () => {
  const gone = await worker.fetch(ask({ Range: "bytes=500-" }), env());
  assert.equal(gone.status, 416);
  assert.equal(gone.headers.get("Content-Range"), "bytes */100");
  const odd = await worker.fetch(ask({ Range: "bytes=0-1,4-5" }), env());
  assert.equal(odd.status, 200);
  assert.equal((await odd.arrayBuffer()).byteLength, 100);
});

test("a HEAD request, an If-Range request, a missing file and a compressed file are left alone", async () => {
  const head = await worker.fetch(ask({ Range: "bytes=0-1" }, "HEAD"), env());
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Accept-Ranges"), "bytes");
  const ifRange = await worker.fetch(ask({ Range: "bytes=0-1", "If-Range": '"abc"' }), env());
  assert.equal(ifRange.status, 200);
  const missing = await worker.fetch(ask({ Range: "bytes=0-1" }), { ASSETS: { fetch: async () => new Response("no", { status: 404 }) } });
  assert.equal(missing.status, 404);
  const packed = await worker.fetch(ask({ Range: "bytes=0-1" }), env({ "Content-Encoding": "br" }));
  assert.equal(packed.status, 200);
  assert.equal(packed.headers.get("Content-Encoding"), "br");
});

test("the video keeps a cache lifetime even when the static file did not bring one", async () => {
  const res = await worker.fetch(ask({ Range: "bytes=0-1" }), env());
  assert.match(res.headers.get("Cache-Control"), /max-age=604800/);
  const own = await worker.fetch(ask({ Range: "bytes=0-1" }), env({ "Cache-Control": "public, max-age=60" }));
  assert.equal(own.headers.get("Cache-Control"), "public, max-age=60");
});
