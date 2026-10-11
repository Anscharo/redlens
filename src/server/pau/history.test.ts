// GET /api/pau/history: rows from the three tables folded into entries, the
// executive taken from the vote record before the archive, prime-less changes
// left out, and the body gzipped for a client that accepts it.
import { beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { fromUuidArray, toUuidArrayLiteral } from "../pg-array.ts";

const SPELL = "0x70da14478667c08320ef65506063abba84b6990f";
const OLD = "0xd442ea4b93712762e337c1e15f367f0b1050fea4";
const RL = "0x7a5fd5cf045e010e62147f065ceae59e5344b188"; // Spark's Ethereum RateLimits in the registry
const row = (tx: string, contract = RL) => ({ chain: "ethereum", tx_hash: tx, contract, event: "RateLimitDataSet", args: { key: "0xk", maxAmount: "1", slope: "0" }, block: "1", block_time: new Date("2026-04-13T14:16:47Z") });
const origin = (tx: string, spell: string) => ({ chain: "ethereum", tx_hash: tx, kind: "spell", path: "starguard", spell, star_spell: null, l1_tx: tx, tx_from: null, tx_to: null, relay: null, evidence: "e" });

let failing = false;
let inputs = "v1";
let eventReads = 0;
mock.module("../db.ts", () => ({
  sql: async (strings: TemplateStringsArray) => {
    if (failing) throw new Error("down");
    const text = strings.join("?");
    if (text.includes("events_version")) return [{ events_version: inputs }];
    if (text.includes("FROM pau_events")) {
      eventReads++;
      return [row("0xa"), row("0xb"), row("0xc", "0x" + "9".repeat(40))];
    }
    if (text.includes("FROM pau_tx_origin")) return [origin("0xa", SPELL), origin("0xb", OLD)];
    if (text.includes("FROM executive_archive")) return [{ file: "Executive vote - November 14, 2024.md", spell: OLD, title: "Old", date: "2024-11-14" }];
    return [];
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed (see pg-array.ts).
  toUuidArrayLiteral,
  fromUuidArray,
}));
const votes = () => ({ executives: [{ spell: SPELL, title: "Prime Agent Proxy Spells", date: "2026-04-09", url: "https://vote.sky.money/executive/x" }] });

const { handlePauHistory, readPauHistory, resetPauHistoryCache } = await import("./history.ts");
const { sql } = await import("../db.ts");

beforeEach(() => {
  resetPauHistoryCache();
  setSystemTime();
  inputs = "v1";
  eventReads = 0;
});

describe("readPauHistory / handlePauHistory", () => {
  it("serves each entry with its executive, leaving out changes that belong to no prime", async () => {
    const body = await readPauHistory(sql, votes);
    expect(body.entries.map((e) => e.tx)).toEqual(["0xa", "0xb"]);
    expect(body.entries[0].executive).toMatchObject({ title: "Prime Agent Proxy Spells", source: "vote-record" });
    expect(body.entries[1].executive).toMatchObject({ title: "Old", source: "archive", url: expect.stringContaining("Executive%20vote") });
  });
  it("gzips for a client that accepts it, and answers 503 when the database is down", async () => {
    const res = await handlePauHistory(new Request("http://x/api/pau/history", { headers: { "accept-encoding": "gzip, br" } }));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())))).entries).toHaveLength(2);
    resetPauHistoryCache();
    failing = true;
    expect((await handlePauHistory()).status).toBe(503);
    failing = false;
  });
  it("builds the history once per change of its inputs, asking whether they changed at most once a minute", async () => {
    const t0 = new Date("2026-10-11T12:00:00Z");
    setSystemTime(t0);
    expect(((await (await handlePauHistory()).json()) as { entries: unknown[] }).entries).toHaveLength(2);
    await Promise.all([handlePauHistory(), handlePauHistory()]);
    setSystemTime(new Date(t0.getTime() + 61_000));
    await handlePauHistory();
    expect(eventReads).toBe(1);
    inputs = "v2";
    await handlePauHistory();
    expect(eventReads).toBe(1);
    setSystemTime(new Date(t0.getTime() + 122_000));
    await handlePauHistory();
    expect(eventReads).toBe(2);
  });
});
