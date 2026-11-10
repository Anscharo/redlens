// Filling atlas_prs.spell_refs and keeping each change linked to its PR: a
// read PR's spells and missing metadata stored, one without a record touched
// and left unread, and stored changes given the PR their commit names. The
// SQL itself is checked against a real Postgres (src/server/history/CLAUDE.md).
import { describe, expect, it } from "bun:test";
import { SPELL_REFS_VERSION } from "../../lib/atlasPrSpell.ts";
import { backfillPrNumbers, fillPrSpells, prBackfillDue } from "./pr-spells.ts";

function fakeDb(answer: (sql: string) => unknown[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ sql, values });
    return Promise.resolve(answer(sql));
  };
  return { db, calls };
}

describe("fillPrSpells", () => {
  it("stores what each PR names with its missing metadata, and leaves one without a record unread", async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith("SELECT") ? [{ pr_number: 363 }, { pr_number: 362 }, { pr_number: 999 }] : []));
    const records: Record<number, { title: string; body: string; url: string; author: string }> = {
      363: { title: "Grove proposal - [Base] Raise the deposit rate limit", body: "Originating forum post: https://forum.skyeco.com/t/november-5-2026-proposed-changes-to-grove-for-upcoming-spell/28336/", url: "u363", author: "a" },
      362: { title: "Spark proposal - Morpho Vault Timelock Compliance", body: "https://forum.skyeco.com/t/technical-scope-morpho-vault-timelock-compliance/28302", url: "u362", author: "b" },
    };
    const r = await fillPrSpells(db as never, async (pr) => records[pr] ?? null, 10);
    expect(r).toEqual({ read: 2, named: 1, missing: 1 });
    expect(calls[0].values).toEqual([SPELL_REFS_VERSION, 10]);
    const writes = calls.slice(1);
    expect(writes.map((w) => w.values)).toEqual([
      [["thread:2026-11-05"], SPELL_REFS_VERSION, records[363].title, "u363", "a", null, null, null, 363],
      [[], SPELL_REFS_VERSION, records[362].title, "u362", "b", null, null, null, 362],
      [999],
    ]);
    expect(writes[2].sql).not.toContain("spell_refs");
  });
  it("ends the run at the first record it cannot read, when told to", async () => {
    const { db } = fakeDb((sql) => (sql.startsWith("SELECT") ? [{ pr_number: 1 }, { pr_number: 2 }] : []));
    const asked: number[] = [];
    expect(await fillPrSpells(db as never, async (pr) => (asked.push(pr), null), 10, true)).toEqual({ read: 0, named: 0, missing: 1 });
    expect(asked).toEqual([1]);
  });
});

describe("prBackfillDue", () => {
  it("is the atlas commit until the backfill has run at it", async () => {
    expect(await prBackfillDue(fakeDb(() => [{ atlas_sha: "abc", pr_backfill_sha: null }]).db as never)).toBe("abc");
    expect(await prBackfillDue(fakeDb(() => [{ atlas_sha: "abc", pr_backfill_sha: "abc" }]).db as never)).toBeNull();
  });
});

describe("backfillPrNumbers", () => {
  it("gives git-era rows the PR their commit names, and adds a PR row for each", async () => {
    const { db, calls } = fakeDb((sql) => (sql.startsWith("UPDATE") ? [{ pr_number: 369 }, { pr_number: 369 }, { pr_number: 363 }] : []));
    expect(await backfillPrNumbers(db as never, new Map([["315676e", 369], ["3deadd4", 368], ["not-a-sha", 1]]))).toBe(3);
    expect(calls[0].values).toEqual(["{315676e,3deadd4}", "{369,368}"]);
    expect(calls[0].sql).toContain("h.pr_number IS NULL AND h.era IS NULL");
    expect(calls[1].values).toEqual(["{369,363}"]);
  });
  it("does nothing without commits", async () => {
    const { db, calls } = fakeDb(() => []);
    expect(await backfillPrNumbers(db as never, new Map())).toBe(0);
    expect(calls).toEqual([]);
  });
});
