import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { ENV_GROUPS } from "./registry.ts";
import { commentLines, renderEnvExample } from "./render.ts";
import type { EnvVar } from "./types.ts";

const ROOT = path.resolve(import.meta.dir, "../../..");
const VARS: EnvVar[] = ENV_GROUPS.flatMap((g) => g.vars);
const DECLARED = new Set(VARS.map((v) => v.name));

// Where operator-facing configuration is read. Tests and type declarations are
// excluded: they set variables, they do not consume configuration.
const SCANNED = [
  "src/server",
  "scripts/required",
  "scripts/lib",
  "scripts/aux/dev-preflight.mjs",
  "scripts/aux/dev-offchain-artifacts.ts",
  "scripts/aux/dev.mjs",
];
// Set by the CI runner for its own protocol, never by an operator.
const NOT_CONFIG = new Set(["GITHUB_ACTIONS", "GITHUB_OUTPUT"]);

function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).isDirectory()) for (const e of fs.readdirSync(abs)) walk(path.join(rel, e));
    else if (/\.(ts|mjs|js)$/.test(rel) && !/\.test\.|__tests__|\.d\.m?ts$/.test(rel)) out.push(rel);
  };
  for (const r of SCANNED) walk(r);
  return out;
}

/** Every variable name read from the environment in the scanned code, plus the Dockerfile's VITE_* build args. */
function readNames(): Map<string, string> {
  const re = /\b(?:process\.env|Bun\.env|env)\.([A-Z][A-Z0-9_]+)|process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g;
  const seen = new Map<string, string>();
  for (const f of scannedFiles())
    for (const m of fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(re)) {
      const name = m[1] ?? m[2];
      if (!seen.has(name)) seen.set(name, f);
    }
  for (const m of fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8").matchAll(/^ARG (VITE_[A-Z0-9_]+)/gm)) seen.set(m[1], "Dockerfile");
  return seen;
}

describe("env registry", () => {
  test(".env.example is rendered from the registry (run `pnpm env:example`)", () => {
    expect(fs.readFileSync(path.join(ROOT, ".env.example"), "utf8")).toBe(renderEnvExample(ENV_GROUPS));
  });

  test("each variable is declared once", () => {
    expect(VARS.length).toBe(DECLARED.size);
  });

  test("every variable the code reads is declared", () => {
    const undeclared = [...readNames()].filter(([n]) => !DECLARED.has(n) && !NOT_CONFIG.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(undeclared).toEqual([]);
  });

  test("every declared variable is read somewhere", () => {
    const read = readNames();
    expect([...DECLARED].filter((n) => !read.has(n))).toEqual([]);
  });
});

describe("commentLines", () => {
  test("wraps prose to 80-column comment lines and keeps indented lines as written", () => {
    const lines = commentLines(`${"word ".repeat(30).trim()}\n  keep   this`);
    expect(lines.every((l) => l.length <= 80)).toBe(true);
    expect(lines.at(-1)).toBe("#  keep   this");
  });

  test("renders an empty paragraph as a bare comment marker", () => {
    expect(commentLines("a\n\nb")).toEqual(["# a", "#", "# b"]);
  });
});
