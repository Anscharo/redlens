#!/usr/bin/env node
// Boundary gate: no frontend-only package may reach the server or worker.
//
// Both service images (Dockerfile, Dockerfile.worker) install the FULL dependency
// set today, so a browser package sitting on the server's import graph costs
// nothing visible and stays invisible. It stops being invisible the moment either
// image installs --prod or filters out the frontend workspace — then it is a
// crash on the first request that touches the module.
//
// This walks the real static + literal-dynamic import closure from each runtime
// entry point and fails if any specifier resolves to a package in FRONTEND_ONLY.
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
// runs stepsFor("worker"), atlas-updater.ts runs stepsFor("updater"),
// preview/build.ts runs stepsFor("preview"), and the worker shells out to
// sync.ts / sync-embeddings.ts / build-history.mjs). A subprocess needs its
// imports installed in the image exactly as much as an imported module does, so
// each spawned script is its own entry point here.
//
// The step lists come from build-steps.mjs rather than a copy: that file exists
// precisely so this set is declared once. Only RUNTIME profiles are used —
// "docker" and "full" include ts/vite/bundle/tools, which run at image-build
// time and are supposed to see the frontend.
const SPAWNED_PROFILES = ["worker", "updater", "preview"];

const ENTRIES = [
  "src/server/index.ts",
  "scripts/required/atlas-worker.mjs",
  // Spawned directly by atlas-worker.mjs / index.ts, outside any profile.
  "src/server/sync.ts",
  "src/server/sync-embeddings.ts",
  "scripts/required/build-history.mjs",
  ...new Set(SPAWNED_PROFILES.flatMap((p) => stepsFor(p).map((s) => s.script).filter(Boolean))),
];

// Packages that belong to the browser bundle and must never be reachable from a
// service entry point. In Phase 2 this list becomes apps/web/package.json's
// dependencies — until then it is declared here.
const FRONTEND_ONLY = [
  "react", "react-dom", "react-markdown", "react-window",
  "@xyflow/react", "@uiw/react-color",
  "katex", "rehype-katex", "remark-gfm", "remark-math", "unist-util-visit",
  "graphology-layout-forceatlas2", "graphology-layout-noverlap", "graphology-traversal",
  "wouter", "posthog-js", "wcag-contrast", "workbox-window",
  // build-time only, never a runtime import
  "vite", "vitest", "tailwindcss", "@tailwindcss/vite", "vite-plugin-pwa",
  "@vitejs/plugin-react", "@playwright/test", "jsdom", "fake-indexeddb",
  "@testing-library/dom", "@testing-library/jest-dom",
  "@testing-library/react", "@testing-library/user-event",
];

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
    if (FRONTEND_ONLY.includes(name)) {
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
  console.log(`check-boundaries: OK — ${visited.size} files reachable from ${ENTRIES.length} entry points, no frontend-only imports.`);
  process.exit(0);
}

// One line per offending package, with the shortest chain that reaches it: the
// shortest chain is the one whose edges are easiest to reason about cutting.
const byPkg = new Map();
for (const v of violations) {
  const prev = byPkg.get(v.pkg);
  if (!prev || v.chain.length < prev.length) byPkg.set(v.pkg, v.chain);
}

console.error(`check-boundaries: ${byPkg.size} frontend-only package(s) reachable from a service entry point.\n`);
for (const [pkg, chain] of [...byPkg].sort()) {
  console.error(`  ${pkg}`);
  console.error(`    ${chain.join("\n      -> ")}\n`);
}
console.error("Each of these ships in the browser bundle only. Reachable from a service");
console.error("entry point means it must be installed in the web/worker image too, and");
console.error("breaks that image the moment the install is pruned. Cut one edge in the");
console.error("chain — usually by splitting a pure helper away from a browser-side one.");
process.exit(1);
