// Vote-evidence storage, the public read, and the worker lane's gate and caches
// (sync-vote-evidence.ts). The storage functions take their `sql` tag as a
// parameter, so most tests pass an in-memory fake; handleVoteEvidence() reaches
// for the shared `sql`, which is why db.ts gets the module mock.
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "../pg-array.ts";

let row: Record<string, unknown> | null = null;
let cache = new Map<string, unknown>();
let readThrows = false;

const fakeSql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
  const text = strings.join("?");
  if (text.includes("INSERT INTO vote_evidence_cache")) return void cache.set(values[0] as string, values[1]);
  if (text.includes("FROM vote_evidence_cache")) return cache.has(values[0] as string) ? [{ result: cache.get(values[0] as string) }] : [];
  if (text.includes("INSERT INTO vote_evidence")) {
    row = { atlas_sha: values[0], claims: values[1], complete: values[2], computed_at: values[3] };
    return [];
  }
  if (text.includes("FROM vote_evidence")) {
    if (readThrows) throw new Error("db down");
    return row ? [row] : [];
  }
  return [];
};

mock.module("../db.ts", () => ({
  sql: fakeSql,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { cacheGet, cachePut, currentVoteEvidence, handleVoteEvidence, readVoteEvidence, writeVoteEvidence } = await import("./store.ts");
const { cachedFirstPr, cachedJudge, dueReason, laneSettings } = await import("../sync-vote-evidence.ts");

const NOW = Date.UTC(2026, 9, 7, 12);
const claims = { "d@2026-03-26#00000000": { status: "enacted", via: "date", vote: null, subject: null } };

beforeEach(() => {
  row = null;
  cache = new Map();
  readThrows = false;
});

describe("storage", () => {
  it("round-trips the overlay, reading a double-encoded claims column too", async () => {
    await writeVoteEvidence(fakeSql, { atlasSha: "abc", computedAt: new Date(NOW).toISOString(), claims: claims as never, complete: true });
    expect(row?.claims).toBe(claims); // the raw object, cast to jsonb by the driver
    expect(await readVoteEvidence(fakeSql)).toEqual({ atlasSha: "abc", computedAt: new Date(NOW).toISOString(), claims: claims as never, complete: true });
    row = { ...row, claims: JSON.stringify(claims), atlas_sha: null };
    expect((await readVoteEvidence(fakeSql))?.claims).toEqual(claims as never);
    expect(await cacheGet(fakeSql, "k")).toBeUndefined();
    await cachePut(fakeSql, "k", { pr: 7 });
    expect(await cacheGet<{ pr: number }>(fakeSql, "k")).toEqual({ pr: 7 });
  });
});

describe("handleVoteEvidence", () => {
  it("serves the overlay without its bookkeeping, and 503 before the first run or on a read failure", async () => {
    expect((await handleVoteEvidence()).status).toBe(503);
    row = { atlas_sha: "abc", claims, complete: false, computed_at: new Date(NOW) };
    const res = await handleVoteEvidence();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ atlasSha: "abc", computedAt: new Date(NOW).toISOString(), claims });
    readThrows = true;
    expect((await handleVoteEvidence()).status).toBe(503);
  });

  it("hands synchronous callers the last overlay read, refreshing it in the background", async () => {
    row = { atlas_sha: "abc", claims, complete: true, computed_at: new Date(NOW) };
    // Far past any read another test file started, so this call is the one that refreshes.
    const later = Date.now() + 1e9;
    currentVoteEvidence(fakeSql, later);
    await new Promise((r) => setTimeout(r, 0));
    expect(currentVoteEvidence(fakeSql, later + 1000)?.claims).toEqual(claims as never);
    row = null;
    expect(currentVoteEvidence(fakeSql, later + 2000)?.claims).toEqual(claims as never); // still fresh: no reread
  });
});

describe("the worker lane's gate", () => {
  const stored = (over: Record<string, unknown>) => (row = { atlas_sha: "abc", claims: {}, complete: true, computed_at: new Date(NOW - 60_000), ...over });

  it("runs on no row, an unfinished row, a new atlas commit or an old row, and otherwise waits", async () => {
    expect(await dueReason(fakeSql, "abc", 3600, NOW)).toBe("no row");
    stored({ complete: false });
    expect(await dueReason(fakeSql, "abc", 3600, NOW)).toBe("unfinished");
    stored({});
    expect(await dueReason(fakeSql, "def", 3600, NOW)).toBe("atlas moved");
    expect(await dueReason(fakeSql, "abc", 3600, NOW)).toBeNull();
    expect(await dueReason(fakeSql, "abc", 3600, NOW + 3600 * 1000)).toBe("stale");
  });

  it("reads its settings from the environment, judging with Jev by default", () => {
    expect(laneSettings({})).toEqual({ model: "typesafe/jev-1.13", perCycle: 80, refreshSeconds: 3600 });
    expect(laneSettings({ VOTE_EVIDENCE_MODEL: "", VOTE_EVIDENCE_PER_CYCLE: "0", VOTE_EVIDENCE_REFRESH_SECONDS: "60" })).toEqual({ model: "", perCycle: 0, refreshSeconds: 60 });
  });
});

describe("the worker lane's caches", () => {
  const run = (answers: Record<string, number>) => ({ answers: Object.fromEntries(Object.entries(answers).map(([k, noul]) => [k, { type: "noul", noul }])) });
  const Q = { carried: { type: "noul" as const, instructions: "?" } };

  it("asks the model once per request, within the cap, and caches only real answers", async () => {
    const ask = mock(async () => run({ carried: 0.9 }) as never);
    const judge = cachedJudge(fakeSql, "m", 1, Date.now() + 60_000, ask);
    expect(await judge({ s: 1 }, Q, "lane")).toEqual({ carried: 0.9 });
    expect(await judge({ s: 1 }, Q, "lane")).toEqual({ carried: 0.9 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await judge({ s: 2 }, Q, "lane")).toBeNull(); // over the cap
    const failing = cachedJudge(fakeSql, "m", 5, Date.now() + 60_000, mock(async () => { throw new Error("systemone 500"); }));
    expect(await failing({ s: 3 }, Q, "lane")).toBeNull();
    const refused = mock(async () => { throw Object.assign(new Error("systemone 402"), { fatal: true }); });
    const broke = cachedJudge(fakeSql, "m", 5, Date.now() + 60_000, refused);
    expect(await broke({ s: 6 }, Q, "lane")).toBeNull();
    expect(await broke({ s: 7 }, Q, "lane")).toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);
    const late = cachedJudge(fakeSql, "m", 5, Date.now() - 1, ask);
    expect(await late({ s: 4 }, Q, "lane")).toBeNull();
    const blank = cachedJudge(fakeSql, "m", 5, Date.now() + 60_000, mock(async () => run({}) as never));
    expect(await blank({ s: 5 }, Q, "lane")).toBeNull();
    expect(cache.size).toBe(1);
  });

  it("caches a found pull request but looks a miss up again", async () => {
    const lookup = mock((needle: string) => (needle === "found" ? 12 : null));
    const repo = new URL("../../..", import.meta.url).pathname;
    const firstPr = cachedFirstPr(fakeSql, repo, lookup);
    expect(await firstPr("found")).toBe(12);
    expect(await firstPr("found")).toBe(12);
    expect(await firstPr("missing")).toBeNull();
    expect(await firstPr("missing")).toBeNull();
    expect(lookup.mock.calls.map((c) => c[0])).toEqual(["found", "missing", "missing"]);
    expect(await cachedFirstPr(fakeSql, "/nonexistent-dir", lookup)("found")).toBeNull();
  });
});
