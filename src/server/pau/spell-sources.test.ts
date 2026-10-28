// The spell-source sync: it reads each origin's spell and star spell, and a
// spell a stored source declares, once; asks again for an unverified one only
// after UNVERIFIED_RETRY_MS; stops at its budget or on an explorer failure,
// leaving that spell queued; and merges what it stored for the namer.
import { describe, expect, it } from "bun:test";
import { MATERIAL_VERSION } from "./source-material.ts";
import { spellMaterial, spellsToRead, syncSpellSources, UNVERIFIED_RETRY_MS } from "./spell-sources.ts";

const [DSS, STAR, PAYLOAD, OLD] = ["0x" + "1d".repeat(20), "0x" + "5a".repeat(20), "0x" + "4a".repeat(20), "0x" + "0d".repeat(20)];
const NOW = Date.UTC(2026, 9, 28);
const empty = { names: [], addresses: [], words: [], spells: [] };

type Row = { address: string; contract_name: string; material: unknown; parser_version: number; fetched_at: Date };
function fakeDb(origins: { address: string }[], rows: Row[]) {
  const writes: unknown[][] = [];
  const db = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM pau_tx_origin")) return origins;
    if (text.includes("FROM pau_spell_sources")) return rows;
    if (text.includes("INSERT INTO pau_spell_sources")) {
      writes.push(v);
      rows.push({ address: v[1] as string, contract_name: v[2] as string, material: v[3], parser_version: v[4] as number, fetched_at: v[5] as Date });
    }
    return [];
  };
  return { db: db as never, writes };
}

describe("spellsToRead", () => {
  it("queues origins' spells and declared spells not yet stored, lowercased, and retries an unverified one only once it is old", async () => {
    const rows = [
      { address: DSS, contract_name: "DssSpell", material: JSON.stringify({ ...empty, spells: [PAYLOAD] }), parser_version: MATERIAL_VERSION, fetched_at: new Date(NOW) },
      { address: OLD, contract_name: "", material: empty, parser_version: MATERIAL_VERSION, fetched_at: new Date(NOW - UNVERIFIED_RETRY_MS) },
      { address: STAR, contract_name: "", material: empty, parser_version: MATERIAL_VERSION, fetched_at: new Date(NOW - 1000) },
    ];
    const { db } = fakeDb([{ address: DSS }, { address: STAR.toUpperCase().replace("0X", "0x") }, { address: OLD }, { address: "not an address" }], rows);
    expect(await spellsToRead(db, NOW)).toEqual([OLD, PAYLOAD].sort());
  });
  it("reads again a verified spell stored under another MATERIAL_VERSION", async () => {
    const rows = [{ address: DSS, contract_name: "DssSpell", material: empty, parser_version: MATERIAL_VERSION - 1, fetched_at: new Date(NOW) }];
    expect(await spellsToRead(fakeDb([{ address: DSS }], rows).db, NOW)).toEqual([DSS]);
  });
});

describe("syncSpellSources", () => {
  it("stores each source's material, stopping at the budget", async () => {
    const { db, writes } = fakeDb([{ address: DSS }, { address: STAR }], []);
    const fetch = async (a: string) => ({ contractName: "Spell", sourceCode: a === DSS ? `address internal constant SPARK_SPELL = ${PAYLOAD};` : "" });
    expect(await syncSpellSources(db, fetch, { deadline: NOW + 1, max: 1, now: () => NOW })).toEqual({ read: 1, pending: 1, error: null });
    const [chain, address, name, material, version, at] = writes[0];
    expect([chain, address, name, material, version, at]).toEqual(["ethereum", DSS, "Spell", { ...empty, addresses: [PAYLOAD], spells: [PAYLOAD] }, MATERIAL_VERSION, new Date(NOW)]);
    expect(await spellMaterial(db)).toEqual({ ...empty, addresses: [PAYLOAD], spells: [PAYLOAD] });
  });
  it("ends the run on an explorer failure and leaves that spell queued", async () => {
    const { db, writes } = fakeDb([{ address: DSS }, { address: STAR }], []);
    const fetch = async () => {
      throw new Error("etherscan rate limit");
    };
    expect(await syncSpellSources(db, fetch, { deadline: NOW + 60_000, max: 30, now: () => NOW })).toEqual({ read: 0, pending: 2, error: "etherscan rate limit" });
    expect(writes).toEqual([]);
  });
});
