#!/usr/bin/env node
// Boundary gate: everything the services reach at runtime must survive the image
// install.
//
// Both images run `pnpm install --prod --filter sabr-root`, so exactly one set of
// packages exists in them: the ROOT package's `dependencies`. Anything else a
// service entry point reaches — an apps/web dependency, a root devDependency, an
// undeclared import — is present in dev and in CI, where the full workspace is
// installed, and absent in production. That gap is invisible until the image runs.
//
// The allowed set is therefore READ FROM package.json rather than listed here. An
// earlier version of this file kept a hand-maintained FRONTEND_ONLY denylist,
// which had already drifted: @chenglou/pretext is an apps/web dependency imported
// by treeUtils/breadcrumbs/asideFit and was missing from it, so a service import
// of those modules would have passed the gate and crashed the pruned image.
//
// Stating the rule positively also widens it for free: `viem` was a
// devDependency imported by src/server/balances at runtime, and this form catches
// that class too, not just browser packages.
//
// This walks the real static + literal-dynamic import closure from each runtime
// entry point and fails on any package outside that set.
// It reports the import CHAIN, not just the offending package, because the fix is
// always "cut one edge somewhere in that chain", and which edge is a judgement
// call the message needs to make possible.
//
// Deliberately independent of tsconfig/vite resolution — same reasoning as
// check-atlas-parsed.mjs: a gate that asked the bundler would agree with the
// bundler. It re-implements a dumb Node-style resolve so a bundler
// misconfiguration cannot hide a violation from it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stepsFor } from "../lib/build-steps.mjs";
import { resolveAlias } from "../lib/path-aliases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Runtime entry points. Anything reachable from these ships in a service image.
//
// The two long-lived processes are only half of it: both services also SPAWN
// build scripts as sibling `bun` subprocesses at repo root (atlas-worker.mjs
// runs stepsFor("worker"), preview/build.ts runs stepsFor("preview"), and the
// worker shells out to sync.ts / sync-embeddings.ts / build-history.mjs /
// publish-artifacts.ts). A subprocess needs its imports installed in the image
// exactly as much as an imported module does, so each spawned script is its
// own entry point here. The web updater no longer spawns a build profile —
// it hydrates from atlas_artifacts (phase 4).
//
// The step lists come from build-steps.mjs rather than a copy: that file exists
// precisely so this set is declared once. Only RUNTIME profiles are used —
// "docker" and "full" include ts/vite/bundle/tools, which run at image-build
// time and are supposed to see the frontend.
const SPAWNED_PROFILES = ["worker", "preview"];

const ENTRIES = [
  "src/server/index.ts",
  "scripts/required/atlas-worker.mjs",
  // Spawned directly by atlas-worker.mjs / index.ts, outside any profile.
  "src/server/sync.ts",
  "src/server/sync-embeddings.ts",
  "scripts/required/build-history.mjs",
  "scripts/required/publish-artifacts.ts",
  ...new Set(SPAWNED_PROFILES.flatMap((p) => stepsFor(p).map((s) => s.script).filter(Boolean))),
];

// The only packages an image contains: the root package's runtime dependencies.
// Derived, so adding a dependency to apps/web or moving one between dep sections
// updates the gate with no edit here.
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const SHIPPED = new Set(Object.keys(ROOT_PKG.dependencies ?? {}));

/** Where a package IS declared, so the failure message can name the fix. */
const WEB_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8"));
const WEB_DEPS = new Set([
  ...Object.keys(WEB_PKG.dependencies ?? {}),
  ...Object.keys(WEB_PKG.devDependencies ?? {}),
]);
const ROOT_DEV = new Set(Object.keys(ROOT_PKG.devDependencies ?? {}));

function whereDeclared(name) {
  if (WEB_DEPS.has(name)) return "an apps/web dependency — it is not installed in a service image";
  if (ROOT_DEV.has(name)) return "a root devDependency — --prod strips it";
  return "not declared in either package.json";
}

const EXTS = [".ts", ".tsx", ".mjs", ".js", ".mts", ".json"];

/** Node-ish resolve of a relative specifier: exact, then +ext, then /index+ext. */
function resolveRelative(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, "index" + e))];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Package name from a bare specifier: "@scope/pkg/sub" -> "@scope/pkg". */
const pkgName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

// Static `from "x"` / bare `import "x"`, plus dynamic import()/require() with a
// literal argument. Dynamic ones count: atlas-worker.mjs reaches src/server
// exclusively through await import(), and og-image.ts loads satori that way —
// a closure that skipped them would miss most of what actually ships.
// Anchored at a statement start on purpose: a bare /from ["']/ also matches
// prose inside comments and message strings ("... read the rules from \"x\"").
const FROM_RE = /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
const SIDE_EFFECT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
const DYNAMIC_RE = /\b(?:import|require)\(\s*["']([^"']+)["']/g;

// `import type {...} from "x"` / `export type {...} from "x"` are erased whole by
// the compiler, so they are NOT runtime edges and must not count — the Dockerfile
// already relies on this (it never copies src/types.ts, because every server
// reference to it is type-only). The repo sets verbatimModuleSyntax, which makes
// the rule exact rather than a guess: only the STATEMENT-level `import type` form
// disappears. `import { type A } from "x"` still emits the import for its side
// effects, so it stays a real edge and is deliberately not skipped here.
const TYPE_ONLY_RE = /^[ \t]*(?:import|export)\s+type\s/;

function importsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  // FROM_RE captures the whole statement, so the type-only test reads the match
  // itself rather than scanning backwards — scanning backwards finds the PREVIOUS
  // statement's keyword and misattributes its `type` to this one.
  for (const m of src.matchAll(FROM_RE)) {
    if (!TYPE_ONLY_RE.test(m[0])) out.push(m[1]);
  }
  // Side-effect and dynamic imports are never type-only.
  for (const re of [SIDE_EFFECT_RE, DYNAMIC_RE]) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const violations = [];
const visited = new Set();

/** DFS carrying the chain so a hit can name the path that produced it. */
function walk(file, chain) {
  if (visited.has(file)) return;
  visited.add(file);
  const rel = path.relative(ROOT, file);
  for (const spec of importsOf(file)) {
    if (/^(node|bun|virtual):/.test(spec)) continue;
    // An aliased specifier is a repo path, not a package. Resolving it here is
    // what stops `@/lib/analytics` in server code from reading as a bare
    // package named "@" and silently passing the gate.
    const aliased = resolveAlias(spec);
    if (spec.startsWith(".") || aliased) {
      const next = aliased
        ? resolveRelative("./" + aliased, path.join(ROOT, "x"))
        : resolveRelative(spec, file);
      if (next) walk(next, [...chain, rel]);
      continue;
    }
    const name = pkgName(spec);
    // `bun` is the runtime's own builtin (SQL, Bun.file, …), supplied by the
    // binary rather than installed — the sibling of the `node:`/`bun:` prefixes
    // skipped above, just without a prefix to skip on.
    if (name === "bun") continue;
    if (!SHIPPED.has(name)) {
      violations.push({ pkg: name, chain: [...chain, rel] });
    }
  }
}

for (const entry of ENTRIES) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) {
    console.error(`check-boundaries: entry point not found: ${entry}`);
    process.exit(1);
  }
  walk(abs, []);
}

if (violations.length === 0) {
  console.log(`check-boundaries: OK — ${visited.size} files reachable from ${ENTRIES.length} entry points; every package they import is a root dependency.`);
  process.exit(0);
}

// One line per offending package, with the shortest chain that reaches it: the
// shortest chain is the one whose edges are easiest to reason about cutting.
const byPkg = new Map();
for (const v of violations) {
  const prev = byPkg.get(v.pkg);
  if (!prev || v.chain.length < prev.length) byPkg.set(v.pkg, v.chain);
}

console.error(`check-boundaries: ${byPkg.size} package(s) reachable from a service entry point that the image will not contain.\n`);
for (const [pkg, chain] of [...byPkg].sort()) {
  console.error(`  ${pkg} — ${whereDeclared(pkg)}`);
  console.error(`    ${chain.join("\n      -> ")}\n`);
}
console.error("Both images install `--prod --filter sabr-root`, so only the root package's");
console.error("`dependencies` exist in them. Each package above is reachable at runtime and");
console.error("would be missing there. Either cut one edge in the chain — usually by");
console.error("splitting a pure helper away from a browser-side one — or, if the service");
console.error("genuinely needs it, promote it to a root dependency.");
process.exit(1);
