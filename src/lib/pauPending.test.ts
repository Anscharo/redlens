// Pending on-chain updates, judged on the PAU history: a queued action set, an
// uncast executive or the route's delay keeps a mismatch pending; past them, a
// spell that changed the deployment late enough says it executed without the
// change, never for an Operator key; the chain moving since says nothing.
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history.ts";
import { actionSet, check, ctx, exec, snap, spellEntry } from "./pauPending.fixture.ts";
import { DEFAULT_LAG_DAYS } from "./pauPendingEvidence.ts";
import { allPending, CYCLE_DAYS, nextSpell, onchainStep, pendingFor, SPELL_LEAD_DAYS, withPending } from "./pauPending.ts";
import { addDays } from "./votes/vote-index.ts";

const WINDOW = CYCLE_DAYS + SPELL_LEAD_DAYS + DEFAULT_LAG_DAYS;

describe("onchainStep", () => {
  it("is pending within the route's delay of an atlas edit newer than the chain, and silent once the chain moved", () => {
    const c = check("mismatch");
    expect(onchainStep(c, "2026-10-20", ctx("2026-11-10"))).toEqual({ kind: "pending", pending: { atlasChanged: "2026-10-20", expectedBy: addDays("2026-10-20", WINDOW), route: "relayed", step: { kind: "window" } } });
    expect(onchainStep(c, "2026-10-20", ctx(addDays("2026-10-20", WINDOW + 1)))).toBeNull();
    expect(onchainStep(check("mismatch", "2026-10-20"), "2026-10-20", ctx("2026-10-21"))).toBeNull();
    expect(onchainStep(c, null, ctx("2026-10-21"))).toBeNull();
  });
  it("widens the delay by how long this chain's spells have taken to land", () => {
    const pau = { entries: [spellEntry("2026-06-04", "2026-06-24")], queued: [] };
    const step = onchainStep(check("mismatch"), "2026-10-20", ctx("2026-11-10", { pau }));
    expect(step?.kind === "pending" && step.pending.expectedBy).toBe(addDays("2026-10-20", CYCLE_DAYS + SPELL_LEAD_DAYS + 20));
  });
  it("names a queued action set on the deployment's Executor first, then an uncast executive naming the prime", () => {
    const pau = { entries: [], queued: [actionSet("2026-12-01", "2026-12-03")] };
    const late = "2027-01-01";
    expect(onchainStep(check("mismatch"), "2026-08-01", ctx(late, { pau }))).toBeNull();
    const queued = onchainStep(check("mismatch"), "2026-11-25", ctx("2026-12-02", { pau }));
    expect(queued?.kind === "pending" && queued.pending.step).toEqual({ kind: "queued", chain: "base", tx: "0xqueue", at: "2026-12-03T00:00:00Z" });
    const uncast = onchainStep(check("mismatch"), "2026-08-01", ctx("2026-10-01", { executives: [exec("2026-09-10", false), exec("2026-09-11", false, "grove")] }));
    expect(uncast?.kind === "pending" && uncast.pending.step).toEqual({ kind: "uncast", spell: { title: "Executive 2026-09-10", date: "2026-09-10", url: "https://vote/2026-09-10" } });
  });
  it("says a spell executed without the change once past the delay, counting only spells dated late enough to carry it", () => {
    const today = "2026-11-10";
    const executed = onchainStep(check("mismatch"), "2026-08-01", ctx(today, { pau: { entries: [spellEntry("2026-08-06", "2026-08-10"), spellEntry("2026-09-03", "2026-09-08")], queued: [] } }));
    expect(executed).toEqual({ kind: "executed", spell: { title: "Executive 2026-09-03", date: "2026-09-03", url: "https://vote/2026-09-03" }, chain: "base", tx: "0x2026-09-03" });
    expect(onchainStep(check("mismatch"), "2026-08-01", ctx(today, { pau: { entries: [spellEntry("2026-08-06", "2026-08-10")], queued: [] } }))).toBeNull();
    const relayed = { ...spellEntry("2026-09-03", "2026-09-20"), executive: null, origin: { ...spellEntry("x", "x").origin!, kind: "relayed" as const, spell: null, relay: { executor: "0xex", actionsSet: 12 } } };
    expect(onchainStep(check("mismatch"), "2026-08-01", ctx(today, { pau: { entries: [relayed], queued: [] } }))).toMatchObject({ kind: "executed", actionsSet: 12, spell: { title: null } });
  });
  it("never blames a spell for a key the Operator may set, and dates a limit never set against the atlas alone", () => {
    const pau = { entries: [spellEntry("2026-09-03", "2026-09-08")], queued: [] };
    expect(onchainStep(check("mismatch"), "2026-08-01", ctx("2026-11-10", { pau, snaps: [snap(true)] }))).toBeNull();
    const operator = onchainStep(check("mismatch"), "2026-11-01", ctx("2026-11-10", { snaps: [snap(true)] }));
    expect(operator?.kind === "pending" && operator.pending.route).toBe("operator");
    expect(onchainStep(check("not-set", "", { limit: null, kind: null, contract: null }), "2026-08-01", ctx("2026-11-10", { pau }))?.kind).toBe("executed");
  });
});

describe("nextSpell", () => {
  it("matches the prime's name as a word, and nothing without a prime", () => {
    expect(nextSpell([exec("2026-11-01", false, "sparkle")], "2026-10-01", "Spark")).toBeNull();
    expect(nextSpell([exec("2026-11-01", false)], "2026-10-01", null)).toBeNull();
  });
});

describe("withPending", () => {
  const edit = (date: string): HistoryEntry[] => [{ date, commitHash: date, changeType: "modified", changeKind: "semantic" }];
  it("marks only the mismatches the history places, and allPending needs every one", () => {
    const checks = withPending([check("mismatch"), check("match"), check("mismatch", "2026-07-01", { docId: "e" })], new Map([["d", edit("2026-10-20")]]), ctx("2026-11-01"));
    expect(checks.map((c) => !!c.pending)).toEqual([true, false, false]);
    expect(allPending(checks)).toBe(false);
    expect(allPending(checks.slice(0, 2))).toBe(true);
  });
  it("leaves a slope stated on a limit both sides switch off a plain mismatch", () => {
    const off = { ...check("mismatch"), field: "slope" as const, limit: { ...check("mismatch").limit!, data: { maxAmount: "0", slope: "0", lastAmount: "0", lastUpdated: "0" } } };
    const max = { ...check("match"), limit: off.limit };
    expect(pendingFor(off, [off, max], "2026-10-20", ctx("2026-11-01"))).toBeNull();
  });
});
