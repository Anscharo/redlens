import { describe, expect, it } from "bun:test";
import { attachRecall, recalledToolContents, toolRecall } from "./tool-recall.ts";

const searchResult = JSON.stringify({
  count: 2,
  results: [
    { id: "11111111-1111-1111-1111-111111111111", doc_no: "A.1.2", title: "Freezer", type: "Article", snippet: "The freezer pauses the protocol." },
    { id: "22222222-2222-2222-2222-222222222222", doc_no: "A.1.3", title: "Spell", type: "Section", snippet: "x".repeat(500) },
  ],
});

describe("toolRecall", () => {
  it("keeps handles and a short excerpt, and tells the model to re-fetch before quoting", () => {
    const card = toolRecall("atlas_search", { query: "freezer" }, searchResult, true);
    expect(card).toContain("atlas_search(");
    expect(card).toContain("query");
    expect(card).toContain("id=11111111-1111-1111-1111-111111111111");
    expect(card).toContain("doc_no=A.1.2");
    expect(card).toContain("title=Freezer");
    expect(card).toContain("The freezer pauses the protocol.");
    expect(card).toContain("Re-call atlas_search for the full result before quoting it.");
    expect(card.length).toBeLessThanOrEqual(1_800);
    expect(card).not.toContain("x".repeat(400));
  });

  it("is deterministic", () => {
    const a = toolRecall("atlas_get", { id: "abc" }, searchResult, true);
    const b = toolRecall("atlas_get", { id: "abc" }, searchResult, true);
    expect(a).toBe(b);
  });

  it("keeps the re-call line when the extract itself is over the cap", () => {
    const huge = JSON.stringify({
      results: Array.from({ length: 12 }, (_, i) => ({
        id: `${i}`.padEnd(36, "a"),
        title: "Title",
        snippet: "s".repeat(280),
      })),
    });
    const card = toolRecall("atlas_search", { query: "q" }, huge, true);
    expect(card.length).toBeLessThanOrEqual(1_800);
    expect(card.endsWith("Re-call atlas_search for the full result before quoting it.")).toBe(true);
    expect(card).toContain("\n- ");
  });

  it("records the fetched document, not its ancestor breadcrumb", () => {
    const raw = JSON.stringify({
      id: "f3063596-4f85-4a51-b52c-58221d043d3e",
      doc_no: "A.6.1.1.1.2.6.1.3.1.5.1",
      title: "Ethereum Mainnet - Morpho USDC Instance Configuration Document",
      type: "Core",
      content: "The documents herein contain the Instance Configuration Document for the Morpho USDC Instance.",
      ancestors: [
        { id: "dee2f5a4-279a-488c-9a9d-9583e3216fbf", doc_no: "A.6.1.1.1", title: "Spark", type: "Core" },
        { id: "4a08ca6c-e652-49e4-9b79-4831b20e600a", doc_no: "A.6", title: "The Agent Scope", type: "Scope" },
      ],
    });
    const card = toolRecall("atlas_get", { id: "f3063596-4f85-4a51-b52c-58221d043d3e" }, raw, true);
    expect(card).toContain("id=f3063596-4f85-4a51-b52c-58221d043d3e");
    expect(card).toContain("Morpho USDC");
    expect(card).not.toContain("The Agent Scope");
  });

  it("lists a neighbor target and its siblings when children is an empty array", () => {
    const raw = JSON.stringify({
      target: { id: "325731dc-5e89-4a8a-9d64-91b203febf48", doc_no: "A.6.1.1.7.2.6.1.2.1.1.2.2", title: "Diamond PAU Rate Limits", type: "Core", depth: 12 },
      parent: { id: "parent-1", doc_no: "A.6.1.1.7", title: "Sky Primitives", type: "Core", depth: 4 },
      siblings: [
        { id: "sib-1", doc_no: "A.6.1.1.7.2.1", title: "Genesis Primitives", type: "Core", depth: 5 },
      ],
      children: [],
      liveness_hint: "liveness:scaffold = an empty container",
    });
    const card = toolRecall("atlas_neighbors", { id: "A.6.1.1.7.2.6.1.2.1.1.2.2", window: 8 }, raw, true);
    expect(card).toContain("title=Diamond PAU Rate Limits");
    expect(card).toContain("title=Genesis Primitives");
    expect(card).toContain("liveness:scaffold");
  });

  it("drops empty tool arguments from the card head", () => {
    const card = toolRecall("atlas_query", { query: "Morpho", entity: "", edge_types: [], include_params: false, k: 20 }, '{"count":0}', true);
    expect(card).toContain('"query":"Morpho"');
    expect(card).toContain('"k":20');
    expect(card).not.toContain("edge_types");
    expect(card).not.toContain("include_params");
  });

  it("keeps a failed call to a short error line", () => {
    const card = toolRecall("atlas_get", { id: "missing" }, JSON.stringify({ error: "Not found" }), false);
    expect(card).toContain("failed");
    expect(card).toContain("Not found");
    expect(card).not.toContain("Re-call");
  });
});

describe("attachRecall", () => {
  it("skips synthetic prefetch and dispute tool messages and mints a stable id", () => {
    const transcript = [
      { role: "tool", tool_call_id: "call_prefetch", content: "{\"facts\":true}" },
      { role: "tool", tool_call_id: "call_dispute_flags", content: "{\"dispute\":true}" },
      { role: "tool", tool_call_id: "call_abc", content: searchResult },
    ];
    expect(recalledToolContents(transcript)).toEqual([searchResult]);
    const [card] = attachRecall(
      [{ name: "atlas_search", args: { query: "freezer" }, ok: true, bytes: searchResult.length }],
      transcript,
    );
    expect(card.recall_id).toMatch(/^rcall[0-9a-f]{20}$/);
    expect(card.recall).toContain("title=Freezer");
    const again = attachRecall([card], transcript);
    expect(again[0].recall_id).toBe(card.recall_id);
    expect(again[0].recall).toBe(card.recall);
  });
});
