import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaFor, reactAreaIds } from "../scripts/required/coverage-areas.mjs";

// The scope of "React code" the coverage meters must partition: components,
// hooks, and context providers — .ts and .tsx, minus test files. If this set
// ever fails to be a total + disjoint partition of the React product meters,
// the per-product coverage numbers silently lie (a file falls to general-utils
// or uncategorized and never counts against any React denominator).

const repo = path.resolve(__dirname, "..");

function walk(rel: string): string[] {
  const abs = path.join(repo, rel);
  let entries: string[];
  try {
    entries = readdirSync(abs, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return entries
    .map((e) => `${rel}/${String(e).replaceAll(path.sep, "/")}`)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".d.ts"));
}

// Context providers that live under src/lib but are React (createContext).
const libContext = [
  "src/lib/dataSource.tsx",
  "src/lib/previewView.tsx",
  "src/lib/previewDiff.tsx",
  "src/lib/selection.tsx",
];

const reactFiles = [
  ...walk("src/components"),
  ...walk("src/hooks"),
  "src/App.tsx",
  "src/main.tsx",
  ...libContext,
];

describe("coverage areas — React partition", () => {
  it("has a non-empty React file set", () => {
    expect(reactFiles.length).toBeGreaterThan(80);
  });

  it("maps every React file to exactly one React product meter (totality)", () => {
    const stray = reactFiles.filter((f) => !reactAreaIds.includes(areaFor(f)));
    expect(stray).toEqual([]);
  });

  it("never routes a React file to general-utils or uncategorized", () => {
    const leaked = reactFiles.filter((f) => ["general-utils", "uncategorized"].includes(areaFor(f)));
    expect(leaked).toEqual([]);
  });

  it("leaves no React product meter empty", () => {
    const populated = new Set(reactFiles.map((f) => areaFor(f)));
    const empty = reactAreaIds.filter((id) => !populated.has(id));
    expect(empty).toEqual([]);
  });

  it("keeps non-React lib code out of the React meters", () => {
    // A plain lib util must not accidentally match a React bucket.
    expect(reactAreaIds).not.toContain(areaFor("src/lib/csv.ts"));
    expect(areaFor("src/lib/csv.ts")).toBe("general-utils");
    expect(areaFor("src/workers/search.worker.ts")).toBe("frontend-workers");
  });
});
