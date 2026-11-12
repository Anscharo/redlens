// When an svm deployment's limits and Permissions were last set, from its
// stored window. Pinned: the history is complete only when the window reached
// the head within a day, holds no error and starts at least PENDING_DAYS back;
// a limit's last set is its latest change of status, slope or maximum (not a
// change of anything else); a limit with no change in a complete window is set
// before the window, and in an incomplete one has no time; a Permission's
// holder is held since its last change; the snapshot carries all of it.
import { describe, expect, it } from "bun:test";
import fixture from "./svm-accounts.fixture.json" with { type: "json" };
import type { PauDeployment } from "../../lib/pauRegistry.ts";
import registry from "../../data/pau-registry.json" with { type: "json" };
import { PENDING_DAYS, svmSetTimes, windowComplete, type SvmHistory } from "./svm-history.ts";
import { svmSnapshot } from "./svm-snapshot.ts";
import type { PauEventRow } from "./replay.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 10);
const START = "2026-01-03T07:37:02.000Z";
const RESERVE = "FfpyJhTfxKfDJSode3YNZCxEkPRZ2shBv9gU5PTWCCEk";
const RELAYER = "2MeJkkKPfHs6qJgTKZJGnrpq8jBRsvty6zB5iA8SkoVU";
const window = (over: Partial<SvmHistory["window"]> = {}) => ({ startTime: START, reachedAt: new Date(NOW - 600_000).toISOString(), error: null, ...over });
const limit = (slope: string, status = "Active") => ({ status, slope, maxOutflow: "25000000000000", available: "1", description: "x" });
const row = (contract: string, event: string, block: number, old: object | null, now: object): PauEventRow => ({ contract, event, args: { authority: "A", old, new: now }, block, block_time: new Date(NOW - (100_000 - block) * 1000).toISOString(), tx_hash: `sig${block}` });

describe("windowComplete", () => {
  it("needs a fresh pass to the head, no error, and a start at least PENDING_DAYS back", () => {
    expect(PENDING_DAYS).toBe(40);
    expect(windowComplete(window(), NOW)).toBe(true);
    expect(windowComplete(null, NOW)).toBe(false);
    expect(windowComplete(window({ reachedAt: null }), NOW)).toBe(false);
    expect(windowComplete(window({ reachedAt: new Date(NOW - 2 * DAY).toISOString() }), NOW)).toBe(false);
    expect(windowComplete(window({ error: "hypersync: HTTP 500" }), NOW)).toBe(false);
    expect(windowComplete(window({ startTime: new Date(NOW - 30 * DAY).toISOString() }), NOW)).toBe(false);
  });
});

describe("svmSetTimes", () => {
  const events = [
    row(RESERVE, "ReserveUpdate", 10, null, limit("1")),
    row(RESERVE, "ReserveUpdate", 20, limit("1"), limit("2")),
    row(RESERVE, "ReserveUpdate", 30, { ...limit("2"), available: "9" }, limit("2")),
    row(RELAYER, "PermissionUpdate", 40, { status: "Active" }, { status: "Suspended" }),
  ];
  it("times a limit by its last change of status, slope or maximum, and counts those", () => {
    expect(svmSetTimes({ events, window: window() }, NOW).limit(RESERVE)).toEqual({ setAt: { block: 20, time: events[1].block_time, tx: "sig20" }, changes: 2 });
  });
  it("sets a limit the window never changed before the window, only when the window is complete", () => {
    expect(svmSetTimes({ events, window: window() }, NOW).limit("other").setAt).toEqual({ block: 0, time: "", tx: "", before: START });
    expect(svmSetTimes({ events, window: window({ reachedAt: null }) }, NOW).limit("other").setAt).toEqual({ block: 0, time: "", tx: "" });
  });
  it("holds a Permission since its last change, and null when the window has none", () => {
    const t = svmSetTimes({ events, window: window() }, NOW);
    expect(t.since(RELAYER)?.tx).toBe("sig40");
    expect(t.since("other")).toBeNull();
  });
});

describe("svmSnapshot with its history", () => {
  const keel = (registry.deployments as PauDeployment[]).find((d) => d.kind === "svm")!;
  const accounts = new Map(Object.entries(fixture as Record<string, string>).map(([a, b]) => [a, Uint8Array.from(atob(b), (c) => c.charCodeAt(0))]));
  const read = async (as: string[]) => new Map(as.map((a) => [a, accounts.get(a) ?? (a.length > 40 ? Object.assign(new Uint8Array(82), { 44: 6 }) : null)]));
  it("marks every contract complete, times each limit, and holds each Permission since its change", async () => {
    const events = [row(RESERVE, "ReserveUpdate", 20, limit("1"), limit("2")), row(RELAYER, "PermissionUpdate", 40, { status: "Active" }, { status: "Suspended" })];
    const s = await svmSnapshot(keel, read, undefined, svmSetTimes({ events, window: window() }, NOW));
    expect(s.contracts.every((c) => c.historyComplete)).toBe(true);
    const limits = s.contracts.find((c) => c.role === "rateLimits")!.rateLimits!;
    expect(limits.find((r) => r.key === RESERVE)).toMatchObject({ setAt: { tx: "sig20" }, changes: 1 });
    expect(limits.filter((r) => r.setAt.before === START)).toHaveLength(limits.length - 1);
    expect(s.contracts.find((c) => c.address === RELAYER)!.roles![0].since?.tx).toBe("sig40");
  });
  it("is incomplete with no history read", async () => {
    const s = await svmSnapshot(keel, read);
    expect(s.contracts.some((c) => c.historyComplete)).toBe(false);
  });
});
