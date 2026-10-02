import { describe, expect, it } from "bun:test";
import { attachRecall, isRecallToolId, recalledToolContents } from "./tool-recall.ts";

const searchResult = JSON.stringify({
  count: 1,
  results: [
    { id: "11111111-1111-1111-1111-111111111111", doc_no: "A.1.2", title: "Freezer", type: "Article", snippet: "The freezer pauses the protocol." },
  ],
});

describe("attachRecall", () => {
  it("skips synthetic prefetch and review-note tool messages and mints a stable id", () => {
    const transcript = [
      { role: "tool", tool_call_id: "call_prefetch", content: "{\"facts\":true}" },
      { role: "tool", tool_call_id: "call_review_notes", content: "{\"review\":true}" },
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

describe("isRecallToolId", () => {
  it("recognizes both id shapes and nothing a provider mints", () => {
    expect(isRecallToolId("rcall_0f2c1a3e-4f5b-4c6d-8e9f-0a1b2c3d4e5f")).toBe(true);
    expect(isRecallToolId("rcall0123456789abcdef0123")).toBe(true);
    expect(isRecallToolId("call_abc123")).toBe(false);
    // A tool message with no id must not throw on the verifier's hot path.
    expect(isRecallToolId(undefined)).toBe(false);
    expect(isRecallToolId(null)).toBe(false);
  });
});
