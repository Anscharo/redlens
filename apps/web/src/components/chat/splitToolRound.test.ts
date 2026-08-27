import { describe, expect, it } from "vitest";
import { appendReasoning, looksLikeToolCallLine, splitToolRoundText } from "./splitToolRound";

describe("looksLikeToolCallLine", () => {
  it("catches XML tags, truncated tags, and a one-line JSON payload", () => {
    expect(looksLikeToolCallLine("<tool_call>")).toBe(true);
    expect(looksLikeToolCallLine("</tool_call>")).toBe(true);
    expect(looksLikeToolCallLine("ool_call>")).toBe(true);
    expect(looksLikeToolCallLine('<invoke name="atlas_query">')).toBe(true);
    expect(looksLikeToolCallLine('{"name":"atlas_query","arguments":{}}')).toBe(true);
    expect(looksLikeToolCallLine('  "name": "atlas_search",')).toBe(true);
    expect(looksLikeToolCallLine('  "arguments": {')).toBe(true);
    expect(looksLikeToolCallLine("```tool_call")).toBe(true);
  });

  it("does not treat a sentence that merely names a tool as a call", () => {
    expect(looksLikeToolCallLine("I will use atlas_query to search the Atlas.")).toBe(false);
    expect(looksLikeToolCallLine("The `atlas_get` tool fetches a document.")).toBe(false);
    expect(looksLikeToolCallLine("- `name`: Spark")).toBe(false);
  });
});

describe("splitToolRoundText", () => {
  it("moves leaked markup to thinking and keeps the preamble as a draft", () => {
    const { thinking, draft } = splitToolRoundText(
      "Let me look that up.\n<tool_call>\n{\"name\":\"atlas_query\",\"arguments\":{}}\n</tool_call>",
    );
    expect(draft).toBe("Let me look that up.");
    expect(thinking).toContain("<tool_call>");
    expect(thinking).toContain('"name":"atlas_query"');
  });

  it("keeps no draft when the whole buffer is a leak", () => {
    const { thinking, draft } = splitToolRoundText("ool_call>");
    expect(draft).toBe("");
    expect(thinking).toBe("ool_call>");
  });

  it("keeps a prose-only buffer as a draft with no thinking", () => {
    const { thinking, draft } = splitToolRoundText("A threshold of **7 signers** applies.");
    expect(draft).toBe("A threshold of **7 signers** applies.");
    expect(thinking).toBe("");
  });
});

describe("appendReasoning", () => {
  it("starts a new trace or appends on a new line", () => {
    expect(appendReasoning(undefined, " first ")).toBe("first");
    expect(appendReasoning("already thinking", "ool_call>")).toBe("already thinking\nool_call>");
  });
});
