import { describe, expect, it } from "vitest";

import type { DateClaim, StaleDatesReport } from "../staleDates";
import type { VoteEvidence } from "./evidence";
import { evidenceHint, evidenceText, matchedVia, ruleDisagrees } from "./labels";
import { applyOverlay, claimKey, historyEvidence, judgePoll, judgeSubject, POLL_THRESHOLD } from "./overlay";

const MODEL = "typesafe/jev-1.13";
const executive = { kind: "executive" as const, title: "Exec", date: "2026-03-26", url: "https://vote.sky.money/executive/k", offsetDays: 0 };
const rule = (over: Partial<VoteEvidence> = {}): VoteEvidence => ({ status: "subject-missing", via: "date", vote: executive, subject: { found: ["genesis"], missing: ["osero"] }, ...over });
const poll = (date: string, title = `Poll ${date}`) => ({ title, date, url: `https://vote.sky.money/polling/${date}` });

describe("judgeSubject", () => {
  it("overrules a subject the rules could not find when the model says the executive carried it (the Osero case)", () => {
    const e = judgeSubject(rule(), true, { model: MODEL, anchor: 0.05, carried: 0.9 });
    expect(e).toMatchObject({ status: "enacted", via: "date", vote: executive, judged: { model: MODEL, p: 0.9, rule: "subject-missing" } });
    expect(ruleDisagrees(e)).toBe(true);
    expect(evidenceText(e)).toBe("executed · Executive Vote 2026-03-26 (+0d) · via AI");
    expect(evidenceHint(e)).toContain("The heuristic alone said: not included.");
    expect(evidenceHint(e)).toContain("Checked by an AI model (typesafe/jev-1.13, p 0.90).");
  });

  it("flags a wrong executive the rules passed, below the carried threshold", () => {
    const e = judgeSubject(rule({ status: "enacted" }), true, { model: MODEL, anchor: 0.05, carried: 0.2 });
    expect(e.status).toBe("subject-missing");
    expect(e.judged?.rule).toBe("enacted");
  });

  it("reads an anchor as a vote on the date, and an executive whose spell is not yet cast as pending", () => {
    expect(judgeSubject(rule({ status: "vote-on-date" }), true, { model: MODEL, anchor: 0.8, carried: 0.1 })).toMatchObject({ status: "vote-on-date", judged: { p: 0.8 } });
    expect(judgeSubject(rule({ status: "pending" }), false, { model: MODEL, anchor: 0.1, carried: 0.6 }).status).toBe("pending");
    const agreed = judgeSubject(rule({ status: "enacted" }), true, { model: MODEL, anchor: 0.1, carried: 0.6 });
    expect(ruleDisagrees(agreed)).toBe(false);
    expect(evidenceText(agreed)).toBe("executed · Executive Vote 2026-03-26 (+0d) · via AI");
    expect(evidenceHint(agreed)).not.toContain("heuristic alone");
    expect(matchedVia(agreed)).toBe("AI");
    expect(matchedVia(rule())).toBe("date");
    expect(matchedVia(rule({ via: "link" }))).toBe("link");
    expect(matchedVia(rule({ status: "unlinked", via: null, vote: null }))).toBeNull();
  });
});

describe("poll evidence for claims naming no executive", () => {
  const unlinked = rule({ status: "unlinked", via: null, vote: null, subject: null });

  it("credits the poll atlas history found", () => {
    const e = historyEvidence("2026-01-01", poll("2025-11-24"));
    expect(e).toMatchObject({ status: "authorised", via: "history", vote: { kind: "poll", offsetDays: -38 } });
    expect(matchedVia(e)).toBe("history");
    expect(evidenceText(e)).toBe("approved by poll · poll 2025-11-24 (−38d) · via history");
    expect(evidenceHint(e)).toContain("pull request");
  });

  it("takes the model's most probable poll at or above the threshold, else keeps the rules' verdict", () => {
    const scored = [{ poll: poll("2025-11-20"), p: 0.3 }, { poll: poll("2025-11-24"), p: 0.6 }, { poll: poll("2025-12-01"), p: null }];
    const e = judgePoll(unlinked, "2026-01-01", MODEL, scored);
    expect(e).toMatchObject({ status: "authorised", via: "judge", vote: { date: "2025-11-24" }, judged: { p: 0.6, rule: "unlinked" } });
    expect(evidenceHint(e)).toContain("AI model picked");
    expect(matchedVia(e)).toBe("AI");
    expect(judgePoll(unlinked, "2026-01-01", MODEL, [{ poll: poll("2025-11-24"), p: POLL_THRESHOLD - 0.01 }])).toBe(unlinked);
  });
});

describe("applyOverlay", () => {
  const claim = (docId: string, context: string): DateClaim =>
    ({ docId, dateISO: "2026-03-26", context, voteEvidence: rule() }) as unknown as DateClaim;

  it("keys a claim on its document, date and words, so a second mention or an edit stays apart", () => {
    expect(claimKey(claim("d", "a"))).toBe(claimKey(claim("d", "a")));
    expect(claimKey(claim("d", "a"))).not.toBe(claimKey(claim("d", "b")));
    expect(claimKey(claim("d", "a"))).toMatch(/^d@2026-03-26#[0-9a-f]{8}$/);
  });

  it("replaces the evidence of every claim the overlay holds and leaves the rest", () => {
    const judged = claim("d", "judged");
    const other = claim("d", "other");
    const report: StaleDatesReport = { stale: [], dueSoon: [], upcoming: [judged], recorded: [other], totalDateMentions: 2 };
    const verdict = judgeSubject(rule(), true, { model: MODEL, anchor: 0, carried: 0.9 });
    const out = applyOverlay(report, { atlasSha: "s", computedAt: "t", claims: { [claimKey(judged)]: verdict } });
    expect(out.upcoming[0].voteEvidence).toBe(verdict);
    expect(out.recorded[0]).toBe(other);
    expect(applyOverlay(report, null)).toBe(report);
  });
});
