// Local helper for the blog cards: serves the site on http://localhost:5051 and lets card.html save the PNG it draws
// (POST /__save?to=assets/img/blog/<slug>.png). It writes only inside assets/img/blog/, and only .png files.
// It listens on 127.0.0.1 only, so nobody else on the network can reach it.
// Run it with:  node scripts/blog-cards/save-server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const saveDir = path.join(root, "assets", "img", "blog");
const port = 5051;
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };

const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const origins = new Set([...hosts].map((h) => `http://${h}`));
const private_ = /^(\.git|node_modules|scripts\/lab\/source)(\/|$)/; // never served, even locally: the Workbench passphrase lives in scripts/lab/source/config.json

http.createServer((req, res) => {
  // A web page on another site can make the browser call localhost, so check who is asking (this also stops DNS rebinding).
  if (!hosts.has(req.headers.host)) { res.writeHead(403).end("bad host"); return; }
  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === "POST" && url.pathname === "/__save") {
    if (req.headers.origin && !origins.has(req.headers.origin)) { res.writeHead(403).end("bad origin"); return; }
    const target = path.resolve(root, url.searchParams.get("to") || "");
    if (path.dirname(target) !== saveDir || path.extname(target) !== ".png") { res.writeHead(400).end("only assets/img/blog/*.png"); return; }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fs.mkdirSync(saveDir, { recursive: true });
      fs.writeFileSync(target, Buffer.concat(chunks));
      res.writeHead(200).end("saved " + path.relative(root, target));
    });
    return;
  }

  let file = path.join(root, decodeURIComponent(url.pathname));
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel) || private_.test(rel)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`Blog cards: http://localhost:${port}/scripts/blog-cards/card.html`));
