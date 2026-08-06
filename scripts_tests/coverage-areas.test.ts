import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaFor, backendAreaIds, libAreaIds, reactAreaIds } from "../scripts/required/coverage-areas.mjs";

// The scope of "React code" the coverage meters must partition: components,
// hooks, and context providers — .ts and .tsx, minus test files. If this set
// ever fails to be a total + disjoint partition of the React product meters,
// the per-product coverage numbers silently lie (a file falls to general-utils
// or uncategorized and never counts against any React denominator).

const repo = path.resolve(__dirname, "..");

function walk(rel: string, ext = "ts|tsx"): string[] {
  const abs = path.join(repo, rel);
  let entries: string[];
  try {
    entries = readdirSync(abs, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const extRe = new RegExp(`\\.(${ext})$`);
  const testRe = new RegExp(`\\.test\\.(${ext})$`);
  return entries
    .map((e) => `${rel}/${String(e).replaceAll(path.sep, "/")}`)
    .filter((f) => extRe.test(f))
    .filter((f) => !testRe.test(f))
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
    expect(areaFor("src/lib/csv.ts")).toBe("lib-reports-activity");
    expect(areaFor("src/workers/search.worker.ts")).toBe("frontend-workers");
  });
});

// The backend scope the meters must partition: every non-test source file under
// src/server/. The former single `backend-core` meter was split into per-product
// meters; if this set ever leaks a src/server file to general-utils/uncategorized
// (or a product meter goes empty), a product's coverage number silently lies.
const backendFiles = walk("src/server").filter((f) => !f.endsWith(".d.ts"));

describe("coverage areas — backend partition", () => {
  it("has a non-empty backend file set", () => {
    expect(backendFiles.length).toBeGreaterThan(50);
  });

  it("maps every src/server file to exactly one backend meter (totality)", () => {
    const stray = backendFiles.filter((f) => !backendAreaIds.includes(areaFor(f)));
    expect(stray).toEqual([]);
  });

  it("never routes a src/server file to general-utils or uncategorized", () => {
    const leaked = backendFiles.filter((f) => ["general-utils", "uncategorized"].includes(areaFor(f)));
    expect(leaked).toEqual([]);
  });

  it("leaves no backend meter empty", () => {
    const populated = new Set(backendFiles.map((f) => areaFor(f)));
    const empty = backendAreaIds.filter((id) => !populated.has(id));
    expect(empty).toEqual([]);
  });

  it("routes representative files to their product meter, and keeps routes/workers ahead of the split", () => {
    // Product buckets (files live in per-product folders).
    expect(areaFor("src/server/chat/chat-orchestrator.ts")).toBe("backend-chat");
    expect(areaFor("src/server/chat/tools/tool-registry.ts")).toBe("backend-chat-tools");
    expect(areaFor("src/server/chat/verify/verifier.ts")).toBe("backend-chat-verify");
    expect(areaFor("src/server/chat/verify/stream-link-gate.ts")).toBe("backend-chat-verify");
    expect(areaFor("src/server/retrieval/query.ts")).toBe("backend-retrieval");
    expect(areaFor("src/server/history/history-db.ts")).toBe("backend-history");
    expect(areaFor("src/server/preview/identity.ts")).toBe("backend-preview");
    expect(areaFor("src/server/reports/multisigs.ts")).toBe("backend-reports");
    expect(areaFor("src/server/config.ts")).toBe("backend-core");
    // First-match ordering: preview/ files owned by routes/workers must NOT fall to backend-preview.
    expect(areaFor("src/server/preview/handler.ts")).toBe("backend-routes");
    expect(areaFor("src/server/preview/build.ts")).toBe("backend-workers");
    expect(areaFor("src/server/preview/sweeper.ts")).toBe("backend-workers");
  });
});

// The lib scope the meters must partition: every non-React file directly under
// src/lib/ (the four *.tsx context providers belong to React, matched above) and
// every file under scripts/lib/. The former single `general-utils` meter was
// split into per-product meters; if this set ever leaks a file to uncategorized
// (or a product meter goes empty), a product's lib coverage number silently lies.
const libFiles = walk("src/lib").filter((f) => !libContext.includes(f));
const scriptsLibFiles = walk("scripts/lib", "mjs");

describe("coverage areas — lib partition", () => {
  it("has a non-empty lib file set", () => {
    expect(libFiles.length).toBeGreaterThan(80);
    expect(scriptsLibFiles.length).toBeGreaterThan(15);
  });

  it("maps every lib file to exactly one lib meter (totality)", () => {
    const stray = [...libFiles, ...scriptsLibFiles].filter((f) => !libAreaIds.includes(areaFor(f)));
    expect(stray).toEqual([]);
  });

  it("never routes a lib file to uncategorized", () => {
    const leaked = [...libFiles, ...scriptsLibFiles].filter((f) => areaFor(f) === "uncategorized");
    expect(leaked).toEqual([]);
  });

  it("leaves no lib meter empty", () => {
    const populated = new Set([...libFiles, ...scriptsLibFiles].map((f) => areaFor(f)));
    const empty = libAreaIds.filter((id) => !populated.has(id));
    expect(empty).toEqual([]);
  });

  it("routes representative files to their product meter", () => {
    expect(areaFor("src/lib/riskRules.ts")).toBe("lib-reports-duty");
    expect(areaFor("src/lib/rewardsIndex.ts")).toBe("lib-reports-activity");
    expect(areaFor("src/lib/crossviewShape.ts")).toBe("lib-crossview");
    expect(areaFor("src/lib/diffCore.ts")).toBe("lib-diff-preview");
    expect(areaFor("src/lib/addresses.ts")).toBe("lib-address-chain");
    expect(areaFor("src/lib/search.ts")).toBe("lib-search");
    expect(areaFor("src/lib/docs.ts")).toBe("lib-atlas-core");
    expect(areaFor("src/lib/glossary.ts")).toBe("lib-atlas-core");
    expect(areaFor("src/lib/graph.ts")).toBe("lib-graph");
    // Misc catch-alls.
    expect(areaFor("src/lib/format.ts")).toBe("lib-shared");
    expect(areaFor("scripts/lib/graph-entities.mjs")).toBe("scripts-lib-graph");
    expect(areaFor("scripts/lib/address-chains.mjs")).toBe("scripts-lib-address");
    expect(areaFor("scripts/lib/atlas-parser.mjs")).toBe("scripts-lib-core");
  });
});
