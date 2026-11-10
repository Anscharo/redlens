// The audit report's rows: values by reason, controllers missing a CONTROLLER
// grant, one row per rejected claim and document, group order, and items counted
// once however many rows they span. And its CSV, one cited document per row.
import { describe, expect, it } from "vitest";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { auditRowsToCSV, auditSearchFields } from "./pauAuditCsv.ts";
import { auditItemCount, buildPauAudit, docsToDate, groupDigits } from "./pauAuditIndex.ts";
import type { PauHistoryEntry } from "./pauHistory.ts";
import { ctx, exec } from "./pauPending.fixture.ts";
import { withOnchain } from "./pauPending.ts";

const limit = (maxAmount: string, time: string) => ({ key: "0xk", configured: { maxAmount, slope: "0" }, setAt: { block: 1, time, tx: "0xt" }, changes: 1, data: { maxAmount, slope: "0", lastAmount: "0", lastUpdated: "0" }, available: maxAmount, unit: { decimals: 6, symbol: "USDC", source: "token" as const } });
const check = (docId: string, status: ValueCheck["status"], extra: Partial<ValueCheck> = {}): ValueCheck => ({
  docId, instance: `I-${docId}`, instanceDocId: null, label: "Inflow maxAmount", field: "maxAmount", stated: "5,000,000 USDC", status, key: "0xk", chain: "ethereum", kind: "monolithic", contract: "0xc", limit: null, readAt: null, ...extra,
});
const primes = [{ primeId: "p", prime: "Spark", checks: [
  check("d1", "mismatch", { limit: limit("7000000000000", "2026-05-01T00:00:00Z") }),
  check("d2", "mismatch", { kind: "diamond", limit: limit("7000000000000", "2026-05-01T00:00:00Z") }),
  check("d2", "mismatch", { kind: "monolithic", limit: limit("7000000000000", "2026-05-01T00:00:00Z") }),
  check("d3", "no-key", { key: null, contract: null }),
  check("d4", "match"),
] }];
const roles = (name: string, account: string) => [{ role: "0xr", name, account, since: { block: 1, time: "t", tx: "0xt" }, holds: true }];
const snap: StoredPauSnapshot = {
  deployment: "p:plasma:monolithic", prime: "p", primeName: "Spark", chain: "plasma", kind: "monolithic", fetchedAt: "t",
  contracts: [
    { role: "controller", address: "0xctrl", atlasDocs: ["dc"], events: 1, historyComplete: true, roles: [] },
    { role: "almProxy", address: "0xp", events: 1, historyComplete: true, roles: roles("CONTROLLER", "0xother") },
    { role: "rateLimits", address: "0xr", events: 1, historyComplete: true, roles: [] },
  ],
};
const claims = [{ prime: null, chain: "arbitrum", role: "beacon" as const, address: "0xb", docs: ["e1", "e2"], reason: "It is the Governance Relay." }];
const edit = (date: string) => [{ date, commitHash: date, changeType: "modified" as const, changeKind: "semantic" as const }];
const history = new Map([["d1", edit("2026-04-01")], ["d2", edit("2026-06-01")]]);
const rows = buildPauAudit({ primes, snaps: [snap], claims, history });

describe("buildPauAudit", () => {
  it("groups values by which side moved, then controllers, then claims, and counts items once", () => {
    expect(rows.map((r) => [r.group, r.reason, r.docId])).toEqual([
      ["atlas", "chain-newer", "d1"],
      ["spell", "atlas-newer", "d2"], ["spell", "atlas-newer", "d2"], ["spell", "not-wired", "dc"],
      ["detail", "no-key", "d3"],
      ["registry", "rejected-claim", "e1"], ["registry", "rejected-claim", "e2"],
    ]);
    expect(auditItemCount(rows)).toBe(5);
    expect(rows[0]).toMatchObject({ onchain: "7,000,000 USDC", chainSetAt: "2026-05-01", atlasChangedAt: "2026-04-01" });
    expect(rows.find((r) => r.reason === "not-wired")).toMatchObject({ onchain: "on neither", contract: "0xctrl" });
    expect(rows.at(-1)).toMatchObject({ prime: "Shared", note: "It is the Governance Relay.", stated: "0xb" });
  });
  it("dates only the documents stating a mismatch or a limit never set", () => {
    expect(docsToDate(primes)).toEqual(["d1", "d2"]);
    expect(docsToDate([{ primeId: "p", prime: "Spark", checks: [check("d5", "not-set")] }])).toEqual(["d5"]);
  });
  it("places a change the atlas moved last by what became of the spell its pull request names", () => {
    const written = [{ date: "2026-06-01", commitHash: "c", changeType: "modified" as const, changeKind: "semantic" as const, pr: 316, spells: ["2026-06-11"], diff: [["+", "maxAmount 5,000,000 USDC"]] as [["+", string]] }];
    const history = new Map([["d2", written]]);
    const audit = (executives: ReturnType<typeof exec>[], entries: PauHistoryEntry[] = []) => {
      const c = ctx("2026-11-10", { executives, pau: { entries, queued: [] }, snaps: [snap] });
      const stepped = primes.map((p) => ({ ...p, checks: withOnchain(p.checks, history, c) }));
      return buildPauAudit({ primes: stepped, snaps: [snap], claims: [], history }).filter((r) => r.docId === "d2");
    };
    const executed = audit([exec("2026-06-11", true, "2026-06-12", "0xs")]);
    expect(executed.map((r) => [r.group, r.reason])).toEqual([["spell-executed", "spell-executed"], ["spell-executed", "spell-executed"]]);
    expect(executed[0].step).toMatchObject({ kind: "executed", named: { pr: 316, date: "2026-06-11" }, executed: "2026-06-12" });
    expect(audit([exec("2026-06-11", false)]).map((r) => r.reason)).toEqual(["spell-lapsed", "spell-lapsed"]);
    const recordedAfter = audit([exec("2026-05-28", true, "2026-05-30", "0xs")].map((x) => ({ ...x, date: "2026-06-11" })));
    expect(recordedAfter.map((r) => [r.group, r.reason])).toEqual([["atlas", "atlas-recorded-unmade"], ["atlas", "atlas-recorded-unmade"]]);
    const set: PauHistoryEntry = { chain: "ethereum", tx: "0xt", block: 1, time: "2026-06-12T00:00:00Z", primes: ["p"], executive: null,
      origin: { kind: "spell", path: "starguard", spell: "0xs", starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "e" },
      changes: [{ deployments: [], contract: "0xc", role: "rateLimits", event: "RateLimitDataSet", args: {}, subject: "0xk", label: null, before: null }] };
    expect(audit([exec("2026-06-11", true, "2026-06-12", "0xs")], [set]).map((r) => [r.group, r.reason])).toEqual([["ambiguous", "spell-set-differently"], ["ambiguous", "spell-set-differently"]]);
  });
});

describe("auditRowsToCSV", () => {
  it("writes one cited document per row with its UUID and link, and searches what the table shows", () => {
    const csv = auditRowsToCSV(rows, (id) => `A.${id}`).split("\r\n");
    expect(csv).toHaveLength(rows.length + 1);
    expect(csv[0]).toContain('"Doc No","UUID","Atlas Link"');
    expect(csv[1]).toContain('"A.d1","d1","');
    expect(csv[1]).toContain("atlas?id=d1");
    expect(auditSearchFields(rows[0], "A.d1").map((f) => f.value)).toEqual(expect.arrayContaining(["Atlas probably out of date", "A.d1", "Spark"]));
  });
});

describe("groupDigits", () => {
  it("groups an amount's whole part and leaves the rest", () => {
    expect(["20000000 USDC per day", "0.000001 USDC", "unlimited", "1500000.25"].map(groupDigits)).toEqual(["20,000,000 USDC per day", "0.000001 USDC", "unlimited", "1,500,000.25"]);
  });
});
