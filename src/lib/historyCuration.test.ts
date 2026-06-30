// buildDecisionsFile's per-change provenance: each decision is stamped with how its link
// was traced so the freeze can badge HTML-era entries (plan §10.4). Pure — no fetch/env.
import { describe, it, expect } from "vitest";
import { buildDecisionsFile, type CurationData, type Pick } from "./historyCuration";

const kase = (key: string, kind: string, autoKey: string | null) => ({
  key, kind, newerSha: "s1", olderSha: "s0", subjectKey: key, autoKey, candidates: [],
});
const data: CurationData = {
  meta: { migrationSha: "mig", lastHtmlSha: "html" },
  commits: [],
  nodes: {},
  cases: [kase("cA", "tier-3", "o1"), kase("cB", "seed-close", "o2"), kase("cC", "ambiguous", null)],
};

describe("buildDecisionsFile method attribution", () => {
  it("maps an accepted auto-pick to its mechanism's method, and a human pick to 'human'", () => {
    const picks: Record<string, Pick> = { cA: "o1", cB: "o2", cC: "o9" };
    const autoResolved = new Map([["cA", "frontier"], ["cB", "forward-reverse"]]);
    const byKey = Object.fromEntries(
      buildDecisionsFile(data, picks, autoResolved).decisions.map((d) => [d.caseKey, (d as { method?: string }).method]),
    );
    expect(byKey.cA).toBe("ai"); // frontier lock → ai
    expect(byKey.cB).toBe("deterministic"); // forward∩reverse → deterministic
    expect(byKey.cC).toBe("human"); // not auto-resolved → a human pick
  });

  it("treats llm-90 as ai and containment as deterministic", () => {
    const autoResolved = new Map([["cA", "llm-90"], ["cB", "containment"]]);
    const byKey = Object.fromEntries(
      buildDecisionsFile(data, { cA: "o1", cB: "o2" }, autoResolved).decisions.map((d) => [d.caseKey, (d as { method?: string }).method]),
    );
    expect(byKey.cA).toBe("ai");
    expect(byKey.cB).toBe("deterministic");
  });

  it("omits method entirely when autoResolved is not supplied (legacy shape)", () => {
    const file = buildDecisionsFile(data, { cA: "o1" });
    expect((file.decisions[0] as { method?: string }).method).toBeUndefined();
  });
});
