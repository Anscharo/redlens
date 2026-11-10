// A role param's holder table split into rows: the lead's one address as the
// param's value, each holder's name against its address, and the note after.
import { describe, expect, it } from "vitest";
import { paramTable } from "./paramTable.ts";

const CURATOR = "The Curator role is held jointly by Soter Labs and Steakhouse Financial through the Curator Multisig at `0x622E19d6903BD4507cfc70b31d5B99535114C0FC`.\n\nThe co-curator addresses are:\n\n| Entity | Address |\n| --- | --- |\n| Soter Labs | `0xbCc126c3b6E2EbF0C895bb38c96D8afbEC126Ab3` |\n| Steakhouse Financial | `0x827e86072B06674a077f592A531dcE4590aDeCdB` |";
const ALLOCATOR = "The Allocator role is held by the following entities at the corresponding addresses:\n\n| Entity | Address |\n| --- | --- |\n| Steakhouse Financial | `0x0000aeB716a0DF7A9A1AAd119b772644Bc089dA8` |\n| Morpho Blue Public Allocator | `0x00b8e1509398ED692C3F326CbAf1694F9A881e27` |\n\nThe Morpho Blue Public Allocator is a permissionless contract.";

describe("paramTable", () => {
  it("takes the lead's one address as the value and each row as a holder", () => {
    expect(paramTable(CURATOR)).toEqual({
      lead: expect.stringContaining("Curator Multisig"), main: "0x622E19d6903BD4507cfc70b31d5B99535114C0FC", note: "",
      rows: [{ label: "Soter Labs", value: "0xbCc126c3b6E2EbF0C895bb38c96D8afbEC126Ab3" }, { label: "Steakhouse Financial", value: "0x827e86072B06674a077f592A531dcE4590aDeCdB" }],
    });
  });
  it("keeps the note after the table, and no value where the lead names no address", () => {
    expect(paramTable(ALLOCATOR)).toMatchObject({ main: null, note: "The Morpho Blue Public Allocator is a permissionless contract.", rows: [{ label: "Steakhouse Financial" }, { label: "Morpho Blue Public Allocator" }] });
  });
  it("is null for a value with no table", () => {
    expect(paramTable("`0x622E19d6903BD4507cfc70b31d5B99535114C0FC`")).toBeNull();
    expect(paramTable("a | b")).toBeNull();
  });
});
