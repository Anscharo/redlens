// Synthetic-fixture tests for the risk-rule pre-filter. Real-artifact floors
// live in riskRules.artifact.test.ts.

import { describe, it, expect, vi } from "vitest";
import type { AtlasNode } from "../types";
import type { AtlasBundle } from "./docs";
import { enumerateRiskCandidates, riskDocContentHash } from "./riskRules";

// A.3.1 Core Stability Parameters — a real anchor uuid (the anchor table is
// uuid-keyed, so the fixture reuses it).
const ANCHOR_UUID = "80f168a3-4a01-40dd-bb57-851f48d58912";

let order = 0;
const node = (id: string, docNo: string, title: string, content: string, extra: Partial<AtlasNode> = {}): AtlasNode => ({
  id, doc_no: docNo, title, type: "Core", depth: docNo.split(".").length,
  parentId: null, order: order++, content, addressRefs: [], ...extra,
});

const bundle = (nodes: AtlasNode[]): AtlasBundle => ({
  docs: Object.fromEntries(nodes.map((n) => [n.id, n])),
  byParent: new Map(),
  docNoToId: new Map(),
  atlasCommit: null,
});

const PAD = "This obligation binds the named party under the conditions stated here."; // >40 chars

describe("enumerateRiskCandidates", () => {
  it("includes anchor descendants without any keyword, tagged with the anchor domain", () => {
    const anchor = node(ANCHOR_UUID, "A.3.1", "Core Stability Parameters", PAD);
    const child = node("c1", "A.3.1.2", "Parameters Detail", `No trigger words at all here. ${PAD}`, { parentId: ANCHOR_UUID });
    const { candidates } = enumerateRiskCandidates(bundle([anchor, child]));
    const row = candidates.find((r) => r.uuid === "c1");
    expect(row).toBeDefined();
    expect(row!.domains).toEqual(["peg"]);
    expect(row!.anchored).toBe(true);
  });

  it("includes keyword residue outside anchors with matching domains", () => {
    const doc = node("k1", "A.2.9.9", "Some Duty", `The actor must post Risk Capital reports quarterly. ${PAD}`);
    const { candidates } = enumerateRiskCandidates(bundle([doc]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].domains).toEqual(["alloc"]);
    expect(candidates[0].anchored).toBe(false);
  });

  it("excludes non-rule doc types, empty docs, and container intros — with reason buckets", () => {
    const annotation = node("x1", "A.2.9.1.0.3.1", "Peg Note", `About the peg. ${PAD}`, { type: "Annotation" });
    const empty = node("x2", "A.2.9.2", "Peg", "peg");
    const container = node("x3", "A.2.9.3", "Peg Rules", "The documents herein define the peg maintenance rules.");
    const { candidates, excluded } = enumerateRiskCandidates(bundle([annotation, empty, container]));
    expect(candidates).toHaveLength(0);
    expect(excluded["type:Annotation"]).toBe(1);
    expect(excluded.empty).toBe(1);
    expect(excluded.container).toBe(1);
  });

  it("keeps stub docs (container-shaped or not) and flags them", () => {
    const stub = node("s1", "A.3.1.9", "Future Rule",
      "This document defines the peg parameter. It will be specified further in a future iteration of the framework.");
    const { candidates } = enumerateRiskCandidates(bundle([stub]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].stub).toBe(true);
  });

  it("flags quantifiable metrics", () => {
    const q = node("m1", "A.2.9.4", "Buffer Rule", `The surplus buffer must hold at least 5% of exposure. ${PAD}`);
    const { candidates } = enumerateRiskCandidates(bundle([q]));
    expect(candidates[0].hasMetrics).toBe(true);
  });

  it("collapses agent-artifact copies identical modulo the Prime name; differing contents stay separate", () => {
    const roots = [
      node("ag1", "A.6.1.1.1", "Spark", PAD),
      node("ag2", "A.6.1.1.2", "Grove", PAD),
    ];
    const clause = (agent: string) =>
      `${agent} must maintain Risk Capital coverage for its allocations at all times. ${PAD}`;
    const same1 = node("d1", "A.6.1.1.1.5.1", "Risk Capital Coverage", clause("Spark"), { parentId: "ag1" });
    const same2 = node("d2", "A.6.1.1.2.5.1", "Risk Capital Coverage", clause("Grove"), { parentId: "ag2" });
    const diff1 = node("d3", "A.6.1.1.1.5.2", "Exposure Cap", `The exposure limit is 100 for Spark. ${PAD}`, { parentId: "ag1" });
    const diff2 = node("d4", "A.6.1.1.2.5.2", "Exposure Cap", `The exposure limit is 250 for Grove. ${PAD}`, { parentId: "ag2" });
    const { candidates, excluded } = enumerateRiskCandidates(bundle([...roots, same1, same2, diff1, diff2]));

    const collapsed = candidates.filter((r) => r.taskKey.startsWith("t:"));
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].taskKey).toBe("t:risk capital coverage|risk");
    expect(collapsed[0].uuid).toBe("d1"); // lowest doc_no is the representative
    expect(collapsed[0].agents).toEqual(["Spark", "Grove"]);
    expect(excluded["collapsed-copy"]).toBe(1);

    const caps = candidates.filter((r) => r.title === "Exposure Cap");
    expect(caps).toHaveLength(2);
    expect(caps.map((r) => r.taskKey).sort()).toEqual(["u:d3", "u:d4"]);
  });

  it("sorts by numeric doc_no and never emits duplicate task keys", () => {
    const a = node("n1", "A.3.1.10", "Ten", `peg rule ten. ${PAD}`);
    const b = node("n2", "A.3.1.2", "Two", `peg rule two. ${PAD}`);
    const { candidates } = enumerateRiskCandidates(bundle([a, b]));
    expect(candidates.map((r) => r.docNo)).toEqual(["A.3.1.2", "A.3.1.10"]);
    expect(new Set(candidates.map((r) => r.taskKey)).size).toBe(candidates.length);
  });
});

describe("KNOWN_NON_RULE exclusion — quoteHash staleness guard (FIX 4)", () => {
  const NONRULE_UUID = "11111111-1111-1111-1111-111111111111";
  const originalContent = `The documents herein define the peg maintenance rules for this Ecosystem Actor. ${PAD}`;
  const editedContent = `The peg maintenance rules require at least 5% collateralization at all times. ${PAD}`;

  it("still unconditionally excludes an entry with no recorded quoteHash (pre-backfill fallback)", async () => {
    vi.resetModules();
    vi.doMock("./data/risk-non-rule-docs.json", () => ({
      default: [{ uuid: NONRULE_UUID, docNo: "A.2.9.3", reason: "test fixture, no hash yet" }],
    }));
    const { enumerateRiskCandidates: enumerateFresh } = await import("./riskRules");
    const doc = node(NONRULE_UUID, "A.2.9.3", "Peg Rules", editedContent);
    const { candidates } = enumerateFresh(bundle([doc]));
    expect(candidates.find((r) => r.uuid === NONRULE_UUID)).toBeUndefined();
    vi.doUnmock("./data/risk-non-rule-docs.json");
    vi.resetModules();
  });

  it("excludes while the content still matches the curated quoteHash", async () => {
    vi.resetModules();
    const quoteHash = riskDocContentHash(originalContent.trim());
    vi.doMock("./data/risk-non-rule-docs.json", () => ({
      default: [{ uuid: NONRULE_UUID, docNo: "A.2.9.3", reason: "test fixture", quoteHash }],
    }));
    const { enumerateRiskCandidates: enumerateFresh } = await import("./riskRules");
    const doc = node(NONRULE_UUID, "A.2.9.3", "Peg Rules", originalContent);
    const { candidates } = enumerateFresh(bundle([doc]));
    expect(candidates.find((r) => r.uuid === NONRULE_UUID)).toBeUndefined();
    vi.doUnmock("./data/risk-non-rule-docs.json");
    vi.resetModules();
  });

  it("lets the exclusion lapse once the doc's content changes — falls through to candidacy", async () => {
    vi.resetModules();
    const staleHash = riskDocContentHash(originalContent.trim());
    vi.doMock("./data/risk-non-rule-docs.json", () => ({
      default: [{ uuid: NONRULE_UUID, docNo: "A.2.9.3", reason: "test fixture", quoteHash: staleHash }],
    }));
    const { enumerateRiskCandidates: enumerateFresh } = await import("./riskRules");
    const doc = node(NONRULE_UUID, "A.2.9.3", "Peg Rules", editedContent);
    const { candidates } = enumerateFresh(bundle([doc]));
    expect(candidates.find((r) => r.uuid === NONRULE_UUID)).toBeDefined();
    vi.doUnmock("./data/risk-non-rule-docs.json");
    vi.resetModules();
  });
});
