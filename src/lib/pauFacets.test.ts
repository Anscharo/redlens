// The facets a Diamond PAU's controller uses, each beside the Atlas ceiling
// document found by name: alphabetical, with the ceiling's amounts when the
// document states them and none when it defers them.
import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types.ts";
import { facetRows, integrationName } from "./pauFacets.ts";

const id = (s: string) => "0x" + [...s].map((c) => c.charCodeAt(0).toString(16)).join("").padEnd(64, "0");
const integration = (name: string, facet: string) => ({ id: id(name), config: { facet }, setAt: { tx: "0xt", time: "2026-06-12T00:00:00.000Z", block: 1 } });
const doc = (docId: string, title: string, content: string) => [docId, { id: docId, title, content } as AtlasNode] as const;

const docs = Object.fromEntries([
  doc("usds", "Highest Production Rate Limit For USDS Facet", "The USDS Facet's highest production rate limit is:\n\n- Mint\n    - `maxAmount`: 50,000,000 USDS\n    - `slope`: 50,000,000 USDS per day\n- Burn\n    - `maxAmount`: Unlimited"),
  doc("aave", "Highest Production Rate Limit For Aave v3 Facet", "- Deposit\n    - `maxAmount`: 50,000,000 USDS"),
  doc("cctp", "Highest Production Rate Limit For CCTP Facet", "Further details will be specified in a future iteration of the Atlas."),
]);
const snap = (...integrations: ReturnType<typeof integration>[]) => ({ contracts: [{ integrations }] }) as unknown as Parameters<typeof facetRows>[0];

describe("facetRows", () => {
  it("reads an integration id as its text", () => {
    expect(integrationName(id("USDS_FACET"))).toBe("USDS_FACET");
  });
  it("lists the facets alphabetically with the ceiling the Atlas states", () => {
    const rows = facetRows(snap(integration("USDS_FACET", "0x1"), integration("AAVE_FACET", "0x2"), integration("CCTP_FACET", "0x3")), docs);
    expect(rows.map((r) => [r.name, r.ceiling?.docId, r.ceiling?.text])).toEqual([
      ["Aave v3 Facet", "aave", "Deposit 50,000,000 USDS"],
      ["CCTP Facet", "cctp", null],
      ["USDS Facet", "usds", "Mint 50,000,000 USDS · Burn unlimited"],
    ]);
  });
  it("spells out the id and gives no ceiling where no document names the facet", () => {
    const [row] = facetRows(snap(integration("ERC4626_FACET", "0x4")), docs);
    expect([row.name, row.ceiling]).toEqual(["ERC4626 Facet", null]);
  });
  it("gives no ceiling before the documents load, and skips an integration naming no facet", () => {
    const rows = facetRows(snap(integration("USDS_FACET", "0x1"), { ...integration("X", "0x"), config: {} as { facet: string } }), null);
    expect(rows.map((r) => [r.name, r.ceiling])).toEqual([["USDS Facet", null]]);
  });
});
