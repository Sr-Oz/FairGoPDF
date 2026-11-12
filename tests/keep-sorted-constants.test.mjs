import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// site.js (every page) clears an expired "Keep it sorted" file from IndexedDB, and keep-sorted.js (tool pages) writes and reads it.
// They are separate scripts that cannot share a constant: some tool pages run their script before site.js loads, and the home
// page has no keep-sorted.js. So the names and the age limit are written twice, and this fails if the two copies drift apart.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (name) => readFileSync(join(ROOT, name), "utf8");

test("site.js clears the same database, store, key and age that keep-sorted.js uses", () => {
  const keep = read("assets/keep-sorted.js");
  const site = read("assets/site.js");
  const db = keep.match(/DB_NAME = "([^"]+)"/)[1];
  const store = keep.match(/STORE_NAME = "([^"]+)"/)[1];
  const key = keep.match(/STASH_KEY = "([^"]+)"/)[1];
  const ageMs = Function(`return ${keep.match(/STASH_MAX_AGE_MS = ([^;]+);/)[1]}`)();

  const sweep = site.slice(site.indexOf("function expireStash"));
  assert.ok(sweep.includes(`d.name === "${db}"`), "database name");
  assert.ok(sweep.includes(`indexedDB.open("${db}", 1)`), "database name when opening");
  assert.ok(sweep.includes(`objectStoreNames.contains("${store}")`), "store name");
  assert.ok(sweep.includes(`db.transaction("${store}", "readwrite")`), "store name in the transaction");
  assert.ok(sweep.includes(`store.get("${key}")`) && sweep.includes(`store.delete("${key}")`), "key");
  const siteAge = Function(`return ${sweep.match(/Date\.now\(\) - get\.result\.ts > ([^)]+)\)/)[1]}`)();
  assert.equal(siteAge, ageMs, "age limit");
});
