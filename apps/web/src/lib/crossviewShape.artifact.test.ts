// Floor for the GROUPS seed against the real built atlas — run `pnpm build:index`
// first if public/ is stale. Confirms the curated 33-UUID taxonomy still
// fully partitions A.1/A.2 (no "Ungrouped" residue) on the checked-out atlas
// commit, and that every curated root still resolves. Mirrors the
// riskRules.artifact.test.ts pattern (real-artifact floor tests, separate
// from the synthetic-fixture unit tests in crossviewShape.test.ts).

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "@/types";
import { computeCrossView, GROUPS } from "@/lib/crossviewShape";

const ROOT = path.resolve(__dirname, "../../../..");
const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as {
  atlasCommit: string | null;
  nodes: Record<string, AtlasNode>;
};
const nodes = docsFile.nodes;

describe("computeCrossView against the real atlas", () => {
  it("every curated root UUID (roots + complementOf + except) resolves in docs.json", () => {
    for (const g of GROUPS) {
      if ("roots" in g) {
        for (const r of g.roots) expect(nodes[r], `${g.name}: ${r}`).toBeDefined();
      } else {
        expect(nodes[g.complementOf], `${g.name}: complementOf ${g.complementOf}`).toBeDefined();
        for (const r of g.except) expect(nodes[r], `${g.name}: except ${r}`).toBeDefined();
      }
    }
  });

  it("leaves no A.1/A.2 article unclaimed on the current atlas shape", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lib = computeCrossView({ atlasCommit: docsFile.atlasCommit ?? "unknown", nodes, glossaryTerms: 0 });
    expect(lib.chunkTree.some((g) => g.title === "Ungrouped")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
