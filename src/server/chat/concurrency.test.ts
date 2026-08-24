// Per-user in-flight chat slot counter. Pure in-memory state, no DB/session
// fixture needed — mirrors sse.ts's client-registry test style.
import { describe, expect, it } from "bun:test";
import { tryAcquireChatSlot, releaseChatSlot, inFlightChatCount } from "./concurrency.ts";

// Every test uses its own userId so state from one test can never leak into
// another via the shared module-level Map — no reset hook needed.
let n = 0;
function uid() {
  return `concurrency-test-user-${n++}`;
}

describe("tryAcquireChatSlot / releaseChatSlot", () => {
  it("succeeds while under the limit, incrementing the count each time", () => {
    const u = uid();
    expect(tryAcquireChatSlot(u, 3)).toBe(true);
    expect(inFlightChatCount(u)).toBe(1);
    expect(tryAcquireChatSlot(u, 3)).toBe(true);
    expect(inFlightChatCount(u)).toBe(2);
    expect(tryAcquireChatSlot(u, 3)).toBe(true);
    expect(inFlightChatCount(u)).toBe(3);
  });

  it("fails once the caller is at the limit, without incrementing further", () => {
    const u = uid();
    for (let i = 0; i < 3; i++) expect(tryAcquireChatSlot(u, 3)).toBe(true);
    expect(tryAcquireChatSlot(u, 3)).toBe(false);
    expect(inFlightChatCount(u)).toBe(3); // unchanged by the rejected attempt
  });

  it("a release frees exactly one slot, letting a subsequent acquire succeed", () => {
    const u = uid();
    for (let i = 0; i < 3; i++) tryAcquireChatSlot(u, 3);
    expect(tryAcquireChatSlot(u, 3)).toBe(false);
    releaseChatSlot(u);
    expect(inFlightChatCount(u)).toBe(2);
    expect(tryAcquireChatSlot(u, 3)).toBe(true);
  });

  it("releasing back to zero removes the user from the map (count reads back as 0, not negative)", () => {
    const u = uid();
    tryAcquireChatSlot(u, 3);
    releaseChatSlot(u);
    expect(inFlightChatCount(u)).toBe(0);
    releaseChatSlot(u); // defensive: a stray extra release must not go negative
    expect(inFlightChatCount(u)).toBe(0);
  });

  it("different users have fully independent limits", () => {
    const a = uid();
    const b = uid();
    for (let i = 0; i < 3; i++) expect(tryAcquireChatSlot(a, 3)).toBe(true);
    expect(tryAcquireChatSlot(a, 3)).toBe(false);
    // b is untouched by a being maxed out
    expect(tryAcquireChatSlot(b, 3)).toBe(true);
    expect(inFlightChatCount(b)).toBe(1);
  });

  it("a limit of 0 rejects immediately (no slots ever available)", () => {
    const u = uid();
    expect(tryAcquireChatSlot(u, 0)).toBe(false);
    expect(inFlightChatCount(u)).toBe(0);
  });
});
