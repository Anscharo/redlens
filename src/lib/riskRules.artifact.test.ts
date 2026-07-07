// Floors for enumerateRiskCandidates against the real built artifacts.
// Run `pnpm build:index` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../types";
import { enumerateRiskCandidates, RISK_ANCHOR_UUIDS, RISK_DOMAIN_LABELS, type RiskDomain } from "./riskRules";

const ROOT = path.resolve(__dirname, "../..");
const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as {
  atlasCommit: string | null;
  nodes: Record<string, AtlasNode>;
};
const docs = docsFile.nodes;

const { candidates, excluded } = enumerateRiskCandidates({
  docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: docsFile.atlasCommit,
});

describe("enumerateRiskCandidates (real artifacts)", () => {
  it("every anchor uuid resolves in docs.json", () => {
    for (const u of RISK_ANCHOR_UUIDS) expect(docs[u], u).toBeDefined();
  });

  it("finds a large candidate universe with all three domains populated", () => {
    expect(candidates.length).toBeGreaterThan(1200);
    const byDomain = Object.fromEntries(
      (Object.keys(RISK_DOMAIN_LABELS) as RiskDomain[]).map((d) => [
        d, candidates.filter((r) => r.domains.includes(d)).length,
      ]),
    );
    expect(byDomain.peg).toBeGreaterThan(100);
    expect(byDomain.alloc).toBeGreaterThan(500);
    expect(byDomain.sc).toBeGreaterThan(400);
  });

  it("every candidate uuid resolves and no task keys collide", () => {
    for (const r of candidates) expect(docs[r.uuid], r.taskKey).toBeDefined();
    expect(new Set(candidates.map((r) => r.taskKey)).size).toBe(candidates.length);
  });

  it("includes the rubric's calibration docs", () => {
    const uuids = new Set(candidates.map((r) => r.uuid));
    // A.3.3.2.2 Minimum ASC (preciseness 5)
    expect(uuids.has("475fe222-9e4a-4e9d-9be6-a7a424ce02f8")).toBe(true);
    // A.3.2.2.1.1.1.1.1.2.1 Liquidation Penalty (preciseness 3)
    expect(uuids.has("bce9331b-04ca-4c50-9783-098739fc72c8")).toBe(true);
    // A.2.9.1.5 Legal And Regulatory Risk Monitoring (preciseness 2, keyword residue)
    expect(uuids.has("035ec13b-5676-45f0-a3b3-8b8e24a4adcf")).toBe(true);
    // A.3.2.1.2.2.1.1.1.1 IJRC stub (preciseness 1)
    const stubRow = candidates.find((r) => r.uuid === "a2df2b73-c1c5-40d6-b87e-43ba24f54870");
    expect(stubRow?.stub).toBe(true);
  });

  it("excludes containers and empty docs in meaningful numbers", () => {
    expect(excluded.container).toBeGreaterThan(50);
    expect(excluded.empty).toBeGreaterThan(20);
  });

  it("no candidate quote is empty and metrics/stub flags fire", () => {
    for (const r of candidates) expect(r.quote.length, r.taskKey).toBeGreaterThanOrEqual(40);
    expect(candidates.filter((r) => r.hasMetrics).length).toBeGreaterThan(100);
    expect(candidates.filter((r) => r.stub).length).toBeGreaterThan(10);
  });
});
