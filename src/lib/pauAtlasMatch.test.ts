// A key's Atlas verdict: a match only when every stated value is a certain
// match, a mismatch when any certainly differs, otherwise unsure; each links to
// the first document stating a value for it.
import { describe, expect, it } from "vitest";
import { atlasVerdicts, elsewhereId, matchId, rowMark } from "./pauAtlasMatch.ts";
import type { ValueCheck, ValueStatus } from "./pauAtlasValues.ts";

const check = (contract: string | null, key: string | null, status: ValueStatus, docId = "doc"): ValueCheck =>
  ({ contract, key, status, docId, field: "maxAmount" }) as ValueCheck;

describe("atlasVerdicts", () => {
  it("gives a key whose values all match a match, per contract, case-insensitively", () => {
    const out = atlasVerdicts([check("0xAA", "0xK1", "match", "d1"), check("0xaa", "0xk1", "match", "d2"), check("0xBB", "0xK1", "match", "d3")]);
    expect([...out]).toEqual([[matchId("0xaa", "0xk1"), { mark: "match", docId: "d1" }], [matchId("0xbb", "0xk1"), { mark: "match", docId: "d3" }]]);
  });
  it("says mismatch when any value certainly differs, even beside an unsure one", () => {
    expect(atlasVerdicts([check("0xaa", "0xk1", "match"), check("0xaa", "0xk1", "mismatch", "d2"), check("0xaa", "0xk1", "ambiguous")]).get(matchId("0xaa", "0xk1"))?.mark).toBe("mismatch");
  });
  it("says unsure when a value is stated but not certainly right or wrong", () => {
    for (const other of ["ambiguous", "units-unknown", "unread"] as const) {
      expect(atlasVerdicts([check("0xaa", "0xk1", "match"), check("0xaa", "0xk1", other)]).get(matchId("0xaa", "0xk1"))?.mark).toBe("unsure");
    }
  });
  it("gives nothing to checks with no contract or key", () => {
    expect(atlasVerdicts([check(null, "0xk1", "match"), check("0xaa", null, "match")]).size).toBe(0);
  });
  it("names the deployments a key's value is stated for, under the key alone", () => {
    const on = (chain: string, kind: "diamond" | "monolithic") => ({ ...check("0xaa", "0xK1", "match", "d1"), chain, kind }) as ValueCheck;
    const out = atlasVerdicts([on("arbitrum", "diamond"), on("arbitrum", "diamond"), on("base", "monolithic")]);
    expect(out.get(elsewhereId("0xk1"))).toEqual({ mark: "elsewhere", docId: "d1", on: ["arbitrum diamond", "base monolithic"] });
  });
});

describe("rowMark", () => {
  const elsewhere = { mark: "elsewhere" as const, docId: "value-doc", on: ["arbitrum diamond"] };
  const refs = [{ docId: "key-doc", label: "Aggregate CCTP", chain: "arbitrum" }];
  it("prefers the row's own verdict", () => {
    const own = { mark: "match" as const, docId: "d" };
    expect(rowMark(own, elsewhere, "arbitrum", refs)).toEqual({ shown: own, keyDocId: "key-doc" });
  });
  it("shows the elsewhere verdict where the value is stated on this chain's other deployment", () => {
    expect(rowMark(undefined, elsewhere, "arbitrum", refs)).toEqual({ shown: elsewhere, keyDocId: "key-doc" });
  });
  it("shows no mark and no key link where the value is stated only on other chains", () => {
    expect(rowMark(undefined, elsewhere, "ethereum", refs)).toEqual({ shown: undefined, keyDocId: null });
  });
  it("falls back to the key's document where nothing states a value", () => {
    expect(rowMark(undefined, undefined, "ethereum", [{ docId: "k", label: "x" }])).toEqual({ shown: undefined, keyDocId: "k" });
  });
});
