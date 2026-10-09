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
  const NOW = Date.parse("2026-10-09T12:00:00Z");
  const unread = { done: null, expiration: null };
  it("verifies only a spell cast on or after the vote's date", () => {
    expect(verdictFor(f, "2024-09-09T14:00:00.000Z", unread, NOW).status).toBe("verified");
    expect(verdictFor(f, "2024-09-01T14:00:00.000Z", unread, NOW).status).toBe("rejected");
  });
  it("rejects an uncast spell only when its own contract says it never will be cast", () => {
    const expired = verdictFor(f, null, { done: false, expiration: Date.parse("2024-10-03T00:00:00Z") / 1000 }, NOW);
    expect(expired).toMatchObject({ status: "rejected", reason: `spell ${SPELL} expired on 2024-10-03 without being cast` });
    expect(verdictFor(f, null, { done: false, expiration: null }, NOW).reason).toMatch(/not cast as of 2026-10-09, and has no expiration\(\)/);
    const castable = verdictFor(f, null, { done: false, expiration: Date.parse("2026-11-01T00:00:00Z") / 1000 }, NOW);
    expect(castable).toMatchObject({ status: "pending", reason: `spell ${SPELL} is not cast yet and can be until 2026-11-01` });
    expect(verdictFor(f, null, { done: true, expiration: null }, NOW).reason).toMatch(/reports done\(\); its cast is not in the cast list yet/);
    expect(verdictFor(f, null, unread, NOW).status).toBe("pending");
  });
  it("rejects a file with no spell address", () => {
    expect(verdictFor({ ...f, spell: null }, null, unread, NOW).reason).toMatch(/no spell address/);
  });
});

function fakeDb(count: number, first: Date | null = new Date("2024-09-09T14:00:00Z")) {
  const writes: unknown[][] = [];
  const db = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("count(*)::int AS n FROM executive_archive")) return [{ n: count }];
    if (text.includes("SELECT file FROM executive_archive")) return [{ file: "Executive vote - September 5, 2024.md" }];
    if (text.includes("min(block_time)")) return [{ first }];
    writes.push([text, ...v]);
    return [];
  };
  return { db, writes };
}

const unreadSpell = async () => ({ done: null, expiration: null });

describe("backfillArchive", () => {
  it("refuses a listing too short to be the archive, and writes nothing", async () => {
    const { db, writes } = fakeDb(0);
    const deps = { fetchJson: async () => [{ name: "Executive vote - May 1, 2025.md" }], fetchText: async () => MD, spellState: unreadSpell };
    await expect(backfillArchive(db, deps, 3)).rejects.toThrow(/expected 100/);
    expect(writes).toEqual([]);
  });
  it("stores a verified title, and keeps a file pending when its fetch fails", async () => {
    const ok = fakeDb(229);
    const run = await backfillArchive(ok.db, { fetchJson: async () => [], fetchText: async () => MD, spellState: unreadSpell }, 3);
    expect(run).toMatchObject({ listed: 0, checked: 1, verified: 1 });
    expect(ok.writes.find((w) => String(w[0]).includes("UPDATE"))).toContain("Launch Project Funding and Spark Proxy Spell - September 5, 2024");
    const failing = fakeDb(229);
    const down = await backfillArchive(failing.db, { fetchJson: async () => [], fetchText: async () => Promise.reject(new Error("HTTP 503")), spellState: unreadSpell }, 3);
    expect(down.verified).toBe(0);
    expect(failing.writes.find((w) => String(w[0]).includes("UPDATE"))).toContain("pending");
  });
  it("lists the whole archive in one statement", async () => {
    const { db, writes } = fakeDb(0);
    const files = Array.from({ length: 120 }, (_, i) => ({ name: `Executive vote - May ${i}, 2020.md` }));
    const run = await backfillArchive(db, { fetchJson: async () => files, fetchText: async () => MD, spellState: unreadSpell }, 0);
    const inserts = writes.filter((w) => String(w[0]).includes("INSERT INTO executive_archive"));
    expect(run.listed).toBe(120);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toHaveLength(120);
  });
  it("rejects an uncast spell that expired, reading its state only when no cast is recorded", async () => {
    const asked: string[] = [];
    const uncast = fakeDb(229, null);
    const spellState = async (spell: string) => (asked.push(spell), { done: false, expiration: Date.parse("2024-10-03T00:00:00Z") / 1000 });
    await backfillArchive(uncast.db, { fetchJson: async () => [], fetchText: async () => MD, spellState }, 3);
    expect(uncast.writes.find((w) => String(w[0]).includes("UPDATE"))).toContain(`spell ${SPELL} expired on 2024-10-03 without being cast`);
    expect(asked).toEqual([SPELL]);
    const cast = fakeDb(229);
    await backfillArchive(cast.db, { fetchJson: async () => [], fetchText: async () => MD, spellState }, 3);
    expect(asked).toEqual([SPELL]);
  });
});
