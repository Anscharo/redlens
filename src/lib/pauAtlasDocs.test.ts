// Each served contract carries the atlas documents the registry cites for its
// address: the deployment's own members first, then its chain's shared ones.
import { describe, expect, it } from "vitest";
import type { PauSnapshot } from "./pau.ts";
import type { PauRegistry } from "./pauRegistry.ts";
import { atlasDocsByAddress, withAtlasDocs } from "./pauAtlasDocs.ts";

const CTRL = "0x" + "c".repeat(40);
const RL = "0x" + "1".repeat(40);
const FACET = "0x" + "f".repeat(40);
const reg: PauRegistry = {
  shared: [{ chain: "ethereum", members: [{ role: "facet", address: FACET, provenance: [{ source: "atlas", doc: "doc-facet" }] }] }],
  deployments: [
    { prime: "p", primeName: "P", chain: "ethereum", kind: "diamond", members: [
      { role: "controller", address: CTRL.toUpperCase().replace("0X", "0x"), provenance: [{ source: "atlas", doc: "doc-ctrl" }, { source: "onchain", note: "wiring" }, { source: "atlas", doc: "doc-ctrl-2" }] },
      { role: "rateLimits", address: RL, provenance: [{ source: "onchain" }] },
    ] },
    { prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", members: [{ role: "controller", address: CTRL, provenance: [{ source: "atlas", doc: "doc-mono" }] }] },
  ],
  ignored: [],
};
const snap = (kind: "diamond" | "monolithic"): PauSnapshot => ({ deployment: `p:ethereum:${kind}`, prime: "p", primeName: "P", chain: "ethereum", kind, contracts: [
  { role: "controller", address: CTRL, events: 0, historyComplete: true },
  { role: "rateLimits", address: RL, events: 0, historyComplete: true },
  { role: "facet" as never, address: FACET, events: 0, historyComplete: true },
] });

describe("atlas docs per contract", () => {
  it("takes only atlas provenance, by the deployment's own generation, plus the chain's shared contracts", () => {
    expect([...atlasDocsByAddress(reg, snap("diamond"))]).toEqual([[CTRL, ["doc-ctrl", "doc-ctrl-2"]], [FACET, ["doc-facet"]]]);
    expect(atlasDocsByAddress(reg, snap("monolithic")).get(CTRL)).toEqual(["doc-mono"]);
    expect(atlasDocsByAddress(reg, { prime: "other", chain: "base", kind: "diamond" }).size).toBe(0);
  });
  it("sets atlasDocs only on contracts the registry cites, leaving the rest untouched", () => {
    const [out] = withAtlasDocs([snap("diamond")], reg);
    expect(out.contracts.map((c) => c.atlasDocs)).toEqual([["doc-ctrl", "doc-ctrl-2"], undefined, ["doc-facet"]]);
    expect("atlasDocs" in out.contracts[1]).toBe(false);
  });
  it("carries the other provenance notes as evidence, and nothing for a source with no note", () => {
    const [out] = withAtlasDocs([snap("diamond")], reg);
    expect(out.contracts.map((c) => c.evidence)).toEqual([["wiring"], undefined, undefined]);
  });
});
