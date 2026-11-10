// A key the chain set after the atlas last wrote its value: who set it, from
// the PAU history, and the open atlas pull request that names that spell.
import { describe, expect, it } from "vitest";
import { check, ctx, edit, exec, poll, spellEntry } from "./pauPending.fixture.ts";
import { chainLedStep, recordingPr, type OpenAtlasPr } from "./pauChainLed.ts";
import { onchainStep } from "./pauPending.ts";

const setBy = (kind: "spell" | "operator", date: string | null) => {
  const e = spellEntry("0xspell", "2026-11-10", "0xk");
  return { ...e, tx: "0xset", origin: { ...e.origin!, kind }, executive: date ? { title: `Executive ${date}`, date, url: `https://vote/${date}`, source: "vote-record" as const } : null };
};
const pr = (number: number, title: string, body = ""): OpenAtlasPr => ({ number, title, url: `https://github.com/pr/${number}`, body, updatedAt: "2026-11-11T00:00:00Z" });

describe("chainLedStep", () => {
  it("is the atlas update an open PR holds when it names the spell that set the key", () => {
    const pau = { entries: [setBy("spell", "2026-11-05")], queued: [] };
    const step = chainLedStep(check("mismatch", "2026-11-10"), [], ctx("2026-11-12", { pau, openPrs: [pr(380, "2026-11-19 Spell Updates"), pr(381, "2026-11-05 Spell Updates")] }));
    expect(step).toEqual({ kind: "recording", change: { chain: "base", tx: "0xset", setOn: "2026-11-10", by: { kind: "spell", spell: { title: "Executive 2026-11-05", date: "2026-11-05", url: "https://vote/2026-11-05" } } }, pr: { number: 381, title: "2026-11-05 Spell Updates", url: "https://github.com/pr/381" } });
  });
  it("names a merged PR that records the spell and edited the document without the value", () => {
    const pau = { entries: [setBy("spell", "2026-11-05")], queued: [] };
    const entries = [edit("2026-11-12", ["2026-11-05"], [["+", "an unrelated line"]]), edit("2026-11-01", ["2026-11-05"])];
    expect(chainLedStep(check("mismatch", "2026-11-10"), entries, ctx("2026-11-20", { pau }))).toMatchObject({ kind: "unrecorded", missedBy: { pr: 363, date: "2026-11-12" } });
  });
  it("says the atlas has not recorded it otherwise, naming who set it", () => {
    expect(chainLedStep(check("mismatch", "2026-11-10"), [], ctx("2026-11-12", { pau: { entries: [setBy("operator", null)], queued: [] } }))).toMatchObject({ kind: "unrecorded", change: { by: { kind: "operator" } } });
    expect(chainLedStep(check("mismatch", "2026-11-10"), [], ctx("2026-11-12"))).toMatchObject({ kind: "unrecorded", change: { by: { kind: "other" } } });
  });
  it("is what onchainStep says when the chain moved after the atlas wrote the value, even with no exact writing change", () => {
    const pau = { entries: [setBy("spell", "2026-11-05")], queued: [] };
    expect(onchainStep(check("mismatch", "2026-11-10"), [edit("2026-10-01", [], [["+", "unrelated"]])], ctx("2026-11-12", { pau }))?.kind).toBe("unrecorded");
  });
});

describe("recordingPr", () => {
  it("reads a year-less reference against the PR's own date", () => {
    expect(recordingPr([pr(355, "November 5 spell changes")], "2026-11-05", ctx("2026-11-12"))?.number).toBe(355);
    expect(recordingPr([pr(356, "Grove proposal", "https://forum.skyeco.com/t/november-5-2026-proposed-changes-to-grove-for-upcoming-spell/1")], "2026-11-05", ctx("2026-11-12"))).toBeNull();
  });
  it("finds an open PR whose Prime poll the spell's executive carries", () => {
    const links = { pollsByPr: new Map([[356, [poll("0xp", { prs: [356] })]]]), snapshots: new Map([["0xp", [exec("2026-11-05", true, "2026-11-07")]]]) };
    expect(recordingPr([pr(356, "Grove proposal")], "2026-11-05", ctx("2026-11-12", links))?.number).toBe(356);
  });
});
