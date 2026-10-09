// The DSPause cast list: the spell is the LogNote's caller, the cursor only
// advances on a successful read, and "not a cast" is said only past the cursor.
import { describe, expect, it } from "bun:test";
import { CONFIRMATIONS } from "./sync-events.ts";
import { EXEC_NOTE, castIn, spellOfNote, syncSpellCasts } from "./casts.ts";

const SPELL = "0xb26b9d89776aa9e74dda0e86e916413def03f59b";
const note = { topics: [EXEC_NOTE, `0x000000000000000000000000${SPELL.slice(2).toUpperCase()}`, "0x01"], blockNumber: 23_000_000, timeStamp: 1_755_000_000, transactionHash: "0xABC" };

function fakeDb(cursor: number | null, casts: Record<string, string> = {}) {
  const writes: unknown[][] = [];
  const db = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT next_block FROM spell_cast_cursor")) return cursor === null ? [] : [{ next_block: String(cursor) }];
    if (text.includes("SELECT spell FROM spell_casts")) return casts[String(v[0])] ? [{ spell: casts[String(v[0])] }] : [];
    writes.push([text.includes("INSERT INTO spell_casts") ? "cast" : "cursor", ...v]);
    return text.includes("RETURNING") ? [{ tx_hash: v[0] }] : [];
  };
  return { db, writes };
}

describe("syncSpellCasts", () => {
  it("stores each exec note's caller as the spell and moves the cursor past the confirmed head", async () => {
    const { db, writes } = fakeDb(null);
    const res = await syncSpellCasts(db, { notes: async () => [note, { ...note, topics: ["0xother", note.topics[1]] }], head: async () => 23_000_100 });
    expect(spellOfNote(note)).toBe(SPELL);
    expect(res).toEqual({ added: 1, nextBlock: 23_000_100 - CONFIRMATIONS + 1, error: null });
    expect(writes[0]).toEqual(["cast", "0xabc", SPELL, 23_000_000, new Date(1_755_000_000_000)]);
  });
  it("keeps the cursor and records why when the read fails", async () => {
    const { db, writes } = fakeDb(500);
    const res = await syncSpellCasts(db, { notes: async () => null, head: async () => 10_000 });
    expect(res).toEqual({ added: 0, nextBlock: 500, error: "no explorer serves ethereum" });
    expect(writes[0].slice(0, 2)).toEqual(["cursor", 500]);
  });
});

describe("castIn", () => {
  it("names the spell, says none only past the cursor, and does not know before it", async () => {
    expect(await castIn(fakeDb(100, { "0xa": SPELL }).db, "0xa", 50)).toBe(SPELL);
    expect(await castIn(fakeDb(100).db, "0xb", 50)).toBeNull();
    expect(await castIn(fakeDb(100).db, "0xb", 150)).toBeUndefined();
  });
});
