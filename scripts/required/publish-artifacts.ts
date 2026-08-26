// Publish the freshly-built atlas artifacts to the SHARED store (Postgres,
// migration 027) so every web instance can read them back instead of rebuilding
// them for itself. Plan: docs/plans/atlas-artifact-store.md (phase 3).
//
// Sibling of build-bundle.ts, which publishes the same files to this container's
// own disk for the per-SHA serving path. That one is per-container and dies with
// it; this one is the copy other containers can reach.
//
// Ordering: must run AFTER every artifact is final (the worker's `worker`
// profile) and AFTER sync.ts, because it refuses to publish under a sha that
// does not match the pointer sync.ts just advanced — see below. Runs under bun
// so it shares bundle-store.ts + atlas-artifacts.ts with the server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { config } from "../../src/server/config.ts";
import { PUBLISHED_ARTIFACTS } from "../../src/server/bundle-store.ts";
import { putArtifacts, pruneArtifacts, type StoredArtifact } from "../../src/server/atlas-artifacts.ts";
import { sql } from "../../src/server/db.ts";

function fail(msg: string): never {
  console.error(`publish-artifacts: ${msg}`);
  process.exit(1);
}

const docsPath = join(config.publicDir, "docs.json");
let builtSha: string | undefined;
try {
  builtSha = JSON.parse(readFileSync(docsPath, "utf8")).atlasCommit;
} catch {
  fail(`cannot read ${docsPath} — run build:index first`);
}
if (!builtSha) fail("docs.json has no atlasCommit");

// The published sha MUST be the one sync_state points at. Web instances key
// their drift check on sync_state.atlas_sha and then ask this store for exactly
// that sha; publishing under any other one produces artifacts nobody will ever
// request while the sha they DO request stays missing. Keeping both in one
// database is what makes this checkable at all — see the plan's store-choice
// note. Refuse rather than guess.
const [row] = (await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`) as { atlas_sha?: string }[];
const pointerSha = row?.atlas_sha ?? null;
if (!pointerSha) fail("sync_state has no atlas_sha — run sync.ts first");
if (pointerSha !== builtSha) {
  fail(`built ${builtSha.slice(0, 12)} but sync_state points at ${pointerSha.slice(0, 12)} — refusing to publish a sha nobody will request`);
}

const items: StoredArtifact[] = [];
const missing: string[] = [];
for (const name of PUBLISHED_ARTIFACTS) {
  let raw: Buffer;
  try {
    raw = readFileSync(join(config.publicDir, name));
  } catch {
    missing.push(name);
    continue;
  }
  items.push({
    name,
    gz: gzipSync(raw, { level: 9 }),
    rawBytes: raw.byteLength,
    sha256: createHash("sha256").update(raw).digest("hex"),
  });
}

// Every name in PUBLISHED_ARTIFACTS is produced by the worker's build profile,
// so a missing one means the build silently skipped a step. Publishing the rest
// would hand web instances a bundle that is short a file they expect, and the
// gap would only surface as a 404 in a browser — fail here instead.
if (missing.length) fail(`missing built artifact(s): ${missing.join(", ")} — check the build profile`);

await putArtifacts(builtSha, items);
const totalGz = items.reduce((n, a) => n + a.gz.byteLength, 0);
console.log(
  `publish-artifacts: published ${items.length} artifacts for ${builtSha.slice(0, 12)} ` +
    `(${(totalGz / 1024 / 1024).toFixed(2)} MB gz)`,
);

const pruned = await pruneArtifacts(config.atlasArtifactKeep);
if (pruned.length) console.log(`publish-artifacts: pruned ${pruned.length} old sha(s) (keep ${config.atlasArtifactKeep})`);

await sql.end();
