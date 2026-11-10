// What governance did about an atlas value, followed from the spell its pull
// request names: not filed, not cast, its relay queued, its changes still read,
// executed without the value, set to another value, or lapsed; nothing said
// when the writing change is uncertain or its PR unread.
import { describe, expect, it } from "vitest";
import { actionSet, check, ctx, edit, exec, spellEntry } from "./pauPending.fixture.ts";
import { allPending, onchainStep, withOnchain } from "./pauPending.ts";

const named = { atlasChanged: "2026-10-29", pr: 363, date: "2026-11-05" };
const step = (spells: string[] | undefined, today: string, o = {}, c = check("mismatch")) => onchainStep(c, [edit("2026-10-29", spells)], ctx(today, o));

describe("onchainStep", () => {
  it("says the PR names no spell, and nothing while the PR is unread or the writing change is unclear", () => {
    expect(step([], "2026-11-10")).toEqual({ kind: "unnamed", atlasChanged: "2026-10-29", pr: 363 });
    expect(step(undefined, "2026-11-10")).toBeNull();
    expect(onchainStep(check("mismatch"), [edit("2026-10-29", ["2026-11-05"], [["+", "unrelated"]])], ctx("2026-11-10"))).toBeNull();
  });
  it("waits for an executive not filed yet, then calls it lapsed", () => {
    expect(step(["2026-11-05"], "2026-11-08")).toEqual({ kind: "pending", pending: { ...named, expectedBy: "2026-11-12", step: { kind: "unfiled" } } });
    expect(step(["2026-11-05"], "2026-11-20")).toEqual({ kind: "lapsed", named, spell: null });
  });
  it("waits for an executive not yet cast until it expires, and finds one filed within the slip", () => {
    const executives = [exec("2026-11-06", false)];
    expect(step(["2026-11-05"], "2026-11-10", { executives })).toMatchObject({ kind: "pending", pending: { expectedBy: "2026-12-06", step: { kind: "uncast", spell: { date: "2026-11-06" } } } });
    expect(step(["2026-11-05"], "2026-12-07", { executives })).toMatchObject({ kind: "lapsed", spell: { date: "2026-11-06" } });
  });
  it("after the cast: still reading its changes, then executed without the value", () => {
    const executives = [exec("2026-11-05", true, "2026-11-07")];
    expect(step(["2026-11-05"], "2026-11-09", { executives })).toMatchObject({ kind: "pending", pending: { expectedBy: "2026-11-10", step: { kind: "reading", executed: "2026-11-07" } } });
    expect(step(["2026-11-05"], "2026-11-20", { executives })).toEqual({ kind: "executed", named, spell: { title: "Executive 2026-11-05", date: "2026-11-05", url: "https://vote/2026-11-05" }, executed: "2026-11-07" });
  });
  it("waits on the relay an Executor holds queued since the cast", () => {
    const pau = { entries: [], queued: [actionSet("2026-11-08", "2026-11-15")] };
    expect(step(["2026-11-05"], "2026-11-20", { executives: [exec("2026-11-05", true, "2026-11-07")], pau })).toMatchObject({ kind: "pending", pending: { expectedBy: "2026-11-18", step: { kind: "queued", chain: "base", tx: "0xqueue" } } });
  });
  it("says the named spell set the key to another value, even where the chain moved since", () => {
    const pau = { entries: [spellEntry("0xspell", "2026-11-08", "0xK")], queued: [] };
    const executives = [exec("2026-11-05", true, "2026-11-07")];
    expect(step(["2026-11-05"], "2026-11-20", { executives, pau }, check("mismatch", "2026-11-08"))).toMatchObject({ kind: "set", chain: "base", tx: "0x2026-11-08" });
    expect(step(["2026-11-05"], "2026-11-20", { executives }, check("mismatch", "2026-11-08"))).toBeNull();
  });
  it("takes the most telling of several named spells", () => {
    const executives = [exec("2026-10-08", true, "2026-10-10", "0xold"), exec("2026-11-05", false)];
    expect(step(["2026-10-08", "2026-11-05"], "2026-11-10", { executives })?.kind).toBe("pending");
  });
});

describe("withOnchain", () => {
  it("follows mismatches and limits never set, and allPending needs every mismatch pending", () => {
    const history = new Map([["d", [edit("2026-10-29", ["2026-11-05"])]]]);
    const checks = withOnchain([check("mismatch"), check("match"), check("not-set", "", { limit: null, kind: null, contract: null })], history, ctx("2026-11-08"));
    expect(checks.map((c) => c.onchain?.kind)).toEqual(["pending", undefined, "pending"]);
    expect(allPending(checks)).toBe(true);
    expect(allPending([check("mismatch"), ...checks])).toBe(false);
  });
});
