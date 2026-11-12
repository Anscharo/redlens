// The change history: one entry per transaction, governance contracts' own
// events left out, a spell's executive joined, a registry contract's primes
// and deployments named.
import { describe, expect, it } from "bun:test";
import type { PauOrigin } from "../../lib/pauHistory.ts";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { buildEntries, ownersOf, type EventRow } from "./history-entries.ts";

const P = "dee2f5a4-279a-488c-9a9d-9583e3216fbf";
const reg = {
  shared: [],
  ignored: [],
  deployments: [{ prime: P, primeName: "Spark", chain: "ethereum", kind: "monolithic", members: [{ role: "rateLimits", address: "0xrl", provenance: [] }] }],
} as unknown as PauRegistry;
const row = (o: Partial<EventRow>): EventRow => ({ chain: "ethereum", tx: "0xa", contract: "0xrl", event: "RateLimitDataSet", args: {}, block: 1, time: "2026-01-01T00:00:00.000Z", ...o });
const spell: PauOrigin = { kind: "spell", path: "starguard", spell: "0xs", starSpell: null, l1Tx: "0xa", from: null, to: null, relay: null, evidence: "e" };

describe("buildEntries", () => {
  it("groups a transaction's changes, drops origin evidence and joins the executive", () => {
    const rows = [row({}), row({ event: "Exec", contract: "0xsg" }), row({ tx: "0xb", time: "2025-01-01T00:00:00.000Z", event: "RoleGranted" })];
    const entries = buildEntries(rows, ownersOf(reg), new Map([["ethereum:0xa", spell]]), (s) => ({ title: `exec ${s}`, date: "2026-01-01", url: null, source: "vote-record" }));
    expect(entries.map((e) => e.tx)).toEqual(["0xb", "0xa"]);
    expect(entries[1]).toMatchObject({ primes: [P], executive: { title: "exec 0xs" }, changes: [{ event: "RateLimitDataSet", role: "rateLimits", deployments: [`${P}:ethereum:monolithic`] }] });
    expect(entries[0]).toMatchObject({ origin: null, executive: null });
  });
  it("gives a Solana account the registry does not list its controller's prime, under its own role", () => {
    const svm = { ...reg, deployments: [{ prime: P, primeName: "Keel", chain: "solana", kind: "svm", members: [{ role: "rateLimits", address: "Ctrl", provenance: [] }] }] } as unknown as PauRegistry;
    const made = row({ chain: "solana", contract: "NewIntegration", event: "IntegrationUpdate", args: { authority: "A", old: null, new: { controller: "Ctrl" } } });
    const stray = row({ chain: "solana", tx: "0xb", contract: "Other", event: "IntegrationUpdate", args: { old: null, new: { controller: "Elsewhere" } } });
    const entries = buildEntries([made, stray], ownersOf(svm), new Map(), () => ({ title: null, date: null, url: null, source: null }));
    expect(entries.find((e) => e.tx === "0xa")).toMatchObject({ primes: [P], changes: [{ contract: "NewIntegration", role: "integration", deployments: [`${P}:solana:svm`] }] });
    expect(entries.find((e) => e.tx === "0xb")?.primes).toEqual([]);
  });
  it("leaves out a transaction that holds only governance evidence", () => {
    expect(buildEntries([row({ event: "Plot", contract: "0xsg" })], ownersOf(reg), new Map(), () => ({ title: null, date: null, url: null, source: null }))).toEqual([]);
  });
});
