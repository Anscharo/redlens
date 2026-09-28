import { describe, it, expect } from "vitest";
import { toChatMsgs } from "./hydrate";
import type { StoredMessage } from "../../lib/conversationsApi";
import type { VerifyState } from "./chatTypes";
import type { AnswerCoverage } from "./api";

describe("toChatMsgs", () => {
  it("maps tool_calls into a full trace + sources", () => {
    const rows: StoredMessage[] = [
      {
        role: "assistant",
        content: "The answer is 42.",
        createdAt: "2026-01-01T00:00:00.000Z",
        toolCalls: [{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128 }],
        citationMarks: null,
        verify: null,
        answerCoverage: null,
      },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.trace).toEqual([{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128, round: 0 }]);
    expect(msg.sources).toEqual([{ name: "atlas_search", args: { q: "foo" }, ok: true, bytes: 128 }]);
  });

  it("maps a null toolCalls to an empty trace and sources", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.trace).toEqual([]);
    expect(msg.sources).toEqual([]);
  });

  it("marks every restored message done, with rounds 0 and no answer-coverage line", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "hi", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const msgs = toChatMsgs(rows);
    for (const m of msgs) {
      expect(m.done).toBe(true);
      expect(m.rounds).toBe(0);
      // These rows carry no answer_coverage row, so nothing is restored —
      // absent means "never ruled", not "answered". The restoring case is
      // asserted separately below.
      expect(m.answerCoverage).toBeUndefined();
    }
  });

  it("restores as the reveal state: empty draft, generated true", () => {
    const rows: StoredMessage[] = [
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.draft).toBe("");
    expect(msg.generated).toBe(true);
  });

  it("preserves role/content and produces one ChatMsg per row, in order", () => {
    const rows: StoredMessage[] = [
      { role: "user", content: "first", createdAt: "t1", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
      { role: "assistant", content: "second", createdAt: "t2", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const msgs = toChatMsgs(rows);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "first"],
      ["assistant", "second"],
    ]);
  });

  it("restores citationMarks from a persisted row", () => {
    const rows: StoredMessage[] = [
      {
        role: "assistant",
        content: "The threshold is 7 signers.",
        createdAt: "t",
        toolCalls: null,
        citationMarks: {
          "11111111-1111-1111-1111-111111111111": {
            status: "backed",
            claims: [{ claim: "The threshold is 7 signers.", verdict: "supports" }],
          },
        },
        verify: null,
        answerCoverage: null,
      },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.citationMarks).toEqual({
      "11111111-1111-1111-1111-111111111111": {
        status: "backed",
        claims: [{ claim: "The threshold is 7 signers.", verdict: "supports" }],
      },
    });
  });

  it("maps a null citationMarks (no row, or nothing survived aggregation) to undefined", () => {
    const rows: StoredMessage[] = [
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.citationMarks).toBeUndefined();
  });

  it("restores verify from a persisted row", () => {
    const verify: VerifyState = {
      status: "fail",
      contradictions: [{ answer: "The fee is 10 bps.", evidence: "The fee is 8 bps.", why: "fee mismatch", uuid: "doc-c" }],
      rulingIssued: false,
      invalidCitations: [],
      invalidDocNos: [],
      docNoMismatches: [],
      ungroundedQuotes: [],
      ungroundedAddresses: [],
      ungroundedCitationValues: [],
      paramMismatches: [],
      completenessFailures: [],
      missingExternalDisclaimer: false,
      mscCitedAsAtlas: [],
      lengthCapped: false,
    };
    const rows: StoredMessage[] = [
      { role: "assistant", content: "The fee is 10 bps.", createdAt: "t", toolCalls: null, citationMarks: null, verify, answerCoverage: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.verify).toEqual(verify);
  });

  it("maps a null verify (no row, or the row didn't parse) to undefined", () => {
    const rows: StoredMessage[] = [
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.verify).toBeUndefined();
  });

  // The stored answer_coverage payload keeps `parts` as { text, p } objects
  // for calibration; the live wire has only ever sent their text. The server
  // maps them down, so the client shape is identical either way — a naive
  // pass-through would hand the renderer objects where it expects strings.
  it("restores answerCoverage from a persisted row", () => {
    const coverage: AnswerCoverage = { verdict: "answers", missingParts: ["when it takes effect"], parts: ["what is the fee", "when it takes effect"] };
    const rows: StoredMessage[] = [
      { role: "assistant", content: "The fee is 10 bps.", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: coverage },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.answerCoverage).toEqual(coverage);
    expect(msg.answerCoverage?.parts?.every((p) => typeof p === "string")).toBe(true);
  });

  it("maps a null answerCoverage (no row, or the row didn't parse) to undefined", () => {
    const rows: StoredMessage[] = [
      { role: "assistant", content: "hello", createdAt: "t", toolCalls: null, citationMarks: null, verify: null, answerCoverage: null },
    ];
    const [msg] = toChatMsgs(rows);
    expect(msg.answerCoverage).toBeUndefined();
  });
});
