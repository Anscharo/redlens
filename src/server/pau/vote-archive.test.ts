// The executive archive: what a makerdao/community file says, what the chain
// lets it keep, and that a short listing or a failed fetch never shrinks or
// rejects anything.
import { describe, expect, it } from "bun:test";
import { readFrontmatterFields, verdictFor } from "./vote-archive-parse.ts";
import { backfillArchive } from "./vote-archive.ts";

const MD = `---
title: Template - [Executive Vote] Launch Project Funding and Spark Proxy Spell - September 5, 2024
summary: Transfer DAI and MKR.
date: 2024-09-05T00:00:00.000Z
address: "0x900c952c676595DdB392FA6349aD5f0674a67Eeb"

---
# body`;
const SPELL = "0x900c952c676595ddb392fa6349ad5f0674a67eeb";

describe("readFrontmatterFields / verdictFor", () => {
  const f = readFrontmatterFields(MD);
  it("keeps what the vote does, its date and its spell", () => {
    expect(f).toEqual({ spell: SPELL, title: "Launch Project Funding and Spark Proxy Spell - September 5, 2024", date: "2024-09-05" });
  });
  it("verifies only a spell cast on or after the vote's date", () => {
    expect(verdictFor(f, { first: "2024-09-09T14:00:00.000Z", casts: true }).status).toBe("verified");
    expect(verdictFor(f, { first: "2024-09-01T14:00:00.000Z", casts: true }).status).toBe("rejected");
    expect(verdictFor(f, { first: null, casts: true }).reason).toMatch(/never cast/);
    expect(verdictFor(f, { first: null, casts: false }).status).toBe("pending");
    expect(verdictFor({ ...f, spell: null }, { first: null, casts: true }).reason).toMatch(/no spell address/);
  });
});

function fakeDb(count: number) {
  const writes: unknown[][] = [];
  const db = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("count(*)::int AS n FROM executive_archive")) return [{ n: count }];
    if (text.includes("SELECT file FROM executive_archive")) return [{ file: "Executive vote - September 5, 2024.md" }];
    if (text.includes("min(block_time)")) return [{ first: new Date("2024-09-09T14:00:00Z") }];
    if (text.includes("spell_cast_cursor")) return [{ next_block: "20000000" }];
    writes.push([text, ...v]);
    return [];
  };
  return { db, writes };
}

describe("backfillArchive", () => {
  it("refuses a listing too short to be the archive, and writes nothing", async () => {
    const { db, writes } = fakeDb(0);
    const deps = { fetchJson: async () => [{ name: "Executive vote - May 1, 2025.md" }], fetchText: async () => MD };
    await expect(backfillArchive(db, deps, 3)).rejects.toThrow(/expected 100/);
    expect(writes).toEqual([]);
  });
  it("stores a verified title, and keeps a file pending when its fetch fails", async () => {
    const ok = fakeDb(229);
    const run = await backfillArchive(ok.db, { fetchJson: async () => [], fetchText: async () => MD }, 3);
    expect(run).toMatchObject({ listed: 0, checked: 1, verified: 1 });
    expect(ok.writes.find((w) => String(w[0]).includes("UPDATE"))).toContain("Launch Project Funding and Spark Proxy Spell - September 5, 2024");
    const failing = fakeDb(229);
    const down = await backfillArchive(failing.db, { fetchJson: async () => [], fetchText: async () => Promise.reject(new Error("HTTP 503")) }, 3);
    expect(down.verified).toBe(0);
    expect(failing.writes.find((w) => String(w[0]).includes("UPDATE"))).toContain("pending");
  });
});
