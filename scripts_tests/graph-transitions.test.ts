// Unit tests for Pattern 23 pending-operational-transition extraction
// (scripts/lib/graph-transitions.mjs). Content shapes are drawn from real
// atlas docs (verified against public/docs.json) where practical; the
// gate/skip branches use synthetic fixtures with realistic doc_nos.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractTransitions } from "../scripts/lib/graph-transitions.mjs";

function entity(slug: string, name: string, entity_type = "agent"): any {
  return { id: slug, slug, name, entity_type, subtype: null, defining_doc_id: null, is_active: 1, meta: null };
}

function doc(id: string, doc_no: string, title: string, content: string): any {
  return { id, doc_no, title, type: "Core", content };
}

function run(docs: any[], entityMap: Map<string, any>) {
  const edges: any[] = [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const docByDocNo = new Map(docs.map((d) => [d.doc_no, d]));
  const result = extractTransitions(docs, docById, docByDocNo, entityMap, edges);
  return { result, edges };
}

describe("extractTransitions", () => {
  it("extracts a full control handoff with current holder and estimated date", () => {
    // A.6.1.1.1.3.2.1.2.1 "SparkLend Risk Parameters Modification" (real atlas content).
    const d = doc(
      "d1",
      "A.6.1.1.1.3.2.1.2.1",
      "SparkLend Risk Parameters Modification",
      "The modification of SparkLend parameters is temporarily controlled by Sky Core, but will be transitioned to Spark in the future. This handoff is estimated for September 17, 2025.",
    );
    const entityMap = new Map([
      ["sky-core", entity("sky-core", "Sky Core", "operational_party")],
      ["spark", entity("spark", "Spark")],
    ]);
    const { result, edges } = run([d], entityMap);
    expect(result).toEqual({ count: 1, warnings: 0 });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromId: "d1",
      fromType: "doc",
      toId: "spark",
      toType: "entity",
      edgeType: "pending_transition",
      sourceDocNos: ["A.6.1.1.1.3.2.1.2.1"],
    });
    expect(JSON.parse(edges[0].meta)).toEqual({ current_holder: "Sky Core", est_date: "September 17, 2025" });
  });

  it("resolves an 'X Governance' holder to the underlying agent entity", () => {
    // A.3.3.2.7.2.1 "Andromeda" shape (real atlas phrasing, trimmed).
    const d = doc(
      "d2",
      "A.3.3.2.7.2.1",
      "Andromeda",
      "Control of the Andromeda RWA Arranged Structure is currently being transitioned to Grove Governance.",
    );
    const entityMap = new Map([["grove", entity("grove", "Grove")]]);
    const { result, edges } = run([d], entityMap);
    expect(result.count).toBe(1);
    expect(edges[0].toId).toBe("grove");
  });

  it("silently skips a resolvable-looking but denylisted handoff target (Endgame)", () => {
    const d = doc(
      "d3",
      "A.1.14.6.1",
      "Endgame Transition Note",
      "The operational process eventually leads to a transition to Endgame in later phases.",
    );
    const { result, edges } = run([d], new Map());
    expect(result).toEqual({ count: 0, warnings: 0 });
    expect(edges).toEqual([]);
  });

  it("warns (never silently drops) an operational-looking handoff whose target doesn't resolve", () => {
    const d = doc(
      "d4",
      "A.6.1.1.9.3.2.5",
      "Widget Ownership",
      "Operational control of the Widget Registry will transition to Foobar Corp once onboarding completes.",
    );
    const { result, edges } = run([d], new Map());
    expect(result).toEqual({ count: 0, warnings: 1 });
    expect(edges).toEqual([]);
  });

  it("skips a doc with no control-ish keyword even when a transition-to clause is present", () => {
    const d = doc(
      "d5",
      "A.1.14.6.2",
      "Naming Convention Update",
      "The naming convention will transition to Spark next release.",
    );
    const entityMap = new Map([["spark", entity("spark", "Spark")]]);
    const { result, edges } = run([d], entityMap);
    expect(result).toEqual({ count: 0, warnings: 0 });
    expect(edges).toEqual([]);
  });

  it("emits a null meta when neither a current-holder nor an estimated-date sentence is present", () => {
    const d = doc(
      "d6",
      "A.6.1.1.2.3.4.9",
      "Widget Control",
      "The control of the Widget Program will transition to Grove.",
    );
    const entityMap = new Map([["grove", entity("grove", "Grove")]]);
    const { result, edges } = run([d], entityMap);
    expect(result.count).toBe(1);
    expect(edges[0].meta).toBeNull();
  });

  it("resolves the target using the first matching clause even when an earlier resolvable directory-style intro precedes it", () => {
    // Mirrors the SparkLend shape noted in the source comment: a doc may
    // open with directory-style prose and still carry a real transition.
    const d = doc(
      "d7",
      "A.6.1.1.1.3.2.1",
      "SparkLend",
      "The documents herein define the parameters and operational processes related to SparkLend. Control of SparkLend is being transitioned to Spark.",
    );
    const entityMap = new Map([["spark", entity("spark", "Spark")]]);
    const { result, edges } = run([d], entityMap);
    expect(result.count).toBe(1);
    expect(edges[0].toId).toBe("spark");
  });
});
