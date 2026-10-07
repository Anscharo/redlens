// Coverage for the atlas half of PAU discovery and the registry draft.
//
// The fixture mirrors the real section shapes under a Prime agent's
// "Liquidity Layer Addresses" (ALM Contracts > <chain>, Diamond PAU Contracts
// > <chain>, Governance Processes > Multisigs) and the primitive's shared
// contracts, including the two traps found against the real atlas: an
// ancestor titled "Base Elements" must not place the shared facets on Base,
// and addresses.json-style chain attribution must lose to the doc's own
// section title.

import { describe, expect, it } from "vitest";
import { ANY_CHAIN, chainInTitle, discoverPau, roleOf } from "../scripts/lib/pau-discover.ts";
import { draftRegistry } from "../scripts/lib/pau-draft.ts";
import type { AtlasNode } from "../src/types.ts";

const PRIME = "11111111-1111-4111-8111-111111111111";
const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

let order = 0;
function doc(id: string, doc_no: string, title: string, addressRefs: string[] = []): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 6, parentId: null, content: "", order: order++, addressRefs };
}
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

const DOCS: AtlasNode[] = [
  doc(uuid(1), "A.2", "The Support Scope"),
  doc(uuid(2), "A.2.1", "Base Elements"),
  doc(uuid(3), "A.2.1.1", "Liquidity Layer Shared Contracts"),
  doc(uuid(4), "A.2.1.1.1", "USDS Facet", [a(1)]),
  doc(uuid(5), "A.2.1.1.2", "Beacon", [a(2)]),
  doc(PRIME, "A.6.1", "Prime Foo"),
  doc(uuid(10), "A.6.1.1", "Foo Liquidity Layer Addresses"),
  doc(uuid(11), "A.6.1.1.1", "ALM Contracts"),
  doc(uuid(12), "A.6.1.1.1.1", "Base"),
  doc(uuid(13), "A.6.1.1.1.1.1", "ALM Controller (ForeignController Base) Contract Address", [a(10)]),
  doc(uuid(14), "A.6.1.1.1.1.2", "ALM Rate Limits (Base) Contract", [a(11)]),
  doc(uuid(15), "A.6.1.1.1.1.3", "ALM Relayer Multisig (Base) Address", [a(12)]),
  doc(uuid(16), "A.6.1.1.1.2", "Ethereum Mainnet"),
  doc(uuid(17), "A.6.1.1.1.2.1", "ALM Controller Contract", [a(20)]),
  doc(uuid(18), "A.6.1.1.2", "Diamond PAU Contracts"),
  doc(uuid(19), "A.6.1.1.2.1", "Ethereum Mainnet"),
  doc(uuid(20), "A.6.1.1.2.1.1", "Controller Contract", [a(30)]),
  doc(uuid(21), "A.6.1.1.2.1.2", "AdministeredAgent Contract", [a(31)]),
  doc(uuid(30), "A.6.1.2", "Governance Processes"),
  doc(uuid(31), "A.6.1.2.1", "Multisigs"),
  doc(uuid(32), "A.6.1.2.1.1", "Prime Relayer Multisig"),
  doc(uuid(33), "A.6.1.2.1.1.1", "Address", [a(40)]),
  doc(uuid(40), "A.6.1.3", "Active Instances"),
  doc(uuid(41), "A.6.1.3.1", "Token Address", [a(50)]),
];
const docs = Object.fromEntries(DOCS.map((d) => [d.id, d]));
// The explorer-style attribution is deliberately wrong for a(10).
const atlasChain = (addr: string) => ({ [a(10)]: "optimism" })[addr] ?? "ethereum";
const obs = discoverPau({ docs, primes: new Map([[PRIME, "Foo"]]), atlasChain });
const find = (addr: string) => obs.filter((o) => o.address === addr);

describe("roleOf / chainInTitle", () => {
  it("reads the role from the doc title, rate limits before controller", () => {
    expect(roleOf("ALM Rate Limits (Base) Contract")).toBe("rateLimits");
    expect(roleOf("ALM Controller (MainnetController) Contract")).toBe("controller");
    expect(roleOf("Solana ALM Controller’s PDA")).toBeNull();
    expect(roleOf("ALM Proxy Freezable (Base) Contract")).toBe("almProxy");
    expect(roleOf("ALM Relayer Multisig Addresses")).toBe("relayer");
    expect(roleOf("Allocator Vault Contract")).toBeNull();
  });
  it("matches chain aliases on word boundaries", () => {
    expect(chainInTitle("Ethereum Mainnet")).toBe("ethereum");
    expect(chainInTitle("ALM Proxy (X Layer) Contract")).toBe("xlayer");
    expect(chainInTitle("Database")).toBeNull();
  });
});

describe("discoverPau", () => {
  it("places a prime's contracts by its section title, not the explorer's chain", () => {
    expect(find(a(10))).toMatchObject([{ prime: PRIME, chain: "base", chainFrom: "title", kind: "monolithic", role: "controller" }]);
    expect(find(a(20))).toMatchObject([{ chain: "ethereum", kind: "monolithic", role: "controller" }]);
  });
  it("marks contracts under a Diamond section as diamond", () => {
    expect(find(a(30))).toMatchObject([{ kind: "diamond", role: "controller" }]);
    expect(find(a(31))).toMatchObject([{ kind: "diamond", role: "administeredAgent" }]);
  });
  it("reads a bare 'Address' leaf's role from its parent, and spreads an unchained multisig to every chain", () => {
    expect(find(a(40))).toMatchObject([{ role: "relayer", kind: null, chain: ANY_CHAIN }]);
  });
  it("keeps shared contracts on their address chain despite a 'Base Elements' ancestor", () => {
    expect(find(a(1))).toMatchObject([{ prime: null, role: "facet", chain: "ethereum", chainFrom: "address" }]);
    expect(find(a(2))).toMatchObject([{ prime: null, role: "beacon", chain: "ethereum" }]);
  });
  it("ignores addresses outside the PAU sections", () => {
    expect(find(a(50))).toEqual([]);
  });
});

describe("draftRegistry", () => {
  const draft = draftRegistry(obs, new Map([[PRIME, "Foo"]]), { shared: [], deployments: [], ignored: [] });
  const dep = (chain: string, kind: string) => draft.deployments.find((d) => d.chain === chain && d.kind === kind)!;
  it("groups observations into one deployment per chain and generation", () => {
    expect(draft.deployments.map((d) => `${d.chain}:${d.kind}`).sort()).toEqual(["base:monolithic", "ethereum:diamond", "ethereum:monolithic"]);
  });
  it("gives prime-wide multisigs only to deployments that list none of their own", () => {
    expect(dep("base", "monolithic").members.filter((m) => m.role === "relayer").map((m) => m.address)).toEqual([a(12)]);
    expect(dep("ethereum", "monolithic").members.filter((m) => m.role === "relayer").map((m) => m.address)).toEqual([a(40)]);
  });
  it("records atlas provenance with the doc UUID", () => {
    expect(dep("base", "monolithic").members[0].provenance).toEqual([{ source: "atlas", doc: uuid(13) }]);
  });
});
