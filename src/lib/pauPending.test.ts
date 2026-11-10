// Pending on-chain updates: a mismatch reads as pending only when the atlas wrote
// the value after the chain last set it, and only while a spell naming the prime
// is still to be cast or the edit is inside the expected delay.
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { allPending, lastCastSpell, nextSpell, pendingFor, PENDING_DAYS, spellState, valueChangedAt, withPending, type PendingContext } from "./pauPending.ts";
import type { IndexedExecutive } from "./votes/vote-index.ts";

const limit = (setOn: string) => ({
  key: "0xk", configured: { maxAmount: "5", slope: "0" }, setAt: { block: 1, time: `${setOn}T00:00:00Z`, tx: "0xt" }, changes: 1,
  data: { maxAmount: "5", slope: "0", lastAmount: "0", lastUpdated: "0" }, available: "0",
});
const check = (status: ValueCheck["status"], setOn = "2026-10-01", extra: Partial<ValueCheck> = {}): ValueCheck => ({
  docId: "d", instance: "I", instanceDocId: null, label: "Inflow maxAmount", field: "maxAmount", stated: "10,000,000 USDC", status,
  key: "0xk", chain: "ethereum", kind: "monolithic", contract: "0xc", limit: limit(setOn), readAt: null, ...extra,
});
const exec = (date: string, cast: boolean, text = "spark proxy spell"): IndexedExecutive => ({ date, title: `Executive ${date}`, url: `https://vote/${date}`, outOfSchedule: false, cast, spell: null, text });
const ctx = (today: string, executives: IndexedExecutive[] = []): PendingContext => ({ executives, prime: "Spark", today });
const edit = (date: string, diff?: HistoryEntry["diff"]): HistoryEntry => ({ date, commitHash: date, changeType: "modified", changeKind: "semantic", ...(diff ? { diff } : {}) });

describe("valueChangedAt", () => {
  it("takes the newest edit that wrote the stated value, passing over edits that left it alone", () => {
    const entries = [
      edit("2026-10-20", [["-", "| maxAmount | 5,000,000 USDC |"], ["+", "| maxAmount | 10,000,000 USDC |"]]),
      edit("2026-11-01", [["~", [["=", "Some "], ["-", "old"], ["+", "new"], ["=", " prose"]]]]),
    ];
    expect(valueChangedAt(entries, "10,000,000 USDC")).toBe("2026-10-20");
  });
  it("reads a word-level line on its new side, and an edit without a diff as possibly the one", () => {
    expect(valueChangedAt([edit("2026-10-20", [["~", [["=", "maxAmount "], ["-", "5"], ["+", "10"], ["=", ",000,000 USDC"]]]])], "10,000,000 USDC")).toBe("2026-10-20");
    expect(valueChangedAt([edit("2026-10-21")], "10,000,000 USDC")).toBe("2026-10-21");
  });
  it("ignores cosmetic edits and moves, and is null when nothing wrote the value", () => {
    expect(valueChangedAt([{ ...edit("2026-10-20"), changeKind: "typo" }, { date: "2026-10-21", commitHash: "m", changeType: "moved" }], "x")).toBeNull();
  });
  it("matches the value whole, so 0 is not found inside 20,000,000", () => {
    const entries = [edit("2026-10-20", [["-", "| maxAmount | 10,000,000 |"], ["+", "| maxAmount | 20,000,000 |"]]), edit("2026-09-01", [["-", "| maxAmount | 5 |"], ["+", "| maxAmount | 0 |"]])];
    expect(valueChangedAt(entries, "0")).toBe("2026-09-01");
  });
  it("falls back to the last content change when no diff is found to write the value", () => {
    expect(valueChangedAt([edit("2026-10-20", [["+", "something else"]])], "10,000,000 USDC")).toBe("2026-10-20");
  });
});

describe("pendingFor", () => {
  it("is pending within the expected delay of an atlas edit newer than the chain", () => {
    const c = check("mismatch");
    const p = pendingFor(c, [c], "2026-10-20", ctx("2026-11-10"));
    expect(p).toEqual({ atlasChanged: "2026-10-20", expectedBy: "2026-11-17", spell: null });
    expect(PENDING_DAYS).toBe(28);
    expect(pendingFor(c, [c], "2026-10-20", ctx("2026-11-18"))).toBeNull();
  });
  it("is not pending when the chain moved on or after the atlas edit, or for anything but a mismatch", () => {
    expect(pendingFor(check("mismatch", "2026-10-20"), [], "2026-10-20", ctx("2026-10-21"))).toBeNull();
    expect(pendingFor(check("mismatch", "2026-10-25"), [], "2026-10-20", ctx("2026-10-26"))).toBeNull();
    expect(pendingFor(check("match"), [], "2026-10-20", ctx("2026-10-21"))).toBeNull();
    expect(pendingFor(check("mismatch"), [], null, ctx("2026-10-21"))).toBeNull();
  });
  it("names the uncast executive for the prime, and stays pending until it expires", () => {
    const c = check("mismatch");
    const spells = [exec("2026-10-16", false), exec("2026-10-30", true), exec("2026-11-27", false, "grove spell"), exec("2026-12-10", false)];
    const p = pendingFor(c, [c], "2026-10-20", ctx("2026-12-20", spells));
    expect(p?.spell).toEqual({ title: "Executive 2026-12-10", date: "2026-12-10", url: "https://vote/2026-12-10" });
    expect(p?.expectedBy).toBe("2027-01-09");
  });
});

describe("spellState", () => {
  const spells = [exec("2026-08-06", true), exec("2026-09-03", true), exec("2026-10-01", true, "grove spell")];
  it("says a spell executed without the change once the delay has passed and one naming the prime was cast since", () => {
    expect(spellState("2026-08-01", "2026-07-01", ctx("2026-11-10", spells))).toEqual({ kind: "executed", spell: { title: "Executive 2026-09-03", date: "2026-09-03", url: "https://vote/2026-09-03" } });
    expect(lastCastSpell(spells, "2026-08-01", null)).toBeNull();
  });
  it("is pending inside the delay even when a spell was cast since, and silent when the record names none, or the chain moved", () => {
    expect(spellState("2026-11-01", "2026-07-01", ctx("2026-11-10", [exec("2026-11-05", true)]))?.kind).toBe("pending");
    expect(spellState("2026-08-01", "2026-07-01", ctx("2026-11-10"))).toBeNull();
    expect(spellState("2026-08-01", "2026-08-02", ctx("2026-11-10", spells))).toBeNull();
    expect(spellState("2026-08-01", null, ctx("2026-11-10", spells))?.kind).toBe("executed");
  });
});

describe("nextSpell", () => {
  it("matches the prime's name as a word, and nothing without a prime", () => {
    expect(nextSpell([exec("2026-11-01", false, "sparkle")], "2026-10-01", "Spark")).toBeNull();
    expect(nextSpell([exec("2026-11-01", false)], "2026-10-01", null)).toBeNull();
  });
});

describe("withPending", () => {
  it("marks only the mismatches the history places, and allPending needs every one", () => {
    const off = check("mismatch");
    const other = check("mismatch", "2026-10-01", { docId: "e" });
    const checks = withPending([off, check("match"), other], new Map([["d", [edit("2026-10-20")]]]), ctx("2026-11-01"));
    expect(checks.map((c) => !!c.pending)).toEqual([true, false, false]);
    expect(allPending(checks)).toBe(false);
    expect(allPending(checks.slice(0, 2))).toBe(true);
    expect(allPending([check("match")])).toBe(false);
  });
});
