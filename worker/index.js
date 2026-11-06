// Answers requests for part of a file (a "Range" request) for the files in /assets/video/. Cloudflare's static assets send the whole
// file with a 200 instead, and Safari will not play a video unless the server can send just the part it asks for (a 206).
// Everything else on the site is served by Cloudflare's static assets without this script running: see run_worker_first in wrangler.jsonc.

// What a Range header asks for, as { start, end } (both included), or null when it should be ignored and the whole file sent
// (several ranges, or something that is not "bytes="), or "unsatisfiable" when it starts past the end of the file.
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    // the last N bytes
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size) return "unsatisfiable";
  if (end < start) return null; // "bytes=5-2" is not a range at all
  return { start, end };
}

const CACHE = "public, max-age=604800, stale-while-revalidate=2592000";

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    if ((request.method !== "GET" && request.method !== "HEAD") || res.status !== 200 || res.headers.get("Content-Encoding")) return res;

    const headers = new Headers(res.headers);
    headers.set("Accept-Ranges", "bytes");
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", CACHE);
    const wanted = request.headers.get("Range");
    // a request that asks for the file only if it has not changed since a copy it holds gets the whole file
    if (request.method === "HEAD" || !wanted || request.headers.has("If-Range")) return new Response(request.method === "HEAD" ? null : res.body, { status: 200, headers });

    const body = await res.arrayBuffer();
    const size = body.byteLength;
    const range = parseRange(wanted, size);
    if (range === null) return new Response(body, { status: 200, headers });
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(body.slice(range.start, range.end + 1), { status: 206, headers });
  },
};
