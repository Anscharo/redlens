import { describe, expect, it } from "bun:test";
import type OpenAI from "openai";
import { docProvenance } from "./provenance.ts";
import type { Indexes } from "../../retrieval/indexes.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const DOC = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const C = "44444444-4444-4444-8444-444444444444";
const ENTITY_ONLY = "55555555-5555-4555-8555-555555555555"; // not in docMap

const node = (id: string, title: string) => ({ id, title, content: "", parentId: null, doc_no: "A.1", type: "Core", depth: 1, order: 0, addressRefs: [] }) as any;

const ix = {
  docMap: new Map([
    [DOC, node(DOC, "Doc")],
    [PARENT, node(PARENT, "Parent")],
    [B, node(B, "Rate Limits")],
    [C, node(C, "History")],
  ]),
} as unknown as Indexes;

// Mirrors verifier.ts's evidenceFromTranscript pairing shape: an assistant
// tool_calls entry followed by its role:"tool" result.
function toolTurn(tool: string, content: string, id = "c1"): Msg[] {
  return [
    { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: tool, arguments: "{}" } }] },
    { role: "tool", tool_call_id: id, content },
  ];
}

describe("docProvenance", () => {
  it("atlas_get: the node's own uuid is content; parentId and ancestors[].id are identity", () => {
    const result = {
      id: DOC, doc_no: "A.1", title: "Doc", content: "Doc body text.",
      parentId: PARENT,
      ancestors: [{ id: PARENT, doc_no: "A", title: "Parent" }],
    };
    const out = docProvenance(toolTurn("atlas_get", JSON.stringify(result)), ix);
    expect(out.get(DOC)).toMatchObject({ kind: "content", tool: "atlas_get" });
    expect(out.get(PARENT)).toMatchObject({ kind: "identity", tool: "atlas_get" });
  });

  it("atlas_search: a snippet is text a claim can be sourced from — content", () => {
    const result = { count: 1, results: [{ id: DOC, doc_no: "A.1", title: "Doc", snippet: "Doc body…", score: 0.9 }] };
    const out = docProvenance(toolTurn("atlas_search", JSON.stringify(result)), ix);
    expect(out.get(DOC)).toMatchObject({ kind: "content", tool: "atlas_search" });
  });

  it("atlas_filter default (no include_content): identity", () => {
    const result = { total: 1, results: [{ id: DOC, doc_no: "A.1", title: "Doc", type: "Core", parent_id: PARENT }] };
    const out = docProvenance(toolTurn("atlas_filter", JSON.stringify(result)), ix);
    expect(out.get(DOC)).toMatchObject({ kind: "identity" });
    expect(out.get(PARENT)).toMatchObject({ kind: "identity" });
  });

  it("atlas_filter with include_content: the row's own id is content, parent_id stays identity", () => {
    const result = { total: 1, results: [{ id: DOC, doc_no: "A.1", title: "Doc", type: "Core", parent_id: PARENT, content: "Doc body text." }] };
    const out = docProvenance(toolTurn("atlas_filter", JSON.stringify(result)), ix);
    expect(out.get(DOC)).toMatchObject({ kind: "content" });
    expect(out.get(PARENT)).toMatchObject({ kind: "identity" });
  });

  it("atlas_recent_changes: identity — summary is commit prose, not a text-bearing key", () => {
    const result = {
      since: "2026-01-01",
      count: 1,
      events: [{ doc_id: DOC, committed_at: "2026-09-01", change_type: "content", pr_number: 42, pr_title: "Bump", summary: "Changed the body text." }],
    };
    const out = docProvenance(toolTurn("atlas_recent_changes", JSON.stringify(result)), ix);
    expect(out.get(DOC)).toMatchObject({ kind: "identity", tool: "atlas_recent_changes" });
  });

  it("a bare uuid array element (ancestor_ids[], a params tuple) is identity, never inherits a sibling text key", () => {
    const result = { id: DOC, content: "Doc body text.", ancestor_ids: [PARENT], params: { rate: ["address", B] } };
    const out = docProvenance(toolTurn("atlas_get", JSON.stringify(result)), ix);
    expect(out.get(DOC)).toMatchObject({ kind: "content" });
    expect(out.get(PARENT)).toMatchObject({ kind: "identity" });
    expect(out.get(B)).toMatchObject({ kind: "identity" });
  });

  it("an entity id absent from ix.docMap gets no entry at all, even with a text-bearing sibling", () => {
    const result = { id: ENTITY_ONLY, name: "Spark Protocol", content: "Some entity description text." };
    const out = docProvenance(toolTurn("atlas_entities", JSON.stringify(result)), ix);
    expect(out.has(ENTITY_ONLY)).toBe(false);
  });

  it("content beats identity when the same uuid appears both ways in one turn — identity first, content later", () => {
    const identityFirst = { id: DOC, doc_no: "A.1", title: "Doc", parent_id: PARENT };
    const contentLater = { id: PARENT, doc_no: "A", title: "Parent", content: "Parent body text." };
    const transcript = [...toolTurn("atlas_filter", JSON.stringify(identityFirst), "c1"), ...toolTurn("atlas_get", JSON.stringify(contentLater), "c2")];
    const out = docProvenance(transcript, ix);
    expect(out.get(PARENT)).toMatchObject({ kind: "content" });
  });

  it("content beats identity regardless of order — content first, identity later", () => {
    const contentFirst = { id: PARENT, doc_no: "A", title: "Parent", content: "Parent body text." };
    const identityLater = { id: DOC, doc_no: "A.1", title: "Doc", parent_id: PARENT };
    const transcript = [...toolTurn("atlas_get", JSON.stringify(contentFirst), "c1"), ...toolTurn("atlas_filter", JSON.stringify(identityLater), "c2")];
    const out = docProvenance(transcript, ix);
    expect(out.get(PARENT)).toMatchObject({ kind: "content" });
  });

  it("a truncated chat-transport envelope parses fine — preview_json's blob is never scanned for embedded content", () => {
    // applyChatToolBudget (llm-tools.ts) slices a raw JSON string mid-value into
    // preview_json. The envelope itself parses (preview_json is just a string),
    // but preview_json's TEXT is never recursed into — it is one flat string
    // value, compared whole against the uuid pattern, so a uuid embedded inside
    // it (complete or cut) never matches and is never falsely read as content.
    const previewJson = `{"results":[{"id":"${DOC}","doc_no":"A.1","title":"Doc","content":"abc`; // deliberately unterminated
    const envelope = JSON.stringify({ truncated: true, original_chars: 9999, returned_chars: 0, hint: "…", preview_json: previewJson });
    const out = docProvenance(toolTurn("atlas_get", envelope), ix);
    expect(out.size).toBe(0);
  });

  it("unparseable tool content contributes nothing and never throws", () => {
    expect(() => docProvenance(toolTurn("atlas_get", "{not json"), ix)).not.toThrow();
    expect(docProvenance(toolTurn("atlas_get", "{not json"), ix).size).toBe(0);
  });

  it("empty transcript → empty map", () => {
    expect(docProvenance([], ix).size).toBe(0);
  });
});
