// Build pass: public/docs.json + public/glossary.json → public/library.json.
// The artifact behind the /library section (shape, contents). Runs after
// build:glossary in the pnpm build chain, in the Dockerfile, and in the
// runtime updater's refresh-from-db — so it tracks live atlas updates like
// every other atlas-versioned artifact. Deliberately timestamp-free: it is
// covered by the reproducible-build check (REPRO=1 pnpm test).
import fs from "node:fs";
import path from "node:path";
import { loadInputs, computeLibrary } from "../lib/library-shape.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const publicDir = path.join(root, "public");

const { _internals, ...library } = computeLibrary(loadInputs(publicDir));
fs.writeFileSync(path.join(publicDir, "library.json"), JSON.stringify(library));
console.log(
  `build-library: ${library.totals.docs} docs, ${library.groups.length} groups, ${library.totals.glossaryTerms} terms → public/library.json (atlas ${library.atlasCommit.slice(0, 7)})`,
);
