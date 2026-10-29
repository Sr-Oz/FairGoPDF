// Builds the hidden workbench page: a page of components for trying new features, locked behind a passphrase.
//
//   node scripts/lab/build.mjs
//
// The page's content is scripts/lab/source/lab.html. That folder is not committed (see .gitignore), because the repository is public:
// only the encrypted result is. The first run makes scripts/lab/source/config.json with a random address and a random passphrase;
// the passphrase is printed once and kept in that file. Delete the file and run again for a new address and passphrase.
// Every run re-encrypts lab.html with a fresh salt and nonce and rewrites <address>/index.html and <address>/gate.js.
//
// This is a lock for a test page, not for secrets: the encrypted content is as strong as the passphrase, but anyone can see that the
// page exists and where it is, and the check happens in the browser. For real access control put the folder behind a host-level login.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFF_WORDS } from "../../assets/vendor/eff-large-wordlist.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceDir = path.join(root, "scripts", "lab", "source");
const configPath = path.join(sourceDir, "config.json");
const ITERATIONS = 600000;

const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

// address and passphrase
let config;
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} else {
  const words = EFF_WORDS; // already an array of the list's 7,776 words
  const pick = () => words[crypto.randomInt(words.length)];
  config = {
    slug: "bilby-" + crypto.randomBytes(6).toString("hex"),
    passphrase: Array.from({ length: 5 }, pick).join("-"),
  };
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log("New address and passphrase made (saved in scripts/lab/source/config.json):");
  console.log("  address:    /" + config.slug + "/");
  console.log("  passphrase: " + config.passphrase);
}

// encrypt the content
const content = fs.readFileSync(path.join(sourceDir, "lab.html"), "utf8");
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(config.passphrase, salt, ITERATIONS, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(content, "utf8"), cipher.final(), cipher.getAuthTag()]); // WebCrypto expects the tag on the end
const payload = JSON.stringify({ salt: salt.toString("base64"), iv: iv.toString("base64"), iter: ITERATIONS, ct: ct.toString("base64") });

// the page: an existing page's head and scripts (so fonts, styles and the CSP stay current), the shared header and footer, a gate for a body
let page = read("blog/index.html");
page = page
  .replace(/<title>.*?<\/title>/s, "<title>Workbench | Fair Go PDF</title>")
  .replace(/<meta name="description"[^>]*>\n/, "")
  .replace(/<link rel="canonical"[^>]*>\n/, "")
  .replace(/<meta property="og:[^>]*>\n/g, "")
  .replace(/<meta name="twitter:[^>]*>\n/g, "")
  .replace(/<meta name="author"[^>]*>\n/, "")
  .replace(/<!-- Analytics consent gate:[\s\S]*?-->\n<script src="\/assets\/consent\.js"><\/script>\n/, "") // no analytics on a test page
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n/g, "")
  .replace('<meta name="viewport"', '<meta name="robots" content="noindex, nofollow, noarchive">\n<meta name="viewport"')
  .replace(/<script src="\/assets\/blog\.js"><\/script>\n?/, "");

const main = `<main id="main-content">
<div class="scroll-progress" id="scrollProgress"></div>
  <div class="container">
    <div class="tool-workspace" id="labGate" style="max-width: 420px; margin-top: 64px;">
      <form id="labForm" autocomplete="off">
        <div class="field">
          <label for="labKey">Passphrase</label>
          <input type="password" id="labKey" autocomplete="off" required>
        </div>
        <div class="actions-row"><button class="btn" type="submit">Open</button></div>
      </form>
      <div class="status-box" id="labStatus" role="status"></div>
    </div>
  </div>
  <div id="labRoot"></div>
  <script type="application/json" id="labPayload">${payload}</script>
</main>`;
page = page.replace(/<main id="main-content">[\s\S]*<\/main>/, () => main);
page = page.replace('<script src="/assets/site.js"></script>', '<script src="/assets/tools.js"></script>\n<script src="/assets/site.js"></script>\n<script src="gate.js"></script>');

const out = path.join(root, config.slug);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), page);
fs.copyFileSync(path.join(root, "scripts", "lab", "gate.js"), path.join(out, "gate.js"));
console.log("Built /" + config.slug + "/ (" + Math.round(page.length / 1024) + " KB)");
