// Unit tests for Phase 4.5 address enrichment (scripts/lib/graph-address-enrich.mjs).
// The five passes each only fill a gap the previous ones left open, so the
// tests below drive them one at a time (a fixture that would satisfy two
// passes proves neither) plus one combined run that pins the pass ORDER —
// which annotation wins when several could apply is the whole contract.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { enrichAddresses } from "../scripts/lib/graph-address-enrich.mjs";

const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";

function doc(doc_no: string, title: string, addressRefs: string[] = []): any {
  return { id: doc_no, doc_no, title, type: "Core", content: "", addressRefs };
}

function run(over: Partial<Record<string, any>> = {}) {
  const allDocs = over.allDocs ?? [];
  const addressesAtlas = over.addressesAtlas ?? {};
  const result = enrichAddresses({
    allDocs,
    docByDocNo: over.docByDocNo ?? new Map(allDocs.map((d: any) => [d.doc_no, d])),
    addressesAtlas,
    addressesOnChain: over.addressesOnChain ?? {},
    icdAnnotations: over.icdAnnotations ?? new Map(),
    entityMap: over.entityMap ?? new Map(),
    labelToAddresses: over.labelToAddresses ?? new Map(),
  });
  return { result, addressesAtlas };
}

describe("enrichAddresses — 4.5a ICD params", () => {
  it("merges roles, sets the label, and promotes an ICD-stated chain to primary", () => {
    const { result, addressesAtlas } = run({
      addressesAtlas: { [A1]: { chain: "ethereum", chains: ["ethereum"], roles: ["vault"] } },
      icdAnnotations: new Map([[A1, { roles: ["bridge"], entityLabel: "Spark USDS Bridge", chain: "avalanche" }]]),
    });
    expect(addressesAtlas[A1]).toEqual({
      chain: "avalanche",
      chains: ["avalanche", "ethereum"],
      roles: ["bridge", "vault"],
      entityLabel: "Spark USDS Bridge",
    });
    expect(result).toMatchObject({ icdUpdated: 1, icdRechained: 1, icdMissing: 0 });
  });

  it("keeps the chain when the ICD agrees, and seeds `chains` from `chain` when absent", () => {
    const { result, addressesAtlas } = run({
      addressesAtlas: { [A1]: { chain: "ethereum" } },
      icdAnnotations: new Map([[A1, { roles: [], entityLabel: null, chain: "ethereum" }]]),
    });
    expect(addressesAtlas[A1]).toMatchObject({ chain: "ethereum", chains: ["ethereum"], roles: [] });
    expect(addressesAtlas[A1].entityLabel).toBeUndefined(); // a null ICD label must not overwrite
    expect(result).toMatchObject({ icdUpdated: 1, icdRechained: 0 });
  });

  it("leaves the chain untouched when the ICD states none, and counts unknown addresses as missing", () => {
    const { result, addressesAtlas } = run({
      addressesAtlas: { [A1]: { chain: "ethereum", roles: ["vault"] } },
      icdAnnotations: new Map([
        [A1, { roles: ["vault"], entityLabel: "Keel Vault", chain: null }],
        [A2, { roles: ["bridge"], entityLabel: "Absent", chain: "base" }],
      ]),
    });
    expect(addressesAtlas[A1]).toEqual({ chain: "ethereum", roles: ["vault"], entityLabel: "Keel Vault" });
    expect(addressesAtlas[A2]).toBeUndefined();
    expect(result).toMatchObject({ icdUpdated: 1, icdMissing: 1 });
  });
});

describe("enrichAddresses — 4.5b entity-linked labels", () => {
  it("labels from the linked entity's name, and never overwrites an existing label", () => {
    const { result, addressesAtlas } = run({
      addressesAtlas: { [A1]: { chain: "ethereum" }, [A2]: { chain: "ethereum", entityLabel: "Already Set" } },
      entityMap: new Map([["grove", { name: "Grove" }]]),
      labelToAddresses: new Map([["grove", [{ addr: A1 }, { addr: A2 }]]]),
    });
    expect(addressesAtlas[A1].entityLabel).toBe("Grove");
    expect(addressesAtlas[A2].entityLabel).toBe("Already Set");
    expect(result).toMatchObject({ entityLabeled: 1 });
  });

  it("skips a label slug with no entity and an address with no atlas entry", () => {
    const { result, addressesAtlas } = run({
      addressesAtlas: {},
      entityMap: new Map([["grove", { name: "Grove" }]]),
      labelToAddresses: new Map([
        ["grove", [{ addr: A1 }]], // entity exists, address doesn't
        ["ghost", [{ addr: A2 }]], // address list for an entity that doesn't exist
      ]),
    });
    expect(addressesAtlas).toEqual({});
    expect(result).toMatchObject({ entityLabeled: 0 });
  });
});

describe("enrichAddresses — 4.5c generic 'Address' docs borrow the parent title", () => {
  it("labels from the doc_no parent, matching a mixed-case ref against the lower-cased key", () => {
    // Keys in addresses.atlas.json are lower-cased; a doc's addressRefs may be
    // checksummed — hence the `addr.toLowerCase()` lookup this asserts.
    const mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    const { result, addressesAtlas } = run({
      // A generic "Addresses" leaf under a named parent — the real shape 4.5c exists for.
      allDocs: [doc("A.6.1.1.3.2", "Keel Allocator Vault"), doc("A.6.1.1.3.2.1", " Addresses ", [mixed])],
      addressesAtlas: { [mixed.toLowerCase()]: { chain: "ethereum" } },
    });
    expect(addressesAtlas[mixed.toLowerCase()].entityLabel).toBe("Keel Allocator Vault");
    expect(result).toMatchObject({ parentLabeled: 1 });
  });

  it("skips a generic doc with no parent in the tree, and a non-generic title", () => {
    const { result, addressesAtlas } = run({
      // "A.9" has no parent doc_no in docByDocNo; the second doc's title isn't generic,
      // so 4.5c ignores it (4.5d picks it up instead — asserted below).
      allDocs: [doc("A.9", "Address", [A1]), doc("A.8", "Sky Core", [A2])],
      addressesAtlas: { [A1]: { chain: "ethereum" }, [A2]: { chain: "ethereum" } },
    });
    expect(addressesAtlas[A1].entityLabel).toBeUndefined();
    expect(addressesAtlas[A2].entityLabel).toBe("Sky Core");
    expect(result).toMatchObject({ parentLabeled: 0, titleLabeled: 1 });
  });
});

describe("enrichAddresses — 4.5d doc titles and 4.5e on-chain fallback", () => {
  it("skips container titles ('Address', 'Parameters') and docs with no address refs", () => {
    const { result, addressesAtlas } = run({
      allDocs: [doc("A.1", "Parameters", [A1]), doc("A.2", "Sky Core", [])],
      addressesAtlas: { [A1]: { chain: "ethereum" } },
    });
    expect(addressesAtlas[A1].entityLabel).toBeUndefined();
    expect(result).toMatchObject({ titleLabeled: 0 });
  });

  it("falls back to chainlogId, then etherscanName, only for still-unlabelled addresses", () => {
    const { result, addressesAtlas } = run({
      addressesAtlas: {
        [A1]: { chain: "ethereum" },
        [A2]: { chain: "ethereum" },
        "0x3333333333333333333333333333333333333333": { chain: "ethereum", entityLabel: "Kept" },
      },
      addressesOnChain: {
        [A1]: { chainlogId: "MCD_VAT", etherscanName: "Vat" }, // chainlog wins
        [A2]: { etherscanName: "DssVest" },
        "0x3333333333333333333333333333333333333333": { chainlogId: "MCD_JUG" },
      },
    });
    expect(addressesAtlas[A1].entityLabel).toBe("MCD_VAT");
    expect(addressesAtlas[A2].entityLabel).toBe("DssVest");
    expect(addressesAtlas["0x3333333333333333333333333333333333333333"].entityLabel).toBe("Kept");
    expect(result).toMatchObject({ chainlogFallback: 2 });
  });

  it("leaves an address with no on-chain row unlabelled", () => {
    const { result, addressesAtlas } = run({ addressesAtlas: { [A1]: { chain: "ethereum" } } });
    expect(addressesAtlas[A1].entityLabel).toBeUndefined();
    expect(result).toEqual({
      icdUpdated: 0, icdMissing: 0, icdRechained: 0,
      entityLabeled: 0, parentLabeled: 0, titleLabeled: 0, chainlogFallback: 0,
    });
  });
});

describe("enrichAddresses — pass order", () => {
  it("earlier passes win: ICD label beats entity link beats parent title beats doc title beats chainlog", () => {
    // Every pass could label A1; only 4.5a's label may survive. A2 is offered
    // to 4.5b onwards, A3 to 4.5c onwards, and so on down the ladder.
    const A3 = "0x3333333333333333333333333333333333333333";
    const A4 = "0x4444444444444444444444444444444444444444";
    const A5 = "0x5555555555555555555555555555555555555555";
    const allDocs = [
      doc("A.1", "Parent Of Generic"),
      doc("A.1.1", "Address", [A1, A2, A3]),
      doc("A.2", "Doc Title Label", [A1, A2, A3, A4]),
    ];
    const { result, addressesAtlas } = run({
      allDocs,
      addressesAtlas: Object.fromEntries([A1, A2, A3, A4, A5].map((a) => [a, { chain: "ethereum" }])),
      icdAnnotations: new Map([[A1, { roles: [], entityLabel: "ICD Label", chain: null }]]),
      entityMap: new Map([["ent", { name: "Entity Label" }]]),
      labelToAddresses: new Map([["ent", [{ addr: A1 }, { addr: A2 }]]]),
      addressesOnChain: Object.fromEntries([A1, A2, A3, A4, A5].map((a) => [a, { chainlogId: "CHAINLOG" }])),
    });
    expect([A1, A2, A3, A4, A5].map((a) => addressesAtlas[a].entityLabel)).toEqual([
      "ICD Label",
      "Entity Label",
      "Parent Of Generic",
      "Doc Title Label",
      "CHAINLOG",
    ]);
    expect(result).toMatchObject({ icdUpdated: 1, entityLabeled: 1, parentLabeled: 1, titleLabeled: 1, chainlogFallback: 1 });
  });
});
