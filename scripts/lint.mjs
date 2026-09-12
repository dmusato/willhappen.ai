// Syntax-check every JS file and validate every JSON file. Deliberately
// dependency-free: `npm run lint` should work on a clean clone with no install.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "public/assets", "scripts", "test"];
const JSON_ROOTS = ["public/data", ".github"];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let checked = 0;
let failed = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (![".js", ".mjs"].includes(extname(file))) continue;
    try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); checked++; }
    catch (err) { failed++; console.error(`✗ ${file}\n${err.stderr?.toString().trim()}`); }
  }
}

for (const root of JSON_ROOTS) {
  for (const file of walk(root)) {
    if (extname(file) !== ".json") continue;
    try { JSON.parse(readFileSync(file, "utf8")); checked++; }
    catch (err) { failed++; console.error(`✗ ${file}: ${err.message}`); }
  }
}

console.log(failed ? `✗ ${failed} failed of ${checked + failed}` : `✓ ${checked} files OK`);
process.exit(failed ? 1 : 0);
