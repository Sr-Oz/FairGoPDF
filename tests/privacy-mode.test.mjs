import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Whatever the switch in site-config.json says, every page must match it. scripts/privacy_mode.py writes the pages.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set([".git", "node_modules", ".claude", ".github", ".hallmark", "assets", "design-system", "docs", "scripts", "tests", "worker"]);
const priv = JSON.parse(readFileSync(join(ROOT, "site-config.json"), "utf8")).privateMode === true;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}
const pages = walk(ROOT).map((p) => ({ rel: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
const withCsp = pages.filter((p) => /http-equiv="Content-Security-Policy"/.test(p.text));
const mayUseForm = (rel) => rel === "contact/index.html" && !priv;

test("the switch is a plain true or false", () => {
  assert.equal(typeof JSON.parse(readFileSync(join(ROOT, "site-config.json"), "utf8")).privateMode, "boolean");
});

test("no page's security policy allows another site, except Contact while Private mode is off", () => {
  assert.ok(withCsp.length > 100);
  for (const p of withCsp) {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(p.text)[1];
    if (mayUseForm(p.rel)) {
      const origins = csp.match(/https?:\/\/[^\s;]+/g).map((o) => o.replace(/^https?:\/\//, ""));
      for (const o of origins) assert.match(o, /^(web3forms\.com|api\.web3forms\.com|hcaptcha\.com|\*\.hcaptcha\.com)$/, `${p.rel} allows ${o}`);
    } else {
      assert.doesNotMatch(csp, /https?:\/\//, `${p.rel} allows another site`);
    }
  }
});

test("no page loads a script, style, image or frame from another site: Contact adds Web3Forms only from a script that checks the visitor's choice", () => {
  for (const p of pages) {
    const found = p.text.match(/<(script|link|img|iframe|source|video|audio)[^>]*(src|href)="https?:\/\/[^"]+/g) || [];
    assert.deepEqual(found.filter((tag) => !/rel="(canonical|alternate)"/.test(tag)), [], p.rel);
  }
  if (!priv) {
    const c = pages.find((p) => p.rel === "contact/index.html").text;
    const check = c.indexOf('localStorage.getItem("privateMode") !== "on"');
    assert.ok(check > 0 && c.indexOf("web3forms.com/client/script.js") > check, "Web3Forms must load only after the Private mode check");
  }
});

test("every page's header has the Private mode button, locked on when the owner switch is on", () => {
  const withHeader = pages.filter((p) => p.rel !== "404.html" && (/<header class="site-header">/.test(p.text) || p.rel === "partials/header.html")); // the 404 page has a reduced header
  assert.ok(withHeader.length > 100);
  for (const p of withHeader) {
    assert.match(p.text, /id="privateToggle"/, p.rel);
    assert.equal(/id="privateToggle"[^>]*disabled/.test(p.text), priv, `${p.rel} locked`);
  }
});

test("Private mode shows its footer badge and sends no referrer; with it off the badge is hidden and the referrer is untouched", () => {
  for (const p of pages.filter((p) => /<footer class="site-footer">/.test(p.text) || p.rel === "partials/footer.html")) {
    // off: the badge is in the markup but hidden until a visitor turns Private mode on; on: it is always shown
    assert.match(p.text, priv ? /class="private-badge" href/ : /class="private-badge" data-private-only/, `${p.rel} badge`);
  }
  for (const p of withCsp) assert.equal(p.text.includes('<meta name="referrer" content="no-referrer">'), priv, `${p.rel} referrer`);
});

test("with Private mode on, nothing on the site names the contact relay or the captcha, and the form is gone", () => {
  if (!priv) return;
  for (const p of pages) assert.doesNotMatch(p.text, /web3forms|hcaptcha|id="contactForm"|contact\.js/i, p.rel);
});

test("with Private mode off, the Contact page still has the form and its two scripts", () => {
  if (priv) return;
  const c = pages.find((p) => p.rel === "contact/index.html").text;
  assert.match(c, /id="contactForm"/);
  assert.match(c, /\/assets\/contact\.js/);
  assert.match(c, /web3forms\.com\/client\/script\.js/);
  assert.match(c, /data-open-only/);
  assert.match(c, /data-private-only/);
});

test("the connections page exists and is listed in the sitemap and the search index", () => {
  assert.ok(pages.some((p) => p.rel === "connections/index.html"));
  assert.match(readFileSync(join(ROOT, "sitemap.xml"), "utf8"), /fairgopdf\.au\/connections\//);
  assert.match(readFileSync(join(ROOT, "assets/search-data.js"), "utf8"), /\/connections\//);
});
