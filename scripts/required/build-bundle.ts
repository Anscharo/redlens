// Build-time publish of the live atlas bundle: copy the freshly-built flat
// artifacts in public/ into the immutable per-SHA dir public/atlas/<sha>/ (with
// fresh .gz). Mirrors what the runtime updater does after a DB-driven rebuild,
// so the per-SHA serving path (/api/atlas/<sha>/<name>.json) works from the very
// first request. Runs under bun so it shares bundle-store.ts with the server.
//
// Ordering: must run AFTER build:index/graph/glossary (all MAIN artifacts final)
// and BEFORE `vite build` (which copies public/ → dist/, carrying the per-SHA
// dir into the served tree). See package.json `build` + the Dockerfile.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../src/server/config.ts";
import { MAIN_STORE, publishBundle } from "../../src/server/bundle-store.ts";

const docsPath = join(config.publicDir, "docs.json");
let sha: string | undefined;
try {
  sha = JSON.parse(readFileSync(docsPath, "utf8")).atlasCommit;
} catch {
  console.error(`build-bundle: cannot read ${docsPath} — run build:index first`);
  process.exit(1);
}
if (!sha) {
  console.error("build-bundle: docs.json has no atlasCommit");
  process.exit(1);
}
await publishBundle(MAIN_STORE, sha, config.publicDir);
console.log(`build-bundle: published ${sha.slice(0, 12)} → ${MAIN_STORE.root}/<sha>/`);
