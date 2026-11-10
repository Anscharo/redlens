// A Prime PR's spell through its Snapshot poll: the executive linking the poll
// carries it (cast or not), an open poll waits, a failed one rejects it, an
// artifact item is off-spell, and a passed spell item no executive links is
// pending until its thread's spell is filed, then lapsed, naming that spell.
import { describe, expect, it } from "vitest";
import { check, ctx, edit, exec, poll } from "./pauPending.fixture.ts";
import { onchainStep } from "./pauPending.ts";
import { pollStep } from "./pauSpellStep.ts";

const base = { atlasChanged: "2026-10-29", pr: 363 };
const step = (p: ReturnType<typeof poll>, today: string, executives: ReturnType<typeof exec>[] = [], linked: ReturnType<typeof exec>[] = []) =>
  pollStep(check("mismatch"), base, p, ctx(today, { executives, snapshots: new Map([[p.id, linked]]) }));

describe("pollStep", () => {
  it("follows the executive that links the poll, whatever date the thread names", () => {
    const x = exec("2026-11-19", true, "2026-11-21");
    expect(step(poll("0xp"), "2026-12-01", [x], [x])).toMatchObject({ kind: "executed", named: { date: "2026-11-19", poll: { id: "0xp" } }, executed: "2026-11-21" });
    expect(step(poll("0xp"), "2026-11-20", [], [exec("2026-11-19", false)])).toMatchObject({ kind: "pending", pending: { step: { kind: "uncast" } } });
  });
  it("waits on an open poll, and says a failed poll rejected it and an artifact item is off-spell", () => {
    expect(step(poll("0xp", { passed: null, end: "2026-11-02" }), "2026-10-30")).toMatchObject({ kind: "pending", pending: { expectedBy: "2026-11-02", step: { kind: "polling" } } });
    expect(step(poll("0xp", { passed: false }), "2026-11-20")).toMatchObject({ kind: "rejected" });
    expect(step(poll("0xp", { title: "[Grove Artifact] Diamond PAU Rate Limits - Update the Recorded Values" }), "2026-11-20")).toMatchObject({ kind: "off-spell" });
  });
  it("is pending while its thread's spell is not filed, and names that spell when it was filed without the poll", () => {
    expect(step(poll("0xp"), "2026-11-06")).toMatchObject({ kind: "pending", pending: { step: { kind: "unfiled" } } });
    expect(step(poll("0xp"), "2026-11-20", [exec("2026-11-05", true, "2026-11-07")])).toMatchObject({ kind: "lapsed", why: "not-carried", spell: { date: "2026-11-05" } });
    expect(step(poll("0xp"), "2026-11-20")).toMatchObject({ kind: "lapsed", why: "none", spell: null });
  });
  it("says nothing of a passed item no executive links when its thread names no spell, and calls a Spark SAEP item off-spell", () => {
    expect(step(poll("0xp", { threadDate: null, end: "2026-10-22" }), "2026-11-20", [exec("2026-10-22", true, "2026-10-23")])).toBeNull();
    expect(step(poll("0xp", { title: "SAEP-25: Update the Allocation System Primitive" }), "2026-11-20")).toMatchObject({ kind: "off-spell" });
  });
});

describe("onchainStep through polls", () => {
  it("takes the PR's polls over the dates it names, even before the PR record is read, and says nothing for a PR that only links a thread", () => {
    const x = exec("2026-11-05", true, "2026-11-07");
    const links = { pollsByPr: new Map([[363, [poll("0xp")]]]), snapshots: new Map([["0xp", [x]]]), executives: [x] };
    expect(onchainStep(check("mismatch"), [edit("2026-10-29", ["thread:2026-11-05"])], ctx("2026-11-20", links))?.kind).toBe("executed");
    expect(onchainStep(check("mismatch"), [edit("2026-10-29", ["thread:2026-11-05"])], ctx("2026-11-20", { executives: [x] }))).toBeNull();
    expect(onchainStep(check("mismatch"), [edit("2026-10-29", [])], ctx("2026-11-20", { pollsByPr: undefined }))).toBeNull();
    expect(onchainStep(check("mismatch"), [edit("2026-10-29")], ctx("2026-11-20", links))?.kind).toBe("executed");
    const unknown = { pollsByPr: new Map([[363, [poll("0xp", { threadDate: null })]]]) };
    expect(onchainStep(check("mismatch"), [edit("2026-10-29", [])], ctx("2026-11-20", unknown))).toBeNull();
  });
});
