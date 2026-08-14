// The atlas build chain, declared once.
//
// This chain used to be enumerated by hand in eight places with nothing
// asserting they agreed: package.json's `build`, the Dockerfile builder stage,
// build-at.mjs, refresh-atlas-build.mjs, dev-preflight.mjs, atlas-worker.mjs,
// src/server/atlas-updater.ts and src/server/preview/build.ts. The JS sites now
// iterate a PROFILE from this file; the two non-JS sites (package.json, the
// Dockerfile) are asserted against it by scripts_tests/build-steps.test.ts.
//
// The divergences between consumers are DELIBERATE, not drift — each profile
// below states its opt-outs and why. The point of this file is to make an
// accidental divergence loud, not to force every site to run the same steps.

/** @typedef {{ id: string, name: string, script: string | null, pnpmScript: string, runner: "node" | "bun" | null }} BuildStep */

// Canonical order == package.json's `build` (the `full` profile). Anything that
// runs a subset must keep this relative order, modulo COMMUTES below.
const DECLARED = [
  { id: "index", script: "scripts/required/build-index.mjs", pnpmScript: "build:index", runner: "node" },
  { id: "glossary", script: "scripts/required/build-glossary.mjs", pnpmScript: "build:glossary", runner: "node" },
  { id: "addresses", script: "scripts/required/build-addresses.mjs", pnpmScript: "build:addresses", runner: "node" },
  { id: "graph", script: "scripts/required/build-graph.mjs", pnpmScript: "build:graph", runner: "node" },
  { id: "oea-report", script: "scripts/required/build-oea-report.ts", pnpmScript: "build:oea-report", runner: "bun" },
  { id: "manifest", script: "scripts/required/build-manifest.mjs", pnpmScript: "build:manifest", runner: "node" },
  { id: "bundle", script: "scripts/required/build-bundle.ts", pnpmScript: "build:bundle", runner: "bun" },
  { id: "tools", script: "scripts/required/build-tools.ts", pnpmScript: "build:tools", runner: "bun" },
  // No script path: these two shell out to tooling binaries (`tsc -b`,
  // `vite build`), not to a scripts/required entry point. Declared so the
  // docker + full profiles are complete chains rather than truncated ones.
  { id: "ts", script: null, pnpmScript: "build:ts", runner: null },
  { id: "vite", script: null, pnpmScript: "build:vite", runner: null },
];

/**
 * `name` is the log/error label every consumer wants ("build-graph exited 1",
 * "atlas-worker: build-oea-report…") — derived from the script basename so it
 * can never drift from the file actually being run.
 * @type {BuildStep[]}
 */
export const STEPS = DECLARED.map((s) => ({
  ...s,
  name: s.script ? s.script.replace(/^.*\//, "").replace(/\.(mjs|ts)$/, "") : s.pnpmScript,
}));

/**
 * Unordered step pairs that may legitimately appear in either order. graph and
 * glossary both consume only docs.json and write disjoint files (graph:
 * graph/relations/addresses.atlas; glossary: glossary), which is why
 * src/server/preview/build.ts runs them *concurrently*. package.json runs
 * glossary first, the Dockerfile runs graph first — both correct.
 * @type {[string, string][]}
 */
export const COMMUTES = [["graph", "glossary"]];

/**
 * Ordered step-id lists, one per consumer site.
 * @type {Record<string, string[]>}
 */
export const PROFILES = {
  // package.json `build` — the only complete chain. Asserted by test, not
  // consumed: package.json can't import this file.
  full: ["index", "glossary", "addresses", "graph", "oea-report", "manifest", "bundle", "tools", "ts", "vite"],

  // Dockerfile builder stage. Asserted by test, not consumed.
  // Opt-outs: `addresses` (public/addresses.json is committed — the image ships
  // the checked-in file rather than burning Etherscan calls per deploy) and
  // `manifest` (a provenance record for repo builds; nothing in the image
  // reads it).
  docker: ["index", "graph", "glossary", "oea-report", "bundle", "tools", "ts", "vite"],

  // scripts/required/build-at.mjs — reproducible build at a pinned atlas sha.
  // `addresses` is conditional there (only with ETHERSCAN_API_KEY); the gate
  // lives in build-at.mjs, the ordering lives here.
  // Opt-outs: bundle/tools/ts/vite (not atlas-derived data).
  // FLAGGED: `glossary` is missing and probably shouldn't be — build-manifest
  // digests glossary.json, so a build:at leaves the manifest either without a
  // glossary entry or hashing a glossary from some *other* atlas commit. Left
  // as-is deliberately (this package is a wiring refactor, zero behaviour
  // change); adding it is a follow-up with its own manifest-diff review.
  buildAt: ["index", "addresses", "graph", "oea-report", "manifest"],

  // scripts/required/refresh-atlas-build.mjs — subprocess for the in-process
  // updater's git path. Opt-outs: addresses (needs API keys), bundle/tools/ts/
  // vite (code unchanged), history (separate cadence).
  refresh: ["index", "graph", "glossary", "oea-report", "manifest"],

  // scripts/aux/dev-preflight.mjs ensureArtifacts() — the fallback that runs
  // when the atlas worker was skipped or failed. Opt-outs: addresses (committed
  // file, present already), manifest (dev never reads it); bundle + tools are
  // their own preflight steps with their own skip conditions.
  devArtifacts: ["index", "graph", "glossary", "oea-report"],

  // scripts/aux/dev-preflight.mjs, after a successful atlas-worker run: the
  // worker builds index+graph but not these two, so refresh them for the
  // synced sha.
  devWorkerTail: ["glossary", "oea-report"],

  // scripts/required/atlas-worker.mjs — Railway cron. Opt-out: `glossary` (the
  // worker's product is Postgres rows, and sync.ts does not read glossary.json;
  // the web service builds it from DB rows via the `updater` profile).
  // build-history + sync-embeddings run as a parallel tail, not as steps here.
  worker: ["index", "graph", "oea-report"],

  // src/server/atlas-updater.ts refreshFromDb(). Starts at `graph`: docs.json
  // is written straight from atlas_doc_meta rows, so there is no build-index.
  updater: ["graph", "glossary", "oea-report"],

  // src/server/preview/build.ts — DOCUMENTATION ONLY, not mechanically wired
  // (that file is out of scope for this package). It runs index, then graph and
  // glossary CONCURRENTLY, each with its own env (ATLAS_SRC_DIR / ATLAS_OUT_DIR
  // / ATLAS_ONCHAIN_DIR) so a preview never writes to the live public/ dir.
  preview: ["index", "graph", "glossary"],
};

/**
 * Flat artifacts the Dockerfile pre-gzips at image build time (the request
 * handler prefers `<file>.gz` for gzip-accepting clients). Hand-maintained
 * there; asserted against this list by test. Note the updater's .gz refresh
 * derives its set from what's on disk instead — deliberately, so it
 * self-maintains.
 */
export const GZIP_ARTIFACTS = ["docs.json", "search-index.json", "relations.json", "glossary.json", "oea-report.json"];

const BY_ID = new Map(STEPS.map((s) => [s.id, s]));

/**
 * One step by id — for the handful of call sites that run a single step outside
 * any sequential chain (dev-preflight's bundle/tools/oea-report repairs).
 * @param {string} id
 * @returns {BuildStep}
 */
export function stepById(id) {
  const step = BY_ID.get(id);
  if (!step) throw new Error(`build-steps: unknown step "${id}"`);
  return step;
}

/**
 * Steps of a named profile, in that profile's order.
 * @param {string} profile
 * @returns {BuildStep[]}
 */
export function stepsFor(profile) {
  const ids = PROFILES[profile];
  if (!ids) throw new Error(`build-steps: unknown profile "${profile}" (have: ${Object.keys(PROFILES).join(", ")})`);
  return ids.map((id) => {
    const step = BY_ID.get(id);
    if (!step) throw new Error(`build-steps: profile "${profile}" names unknown step "${id}"`);
    return step;
  });
}
