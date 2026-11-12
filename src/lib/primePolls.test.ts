// A Snapshot proposal as a Prime poll: the PRs its body links, whether For
// carried it, its thread's spell date, and the off-spell items.
import { describe, expect, it } from "vitest";
import { offSpellPoll, pollsByPr, toPrimePoll, type SnapshotProposal } from "./primePolls.ts";

const proposal = (o: Partial<SnapshotProposal> = {}): SnapshotProposal => ({
  id: "0xABC", title: "[Base] Raise the deposit rate limit", space: { id: "grovefinance.eth" }, end: 1761696000, state: "closed",
  choices: ["For", "Against", "Abstain"], scores: [96251572, 0, 0],
  discussion: "https://forum.skyeco.com/t/november-5-2026-proposed-changes-to-grove-for-upcoming-spell/28336/2",
  body: "Proposal: [PR](https://github.com/sky-ecosystem/next-gen-atlas/pull/363) and again github.com/sky-ecosystem/next-gen-atlas/pull/363", ...o,
});

describe("toPrimePoll", () => {
  it("reads the linked PRs, the result and the thread's spell date", () => {
    expect(toPrimePoll(proposal())).toEqual({ id: "0xabc", space: "grovefinance.eth", title: "[Base] Raise the deposit rate limit", end: "2025-10-29", passed: true, threadDate: "2026-11-05", prs: [363] });
    expect(toPrimePoll(proposal({ scores: [1, 5, 0] })).passed).toBe(false);
    expect(toPrimePoll(proposal({ state: "active" })).passed).toBeNull();
    expect(toPrimePoll(proposal({ scores: [] })).passed).toBe(false);
    expect(toPrimePoll(proposal({ discussion: null })).threadDate).toBeNull();
  });
  it("indexes polls by PR and tells artifact and Sky Core items apart", () => {
    const p = toPrimePoll(proposal());
    expect(pollsByPr([p]).get(363)).toEqual([p]);
    expect(offSpellPoll({ ...p, title: "[Grove Artifact] Diamond PAU Rate Limits" })).toBe(true);
    expect(offSpellPoll({ ...p, title: "[Sky Core] Raise the auto-line ttl" })).toBe(true);
    expect(offSpellPoll(p)).toBe(false);
  });
});
