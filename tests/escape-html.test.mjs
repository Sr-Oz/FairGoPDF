import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// One shared escapeHtml (assets/tools.js) is used by every tool page. A page that defines its own under the same name
// replaces it for that page, and a copy that skips quotes is an injection hole the next time it is used inside an attribute.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("the shared escapeHtml escapes & < > \" and '", () => {
  const sandbox = {};
  const source = readFileSync(join(ROOT, "assets/tools.js"), "utf8").match(/function escapeHtml\([^)]*\) \{[\s\S]*?\n\}/)[0];
  vm.runInNewContext(`${source}\nthis.escapeHtml = escapeHtml;`, sandbox);
  assert.equal(sandbox.escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(sandbox.escapeHtml(7), "7");
});

test("no tool script defines its own escapeHtml", () => {
  const dir = join(ROOT, "assets/tools");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    assert.doesNotMatch(readFileSync(join(dir, name), "utf8"), /(function|const|let|var)\s+escapeHtml\b/, name);
  }
});
