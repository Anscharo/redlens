import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaFor, backendAreaIds, isLogicLine, libAreaIds, meetsChangedMin, mergeLcovReports, reactAreaIds } from "../scripts/aux/coverage-areas.mjs";

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

// isLogicLine decides what lands in a meter's numerator AND denominator. Its
// job is to measure tested logic, so anything that carries no logic — blank
// lines, brace-only structure, comments — must be excluded from both.
//
// The comment rule is load-bearing rather than cosmetic. bun's LCOV emits DA
// records for comment lines where v8's does not, and for a scripts/lib module
// that a src/server test merely imports, every one of those records is 0.
// Because the two reports are merged by line number, without this rule an
// added comment block counts as uncovered code and can fail the changed-code
// gate on a change whose statements are fully tested.
describe("isLogicLine", () => {
  // Uses this test file itself as the fixture, so the line numbers are real.
  const self = "scripts_tests/coverage-areas.test.ts";
  // Last occurrence: the fixtures sit at the end of the file, so this skips the
  // assertion above that names the same marker.
  const lineOf = (needle: string): number => {
    const src = readFileSync(path.join(repo, self), "utf8").split("\n");
    const i = src.map((l, n) => (l.includes(needle) ? n : -1)).filter((n) => n !== -1).pop();
    if (i === undefined) throw new Error(`fixture line not found: ${needle}`);
    return i + 1;
  };

  it("counts a line carrying an identifier or literal", () => {
    expect(isLogicLine(self, lineOf("const MARKER_LOGIC ="))).toBe(true);
  });

  it("excludes comment lines", () => {
    expect(isLogicLine(self, lineOf("// MARKER_LINE_COMMENT"))).toBe(false);
    expect(isLogicLine(self, lineOf("/* MARKER_BLOCK_COMMENT"))).toBe(false);
    expect(isLogicLine(self, lineOf("* MARKER_BLOCK_CONTINUATION"))).toBe(false);
  });

  it("still counts code that carries a trailing comment", () => {
    expect(isLogicLine(self, lineOf("const MARKER_TRAILING ="))).toBe(true);
  });

  it("excludes blank and brace-only structural lines", () => {
    // The line after the marker is the object literal's closing `};`.
    expect(isLogicLine(self, lineOf("MARKER_BEFORE_BRACE") + 1)).toBe(false);
    // A line past the end of the file is not logic.
    expect(isLogicLine(self, 100000)).toBe(false);
  });

  it("counts every line of an unreadable file, conservatively", () => {
    expect(isLogicLine("scripts/lib/does-not-exist.mjs", 1)).toBe(true);
  });
});

// The changed-code gate. A raw percentage has no resolution on a small diff:
// 3 changed logic lines can only score 0/33/67/100, so one uncovered guard
// fails a gate a 100-line PR clears with 15 uncovered lines. The grace forgives
// that many uncovered lines outright and fades in weight as the diff grows.
describe("meetsChangedMin", () => {
  it("passes when the percentage clears the minimum", () => {
    expect(meetsChangedMin(90, 100, 85, 1)).toBe(true);
    expect(meetsChangedMin(17, 20, 85, 1)).toBe(true);
  });

  it("forgives a single uncovered line on a small diff", () => {
    // The shape that motivated the grace: a 3-line change scoring 66.67%.
    expect(meetsChangedMin(2, 3, 85, 1)).toBe(true);
    expect(meetsChangedMin(1, 2, 85, 1)).toBe(true);
    expect(meetsChangedMin(4, 5, 85, 1)).toBe(true);
  });

  it("still fails a small diff with more than one uncovered line", () => {
    expect(meetsChangedMin(1, 3, 85, 1)).toBe(false);
    expect(meetsChangedMin(3, 5, 85, 1)).toBe(false);
  });

  it("does not meaningfully loosen a large diff", () => {
    // One forgiven line out of 100 cannot rescue a 70%-covered change.
    expect(meetsChangedMin(70, 100, 85, 1)).toBe(false);
    expect(meetsChangedMin(84, 100, 85, 1)).toBe(false);
  });

  it("treats an untouched area as passing", () => {
    expect(meetsChangedMin(0, 0, 85, 1)).toBe(true);
  });

  it("waives the gate entirely for a single changed line", () => {
    // A deliberate consequence of the grace: a one-line diff can't be scored
    // any finer than 0% or 100%, so it is forgiven rather than gated.
    expect(meetsChangedMin(0, 1, 85, 1)).toBe(true);
  });

  it("collapses to a plain percentage gate with the grace disabled", () => {
    expect(meetsChangedMin(2, 3, 85, 0)).toBe(false);
    expect(meetsChangedMin(3, 3, 85, 0)).toBe(true);
  });

  it("passes everything at the baseline producer's minimum of 0", () => {
    // coverage-baseline.yml runs with COVERAGE_CHANGED_MIN=0 and must never fail.
    expect(meetsChangedMin(0, 50, 0, 1)).toBe(true);
  });
});

// --- fixtures for the assertions above (kept last; line content matters) ---
const MARKER_LOGIC = 1;
// MARKER_LINE_COMMENT
/* MARKER_BLOCK_COMMENT
 * MARKER_BLOCK_CONTINUATION
 */
const MARKER_TRAILING = 2; // a trailing comment must not hide the code
const markerObj = {
  a: "MARKER_BEFORE_BRACE",
};
void [MARKER_LOGIC, MARKER_TRAILING, markerObj];

// ── mergeLcovReports ─────────────────────────────────────────────────────────
// The multi-runner merge must not let an import-only runner's DA:0 rows add
// phantom "uncovered" lines to a file another runner fully exercises. Bun emits
// DA records for `export function` headers and multi-line condition
// continuations that v8 never considers executable; before the authoritative-
// line-set rule, those rows permanently failed the changed-line gate for any
// src/lib helper that a src/server module merely imports (routes.ts, PR #279).
describe("mergeLcovReports", () => {
  const m = (entries: Array<[number, number]>) => new Map(entries);

  it("drops import-only DA:0 rows for lines the exercising runner never emits", () => {
    const vitest = new Map([["src/lib/routes.ts", m([[47, 25], [48, 24], [50, 8]])]]);
    const bun = new Map([["src/lib/routes.ts", m([[46, 0], [47, 0], [48, 0], [50, 0], [58, 0]])]]);
    const merged = mergeLcovReports([vitest, bun]);
    const lines = merged.get("src/lib/routes.ts")!;
    expect([...lines.keys()].sort((a, b) => a - b)).toEqual([47, 48, 50]);
    expect(lines.get(47)).toBe(25);
    expect(lines.get(46)).toBeUndefined();
    expect(lines.get(58)).toBeUndefined();
  });

  it("sums hits across runners over the authoritative line set", () => {
    const a = new Map([["f.ts", m([[10, 1]])]]);
    const b = new Map([["f.ts", m([[10, 2], [11, 0]])]]);
    const merged = mergeLcovReports([a, b]);
    // b has the greater total (2 > 1) → its line set {10, 11} wins; hits sum.
    expect(merged.get("f.ts")!.get(10)).toBe(3);
    expect(merged.get("f.ts")!.get(11)).toBe(0);
  });

  it("keeps a single runner's lines untouched, including all-zero files", () => {
    const only = new Map([["cold.ts", m([[1, 0], [2, 0]])]]);
    const merged = mergeLcovReports([only, new Map()]);
    expect([...merged.get("cold.ts")!.entries()]).toEqual([[1, 0], [2, 0]]);
  });
});
