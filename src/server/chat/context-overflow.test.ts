import { describe, expect, it } from "bun:test";
import {
  clearContextOverflow,
  contextOverflowMessage,
  contextOverflowPending,
  foldIsSpent,
  isContextOverflowError,
  markContextOverflow,
  markFoldSpent,
} from "./context-overflow.ts";

describe("isContextOverflowError", () => {
  it("recognizes the wordings providers actually return", () => {
    // OpenAI, via the SDK's nested error body.
    expect(isContextOverflowError({
      status: 400,
      error: { code: "context_length_exceeded", message: "This model's maximum context length is 128000 tokens." },
    })).toBe(true);
    // Anthropic, passed through by OpenRouter.
    expect(isContextOverflowError(new Error("prompt is too long: 214000 tokens > 200000 maximum"))).toBe(true);
    // OpenRouter's own endpoint message.
    expect(isContextOverflowError(new Error("This endpoint's maximum context length is 131072 tokens. However, you requested about 140000 tokens."))).toBe(true);
    expect(isContextOverflowError(new Error("Please reduce the length of the messages."))).toBe(true);
    expect(isContextOverflowError("Request too large for gpt-5.6-luna")).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isContextOverflowError(new Error("llm call timeout"))).toBe(false);
    expect(isContextOverflowError(new Error("rate limit exceeded"))).toBe(false);
    // An OUTPUT-token complaint is not a thread that needs folding.
    expect(isContextOverflowError(new Error("max_tokens is too large: 200000 > 32768"))).toBe(false);
    expect(isContextOverflowError(new Error("Please reduce the number of completions"))).toBe(false);
    expect(isContextOverflowError({ error: "upstream provider is down" })).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
    expect(isContextOverflowError({})).toBe(false);
  });
});

describe("the overflow flag", () => {
  it("is raised for the conversation and cleared by a fold", () => {
    const conv = "conv-overflow-flag";
    expect(contextOverflowPending(conv)).toBe(false);
    markContextOverflow(conv);
    expect(contextOverflowPending(conv)).toBe(true);
    clearContextOverflow(conv);
    expect(contextOverflowPending(conv)).toBe(false);
  });

  it("records a spent fold separately, and a landed fold clears both", () => {
    const conv = "conv-overflow-fold-spent";
    expect(foldIsSpent(conv)).toBe(false);
    markContextOverflow(conv);
    markFoldSpent(conv);
    // Both are up: the route reads this as "do not force another summary call".
    expect(contextOverflowPending(conv)).toBe(true);
    expect(foldIsSpent(conv)).toBe(true);
    clearContextOverflow(conv);
    expect(contextOverflowPending(conv)).toBe(false);
    expect(foldIsSpent(conv)).toBe(false);
  });

  it("does not leak across conversations and expires after a day", () => {
    const conv = "conv-overflow-expiry";
    markContextOverflow(conv, 0);
    expect(contextOverflowPending("conv-overflow-other", 0)).toBe(false);
    expect(contextOverflowPending(conv, 23 * 60 * 60_000)).toBe(true);
    expect(contextOverflowPending(conv, 25 * 60 * 60_000)).toBe(false);
  });
});

describe("contextOverflowMessage", () => {
  it("only promises a condensed retry when compaction is configured", () => {
    expect(contextOverflowMessage(true)).toContain("condensed first");
    expect(contextOverflowMessage(false)).toContain("new chat");
    expect(contextOverflowMessage(false)).not.toContain("condensed first");
  });

  it("flows into the client's fixed suffix: no trailing period, no retry advice of its own", () => {
    // ErrorNote renders `{message} — send another message to try again.`
    for (const message of [contextOverflowMessage(true), contextOverflowMessage(false)]) {
      expect(message.endsWith(".")).toBe(false);
      expect(message).not.toContain("try again");
    }
  });
});
