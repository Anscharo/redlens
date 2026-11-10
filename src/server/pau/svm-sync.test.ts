// syncSvmHistory against an in-memory pau_svm_cursor and pau_events, with
// mainnet's EmitEvent data (svm-events.fixture.json). Pinned: a cold cursor
// starts at the first slot HyperSync holds; only configuration events of a
// listed controller are stored, as objects; reaching the confirmed head stamps
// reached_at; a failure is stored and a rate limit is not; the deadline stops
// the read between queries; a change of controllers re-reads from the start.
import { beforeEach, describe, expect, it } from "bun:test";
import fixture from "./svm-events.fixture.json" with { type: "json" };
import type { PauDeployment, PauRegistry } from "../../lib/pauRegistry.ts";
import registry from "../../data/pau-registry.json" with { type: "json" };
import { SVM_CONFIRMATIONS, syncSvmHistory, type SvmSyncDeps } from "./svm-sync.ts";
import type { SvmEmit, SvmEventSource } from "./svm-hypersync.ts";

const keel = (registry.deployments as PauDeployment[]).find((d) => d.kind === "svm")!;
const reg = { shared: [], ignored: [], deployments: [keel] } as unknown as PauRegistry;
const data = (prefix: string) => Object.entries(fixture as Record<string, { emits: string[] }>).find(([s]) => s.startsWith(prefix))![1].emits;
const HEIGHT = 10_000 + SVM_CONFIRMATIONS;
const EMITS: SvmEmit[] = [
  { slot: 2_000, time: 1_763_055_466, signature: "sigReserve", index: 0, data: data("3hC1ZZhF")[0] },
  { slot: 6_000, time: 1_769_450_220, signature: "sigOps", index: 0, data: data("3uHcUyk1")[0] },
  { slot: 9_000, time: 1_770_835_732, signature: "sigFreeze", index: 0, data: data("5oRUDfcB")[0] },
];

type Row = Record<string, unknown>;
let cursor: Row | null;
let events: Row[];
const db = async (strings: TemplateStringsArray, ...v: unknown[]): Promise<unknown> => {
  const t = strings.join("?");
  if (t.includes("FROM pau_svm_cursor")) return cursor ? [{ ...cursor }] : [];
  if (t.includes("INSERT INTO pau_svm_cursor")) return void (cursor = { ...(cursor ?? { start_time: v[4] }), controllers: v[2], start_slot: cursor?.start_slot ?? v[3], next_slot: v[5], reached_at: null });
  if (t.includes("UPDATE pau_svm_cursor")) return void Object.assign(cursor!, { next_slot: v[0], reached_at: v[1], last_error: v[3] });
  if (t.includes("INSERT INTO pau_events")) return void events.push({ tx: v[1], contract: v[3], event: v[4], args: v[5], block: v[6] });
  throw new Error(`unexpected SQL: ${t}`);
};

let queries: number[];
const source = (over: Partial<SvmEventSource> = {}): SvmEventSource => ({
  url: "hs",
  height: async () => HEIGHT,
  firstHeld: async () => ({ slot: 1_000, time: 1_767_425_822 }),
  emits: async (_p, from, to) => {
    queries.push(from);
    const next = Math.min(from + 4_000, to + 1);
    return { emits: EMITS.filter((e) => e.slot >= from && e.slot < next), next };
  },
  ...over,
});
const deps = (over: Partial<SvmSyncDeps> = {}, src: Partial<SvmEventSource> = {}): SvmSyncDeps => ({ source: () => source(src), deadline: Infinity, now: () => 5_000, ...over });

beforeEach(() => {
  cursor = null;
  events = [];
  queries = [];
});

describe("syncSvmHistory", () => {
  it("reads from the first held slot to the confirmed head, storing the listed controller's configuration changes", async () => {
    const out = await syncSvmHistory(db, reg, deps());
    expect(out[`solana:${keel.members[0].address}`]).toEqual({ queries: 3, events: 2, behind: 0, error: null });
    expect(queries).toEqual([1_000, 5_000, 9_000]);
    expect(events.map((e) => [e.event, e.contract, e.tx])).toEqual([
      ["ReserveUpdate", "ELdtQWuDKswV5ddhWqHn1EgRDdv5E6mtuhEVhqksYEpi", "sigReserve"],
      ["PermissionUpdate", "6TdcW3qX25JcN9nMgSkFka5wXTXBFhb5J2tVRdG3pw3w", "sigFreeze"],
    ]);
    expect((events[1].args as { new: { status: string } }).new.status).toBe("Suspended");
    expect(cursor).toMatchObject({ start_slot: 1_000, next_slot: 10_001, reached_at: new Date(5_000), last_error: null });
  });
  it("stamps a pass at the head even with nothing new to read", async () => {
    await syncSvmHistory(db, reg, deps());
    cursor!.reached_at = null;
    await syncSvmHistory(db, reg, deps({ now: () => 9_000 }));
    expect(cursor!.reached_at).toEqual(new Date(9_000));
  });
  it("stores nothing of a controller the registry does not list", async () => {
    const other = { ...reg, deployments: [{ ...keel, members: keel.members.map((m) => (m.role === "rateLimits" ? { ...m, address: "11111111111111111111111111111111" } : m)) }] } as unknown as PauRegistry;
    await syncSvmHistory(db, other, deps());
    expect(events).toEqual([]);
  });
  it("stores a failure, leaves a rate limit unrecorded, and stops at the deadline", async () => {
    await syncSvmHistory(db, reg, deps({}, { emits: async () => Promise.reject(new Error("hypersync: HTTP 500 boom")) }));
    expect(cursor).toMatchObject({ next_slot: 1_000, last_error: "hypersync: HTTP 500 boom" });
    cursor!.last_error = null;
    const limited = await syncSvmHistory(db, reg, deps({}, { emits: async () => Promise.reject(new Error("hypersync: HTTP 429 rate limited")) }));
    expect(Object.values(limited)[0].error).toMatch(/429/);
    expect(cursor!.last_error).toBeNull();
    let t = 0;
    await syncSvmHistory(db, reg, deps({ deadline: 2, now: () => t++ }));
    expect(queries).toEqual([1_000]);
  });
  it("re-reads from the same start when the registry's controllers change", async () => {
    await syncSvmHistory(db, reg, deps());
    cursor!.controllers = "Old";
    queries = [];
    await syncSvmHistory(db, reg, deps());
    expect(queries[0]).toBe(1_000);
  });
  it("reads nothing without a source", async () => {
    expect(await syncSvmHistory(db, reg, deps({ source: () => null }))).toEqual({});
  });
});
