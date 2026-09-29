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
    expect(card.recall_id?.startsWith("rcall_")).toBe(true);
    expect(card.recall).toContain("title=Freezer");
    const again = attachRecall([card], transcript);
    expect(again[0].recall_id).toBe(card.recall_id);
    expect(again[0].recall).toBe(card.recall);
  });
});
