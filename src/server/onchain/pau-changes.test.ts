// atlas_pau_changes: one prime's configuration changes, newest first, and the
// queued steps that belong to it. The history is injected; no database.
import { describe, expect, it, mock } from "bun:test";
import type { PauHistoryEntry, PauHistoryResponse } from "../../lib/pauHistory.ts";
import { buildIndexes, type Entity } from "../retrieval/indexes.ts";

const PRIME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SPELL = "0x" + "ab".repeat(20);
const TX = "0x" + "1".repeat(64);

const change = (event: string): PauHistoryEntry["changes"][number] => ({
  deployments: [], contract: "0x" + "b".repeat(40), role: "rateLimits", event, args: { maxAmount: "5" }, subject: "0xk", label: null, before: { maxAmount: "1" },
});

const entry = (over: Partial<PauHistoryEntry> & Pick<PauHistoryEntry, "tx" | "time" | "primes" | "origin">): PauHistoryEntry => ({
  chain: "ethereum", block: 1, executive: null, changes: [change("RateLimitDataSet")], ...over,
});

const HISTORY: PauHistoryResponse = {
  entries: [
    entry({ tx: TX, time: "2026-04-01T00:00:00.000Z", primes: [PRIME], origin: { kind: "spell", path: "starguard", spell: SPELL, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "StarGuard exec" }, executive: { title: "Prime Agent Proxy Spells", date: "2026-04-09", url: "https://vote.sky.money/x", source: "vote-record" } }),
    entry({ tx: "0x" + "2".repeat(64), time: "2026-05-01T00:00:00.000Z", chain: "base", primes: [PRIME], origin: { kind: "operator", path: null, spell: null, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "Configurator" } }),
    entry({ tx: "0x" + "4".repeat(64), time: "2026-03-01T00:00:00.000Z", primes: [OTHER], origin: { kind: "spell", path: "direct", spell: SPELL, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "cast" } }),
  ],
  queued: [
    { kind: "star-spell", chain: "ethereum", contract: "0x" + "d".repeat(40), id: SPELL, tx: "0x" + "3".repeat(64), time: "2026-06-01T00:00:00.000Z", at: null, primes: [PRIME] },
    { kind: "action-set", chain: "base", contract: "0x" + "e".repeat(40), id: "4", tx: "0x" + "5".repeat(64), time: "2026-06-02T00:00:00.000Z", at: null, primes: [] },
  ],
};

let fail = false;
mock.module("../pau/history.ts", () => ({
  currentPauHistory: async () => {
    if (fail) throw new Error("down");
    return HISTORY;
  },
}));

const { pauChanges } = await import("./pau-changes.ts");

const ent = (id: string, slug: string, name: string): Entity => ({ id, slug, name, entity_type: "agent", subtype: "prime", defining_doc_id: id, is_active: 1, meta: null });
const ix = buildIndexes([], [ent(PRIME, "osero", "Osero"), ent(OTHER, "grove", "Grove")], [], {});

describe("pauChanges", () => {
  it("returns one prime's changes newest first, with its queued spell, and not a shared executor's queue", async () => {
    const res = await pauChanges(ix, { entity: "osero", limit: 20 }) as { count: number; changes: { time: string; url: string; origin: { kind: string } }[]; queued: { id: string }[] };
    expect(res.count).toBe(2);
    expect(res.changes.map((c) => c.time)).toEqual(["2026-05-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"]);
    expect(res.changes[1].url).toBe(`https://etherscan.io/tx/${TX}`);
    expect(res.queued.map((q) => q.id)).toEqual([SPELL]);
  });

  it("keeps spells, matches a spell address in any case, and drops the queue for an operator filter", async () => {
    const spells = await pauChanges(ix, { entity: "Osero", origin: "spell", spell: SPELL.toUpperCase(), limit: 20 }) as { changes: { origin: { spell: string } }[]; queued: unknown[] };
    expect(spells.changes.map((c) => c.origin.spell)).toEqual([SPELL]);
    expect(spells.queued).toHaveLength(1);
    const ops = await pauChanges(ix, { entity: "osero", origin: "operator", query: "configurator", limit: 20 }) as { changes: { chain: string }[]; queued: unknown[] };
    expect(ops.changes.map((c) => c.chain)).toEqual(["base"]);
    expect(ops.queued).toEqual([]);
  });

  it("refuses an unknown prime, and says when the history cannot be built", async () => {
    expect(await pauChanges(ix, { entity: "no-such", limit: 5 })).toMatchObject({ error: expect.stringContaining("no-such") });
    fail = true;
    expect(await pauChanges(ix, { limit: 5 })).toMatchObject({ error: expect.stringContaining("down") });
    fail = false;
  });
});
