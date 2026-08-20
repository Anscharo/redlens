// The alias map is declared once in scripts/lib/path-aliases.mjs. Two of its
// five consumers can't import it — tsconfig.app.json and tsconfig.test.json are
// JSON — so they're asserted here instead. Same arrangement, and the same
// reason, as build-steps.test.ts: a divergence should be loud, not silent.
//
// A stale `paths` entry is a nasty failure: tsc keeps resolving via the old
// mapping and typechecks clean, while Vite resolves via the new one and the
// bundle breaks at runtime.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALIASES, resolveAlias, tsconfigPaths } from "../scripts/lib/path-aliases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

/**
 * tsconfigs are JSONC. Comment stripping has to be string-aware here rather than
 * a regex: the alias pattern itself is `"@/*": ["./src/*"]`, so a naive
 * /\/\*...\*\// sweep starts inside that string literal and eats the rest of the
 * file. (It did, which is how this scanner came to exist.)
 */
function parseJsonc(src: string): Record<string, unknown> {
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\") { out += src[++i] ?? ""; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end - 1;
      continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

describe("path aliases are declared once", () => {
  // Every tsconfig that resolves `@/` — including the ones inside apps/web, whose
  // targets have to point back up out of the package.
  for (const file of [
    "tsconfig.test.json",
    "apps/web/tsconfig.app.json",
    "apps/web/tsconfig.test.json",
  ]) {
    it(`${file} paths match the declaration`, () => {
      const cfg = parseJsonc(read(file)) as { compilerOptions?: { paths?: unknown } };
      expect(cfg.compilerOptions?.paths).toEqual(tsconfigPaths(path.dirname(file)));
    });
  }

  // These two DO import the module, so there is no map to compare — the check is
  // that they still derive from it rather than having grown a hand-written copy.
  for (const file of ["apps/web/vite.config.ts", "vitest.config.ts"]) {
    it(`${file} derives its aliases from the declaration`, () => {
      expect(read(file)).toContain('path-aliases.mjs');
    });
  }

  it("the boundary gate resolves aliases rather than reading them as packages", () => {
    expect(read("scripts/required/check-boundaries.mjs")).toContain("resolveAlias");
  });

  it("every alias target exists", () => {
    for (const target of Object.values(ALIASES)) {
      expect(fs.existsSync(path.join(ROOT, target)), target).toBe(true);
    }
  });

  it("resolveAlias maps aliased specifiers and leaves everything else alone", () => {
    expect(resolveAlias("@/lib/oeaReport")).toBe("src/lib/oeaReport");
    expect(resolveAlias("./sibling")).toBeNull();
    expect(resolveAlias("react")).toBeNull();
    expect(resolveAlias("@scope/pkg")).toBeNull();
  });
});
