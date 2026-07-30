// tools-censuses.ts: the atlas_describe "censuses" section — summaries, the
// censuses:<slug> member drill-down, per-Indexes memoization, and the wiring
// through atlasDescribe's sections param. Run under `bun test`.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode } from "../../retrieval/indexes.ts";
import { CENSUS_SLUGS } from "../../../lib/conceptsCensus.ts";
import { conceptsCensusFor, censusesSection } from "./tools-censuses.ts";
import { atlasDescribe } from "./tools.ts";

function doc(id: string, doc_no: string, title: string, content = `${title} body`, type = "Core"): AtlasNode {
  return { id, doc_no, title, type, depth: 1, parentId: null, content, order: 0, addressRefs: [] };
}

const ix = buildIndexes(
  [
    doc("d-empty-reg", "A.1.1", "List Of Foos", "The Foos are:"),
    doc("d-live-reg", "A.1.2", "List Of Bars", "The Bars are:\n\n- bar one\n- bar two"),
    doc("d-plain", "A.2", "Plain Doc"),
  ],
  [],
  [],
  { atlasCommit: "test" },
  null,
  {},
);

describe("conceptsCensusFor", () => {
  it("computes all censuses and memoizes per Indexes instance", () => {
    const first = conceptsCensusFor(ix);
    expect(Object.keys(first).sort()).toEqual([...CENSUS_SLUGS].sort());
    expect(conceptsCensusFor(ix)).toBe(first);
  });

  it("sees the fixture registries with live/empty buckets", () => {
    const reg = conceptsCensusFor(ix)["registry-liveness"];
    expect(reg.counts).toMatchObject({ total: 2, live: 1, empty: 1 });
    const byId = Object.fromEntries(reg.members.map((m) => [m.uuid, m.bucket]));
    expect(byId["d-live-reg"]).toBe("live");
    expect(byId["d-empty-reg"]).toBe("empty");
  });
});

describe("censusesSection", () => {
  it("returns summary rows (no members) for all censuses when no slug is requested", () => {
    const out = censusesSection(ix, []);
    const rows = out.censuses as Record<string, unknown>[];
    expect(rows.map((r) => r.slug)).toEqual([...CENSUS_SLUGS]);
    for (const r of rows) {
      expect(r.members).toBeUndefined();
      expect(r.counts).toBeDefined();
      expect(r.signature).toBeDefined();
    }
    expect(String(out.note)).toContain("our census shows");
  });

  it("returns full members for a requested slug", () => {
    const out = censusesSection(ix, ["registry-liveness"]);
    const rows = out.censuses as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("registry-liveness");
    expect((rows[0].members as unknown[]).length).toBe(2);
  });

  it("reports an unknown slug without throwing", () => {
    const rows = censusesSection(ix, ["nope"]).censuses as Record<string, unknown>[];
    expect(rows[0].slug).toBe("nope");
    expect(String(rows[0].error)).toContain("Unknown census slug");
    expect(String(rows[0].error)).toContain("registry-liveness");
  });
});

describe("atlasDescribe wiring", () => {
  it("excludes censuses by default", () => {
    expect(atlasDescribe(ix).censuses).toBeUndefined();
  });

  it("includes summaries for sections ['censuses'] and for 'all'", () => {
    for (const sections of [["censuses"], ["all"]]) {
      const out = atlasDescribe(ix, sections).censuses as { censuses: unknown[] };
      expect(out.censuses).toHaveLength(CENSUS_SLUGS.length);
    }
  });

  it("drills down on a censuses:<slug> section spec", () => {
    const out = atlasDescribe(ix, ["censuses:registry-liveness"]).censuses as { censuses: { slug: string; members: unknown[] }[] };
    expect(out.censuses).toHaveLength(1);
    expect(out.censuses[0].members).toHaveLength(2);
  });

  it("lists censuses in available_sections", () => {
    expect(atlasDescribe(ix).available_sections).toContain("censuses");
  });
});
