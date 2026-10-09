// The PAU census drift rules: a new disagreement says which side moved, a
// lost match and a value the reader cannot read are drift, a renumbering or a
// change in how a value reads is not, a gone deployment or a collapsed prime
// is one line instead of one per value, resolutions are notes, and each kind
// of line stops at a cap.
import { describe, expect, it } from "vitest";
import type { CensusSlot, CensusValue, PauCensus } from "./pauCensus.ts";
import { diffPauCensus } from "./pauCensusDiff.ts";

const K = "0x" + "1".repeat(64);
const AT = `ethereum/monolithic/${K}`;
const value = (n: number, slot: CensusSlot, extra: Partial<CensusValue> = {}): [string, CensusValue] => [
  `doc-${n}:maxAmount`,
  { prime: "p1", doc_no: `A.1.${n}`, instance: `Ethereum Mainnet - I${n}`, label: "Inflow maxAmount", stated: "5 USDC", at: { [AT]: slot }, ...extra },
];
const census = (values: [string, CensusValue][], deployments = ["p1/ethereum/monolithic"]): PauCensus => ({ deployments, counts: {}, values: Object.fromEntries(values) });
const name = (prime: string) => (prime === "p1" ? "Prime One" : prime);
const drift = (prev: PauCensus, cur: PauCensus) => diffPauCensus(prev, cur, name).drift;
const BASE = census([value(1, "match"), value(2, "match"), value(3, ["mismatch", "9000000", "9 USDC"]), value(4, "match")]);

describe("diffPauCensus", () => {
  it("is silent on an unchanged census", () => {
    expect(diffPauCensus(BASE, BASE, name)).toEqual({ drift: [], notes: ["pau-census: 0 baseline disagreement(s) resolved, 0 new value(s) not yet comparable"] });
  });
  it("reports a match turning into a mismatch as the chain moving", () => {
    const cur = census([value(1, ["mismatch", "1", "0.000001 USDC"]), value(2, "match"), value(3, ["mismatch", "9000000", "9 USDC"]), value(4, "match")]);
    expect(drift(BASE, cur)).toEqual([
      '[drift] pau-census: NEW mismatch — Prime One · Ethereum Mainnet - I1 · Inflow maxAmount (A.1.1, doc-1) on ethereum/monolithic: atlas "5 USDC", chain 0.000001 USDC (chain changed)',
    ]);
  });
  it("reports an atlas edit, and a known mismatch whose chain value changed", () => {
    const cur = census([value(1, ["mismatch", "5000000", "5 USDC"], { stated: "7 USDC" }), value(2, "match"), value(3, ["mismatch", "8000000", "8 USDC"]), value(4, "match")]);
    expect(drift(BASE, cur)).toEqual([
      expect.stringContaining('I1 · Inflow maxAmount (A.1.1, doc-1) on ethereum/monolithic: atlas "7 USDC", chain 5 USDC (atlas changed, was "5 USDC")'),
      expect.stringContaining("I3 · Inflow maxAmount (A.1.3, doc-3) on ethereum/monolithic: atlas \"5 USDC\", chain 8 USDC (chain changed)"),
    ]);
  });
  it("reports a new atlas value that already disagrees, and counts one not yet comparable as a note", () => {
    const cur = census([...Object.entries(BASE.values), value(5, ["not-set", null, "not set"]), value(6, "no-key")]);
    const out = diffPauCensus(BASE, cur, name);
    expect(out.drift).toEqual([expect.stringContaining("NEW not-set — Prime One · Ethereum Mainnet - I5 · Inflow maxAmount (A.1.5, doc-5) on ethereum/monolithic: atlas \"5 USDC\", chain not set (new in the atlas)")]);
    expect(out.notes).toEqual(["pau-census: 0 baseline disagreement(s) resolved, 1 new value(s) not yet comparable"]);
  });
  it("reports a lost match, a vanished value and a value the reader cannot read", () => {
    const cur = census([value(1, "unread"), value(3, ["mismatch", "9000000", "9 USDC"]), value(4, "match", { at: { "-/-/-": "unknown-chain" } })]);
    expect(drift(BASE, cur)).toEqual([
      "[drift] pau-census: LOST MATCH — Prime One · Ethereum Mainnet - I1 · Inflow maxAmount (A.1.1, doc-1): match → unread",
      "[drift] pau-census: LOST MATCH — Prime One · Ethereum Mainnet - I2 · Inflow maxAmount (A.1.2, doc-2): value no longer stated",
      "[drift] pau-census: LOST MATCH — Prime One · Ethereum Mainnet - I4 · Inflow maxAmount (A.1.4, doc-4): match → unknown-chain",
      '[drift] pau-census: unknown-chain — Prime One · Ethereum Mainnet - I4 · Inflow maxAmount (A.1.4, doc-4): atlas "5 USDC"',
    ]);
  });
  it("ignores a renumbering and a change in how an unchanged chain value reads", () => {
    const cur = census([value(1, "match", { doc_no: "A.9.1" }), value(2, "match"), value(3, ["mismatch", "9000000", "9000000"]), value(4, "match")]);
    expect(drift(BASE, cur)).toEqual([]);
  });
  it("notes a resolved disagreement without warning", () => {
    const cur = census([value(1, "match"), value(2, "match"), value(3, "match"), value(4, "match")]);
    expect(diffPauCensus(BASE, cur, name)).toEqual({ drift: [], notes: ["pau-census: 1 baseline disagreement(s) resolved, 0 new value(s) not yet comparable"] });
  });
  it("reports a gone deployment once instead of each match it held", () => {
    const cur = census([value(1, "no-deployment"), value(2, "no-deployment"), value(3, "no-deployment"), value(4, "no-deployment")], []);
    expect(drift(BASE, cur)).toEqual(["[drift] pau-census: deployment Prime One ethereum/monolithic is gone from the snapshots; its values are not compared"]);
  });
  it("reports a prime whose values collapsed once instead of each vanished value", () => {
    expect(drift(BASE, census([value(1, "match")]))).toEqual([
      "[drift] pau-census: values stated by Prime One fell below half the baseline's; check the instance params the census reads before treating this as resolution",
    ]);
  });
  it("stops each kind of line at the cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => value(i + 10, "match"));
    const out = drift(census(many), census(many.map(([id, v]) => [id, { ...v, at: { [AT]: "unread" as const } }])));
    expect(out).toHaveLength(26);
    expect(out[25]).toBe("[drift] pau-census: …and 5 more line(s) like the one above");
  });
});
