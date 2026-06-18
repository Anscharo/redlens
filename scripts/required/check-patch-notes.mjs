// Pre-commit / CI check for src/content/patch-notes.md.
// Validates the structure (date headings + bullets) and that dates are in
// strict newest-first order. Exits non-zero with a readable report on failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePatchNotes } from "../lib/patch-notes-validate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = path.join(ROOT, "src/content/patch-notes.md");

const raw = fs.readFileSync(FILE, "utf8");
const errors = validatePatchNotes(raw);

if (errors.length > 0) {
  console.error("✗ src/content/patch-notes.md is invalid:\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nFormat: newest-first `## YYYY-MM-DD` headings, each with one or more `- bullet` lines.",
  );
  process.exit(1);
}

console.log("✓ src/content/patch-notes.md is valid.");
