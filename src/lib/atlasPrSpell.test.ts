// The spells a PR names: the forum thread for the upcoming spell, an ISO or
// written date beside "spell" (a list too), never a date beside "Executive
// Vote" alone, the body skipped when it is a list of edits, and a year-less
// reference given the year nearest the edit.
import { describe, expect, it } from "vitest";
import { isThreadRef, prSpellRefs, resolveSpellRefs, spellRefs, threadSpellDate } from "./atlasPrSpell.ts";

describe("spellRefs", () => {
  it("keeps the forum thread a Prime proposal links as the thread's date, not the PR's spell", () => {
    expect(spellRefs("Originating forum post: https://forum.skyeco.com/t/september-24-2026-proposed-changes-to-grove-for-upcoming-spell/28229/2")).toEqual(["thread:2026-09-24"]);
    expect(isThreadRef("thread:2026-09-24")).toBe(true);
    expect(threadSpellDate("https://forum.skyeco.com/t/november-5-2026-proposed-changes-to-grove-for-upcoming-spell/28336/2")).toBe("2026-11-05");
    expect(threadSpellDate("https://forum.skyeco.com/t/technical-scope-morpho-vault-timelock-compliance/28302")).toBeNull();
  });
  it("reads ISO and written dates beside the word spell, and lists of them", () => {
    expect(spellRefs("2026-11-05 Spell Updates")).toEqual(["2026-11-05"]);
    expect(spellRefs("do not merge until 2026-10-08 spell has executed")).toEqual(["2026-10-08"]);
    expect(spellRefs("Update Osero Artifact For September 24, 2026 Spell")).toEqual(["2026-09-24"]);
    expect(spellRefs("October 8 spell changes")).toEqual(["--10-08"]);
    expect(spellRefs("Grove Artifact update (July 6, August 17 spell changes)")).toEqual(["--07-06", "--08-17"]);
  });
  it("does not take a date beside Executive Vote alone, or a technical-scope thread", () => {
    expect(spellRefs("noncompliant vaults carry a 100% CRR after the October 8, 2026 Executive Vote")).toEqual([]);
    expect(spellRefs("https://forum.skyeco.com/t/technical-scope-morpho-vault-timelock-compliance/28302")).toEqual([]);
  });
});

describe("prSpellRefs", () => {
  it("reads the title, and the body only when it is not a list of edits", () => {
    expect(prSpellRefs("Grove proposal - Raise the limit", "Originating forum post: https://forum.skyeco.com/t/november-5-2026-proposed-changes-to-grove-for-upcoming-spell/1")).toEqual(["thread:2026-11-05"]);
    expect(prSpellRefs("Atlas Edit Proposal — 2026-09-14", "- **Update Osero Artifact For September 24, 2026 Spell** - Updates")).toEqual([]);
  });
});

describe("resolveSpellRefs", () => {
  it("gives a year-less reference the year nearest the edit", () => {
    expect(resolveSpellRefs(["--01-08", "2026-10-08", "--10-08", "thread:2026-11-05"], "2025-12-30")).toEqual(["2026-01-08", "2026-10-08", "2025-10-08", "thread:2026-11-05"]);
  });
});
