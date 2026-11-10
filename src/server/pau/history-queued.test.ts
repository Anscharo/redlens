// Queued governance steps: an action set stays queued until executed or
// canceled, a star spell until a later Exec or Drop, each with its times, and a
// LayerZero message until a Solana receipt holds its guid.
import { describe, expect, it } from "bun:test";
import type { EventRow } from "./history-entries.ts";
import { queuedSteps } from "./history-queued.ts";

const row = (o: Partial<EventRow>): EventRow => ({ chain: "base", tx: "0xq", contract: "0xex", event: "ActionsSetQueued", args: {}, block: 1, time: "2026-11-01T00:00:00.000Z", ...o });
const owners = new Map([["ethereum:0xsg", { primes: ["spark"] }]]);

describe("queuedSteps", () => {
  it("lists action sets neither executed nor canceled, with when they may run", () => {
    const rows = [
      row({ args: { id: "1", executionTime: "1762000000" } }),
      row({ args: { id: "2", executionTime: "1762100000" } }),
      row({ args: { id: "3", executionTime: "1762200000" } }),
      row({ event: "ActionsSetExecuted", args: { id: "1" } }),
      row({ event: "ActionsSetCanceled", args: { id: "3" } }),
      row({ contract: "0xother", event: "ActionsSetExecuted", args: { id: "2" } }),
    ];
    expect(queuedSteps(rows, owners)).toEqual([{ kind: "action-set", chain: "base", contract: "0xex", id: "2", tx: "0xq", time: "2026-11-01T00:00:00.000Z", at: new Date(1762100000 * 1000).toISOString(), primes: [] }]);
  });
  it("lists a star spell plotted and not executed or dropped since, with its prime and deadline", () => {
    const sg = (event: string, addr: string, time: string, args: Record<string, unknown> = {}) => row({ chain: "ethereum", contract: "0xsg", event, time, args: { addr, ...args } });
    const rows = [
      sg("Plot", "0xA", "2026-10-01T00:00:00.000Z", { deadline: "1760000000" }),
      sg("Exec", "0xa", "2026-10-02T00:00:00.000Z"),
      sg("Plot", "0xa", "2026-11-02T00:00:00.000Z", { deadline: "1763000000" }),
      sg("Plot", "0xb", "2026-11-03T00:00:00.000Z"),
      sg("Drop", "0xb", "2026-11-04T00:00:00.000Z"),
    ];
    expect(queuedSteps(rows, owners)).toEqual([{ kind: "star-spell", chain: "ethereum", contract: "0xsg", id: "0xa", tx: "0xq", time: "2026-11-02T00:00:00.000Z", at: new Date(1763000000 * 1000).toISOString(), primes: ["spark"] }]);
  });
  it("lists a LayerZero message no Solana receipt holds, only once receipts are read and only from their window on", () => {
    const sent = (guid: string, time: string) => row({ chain: "ethereum", contract: "0xlz", event: "GovernanceCallSent", tx: `0x${guid}`, time, args: { guid } });
    const rows = [
      sent("0xold", "2025-11-03T00:00:00.000Z"),
      sent("0xAA", "2026-05-11T00:00:00.000Z"),
      sent("0xbb", "2026-11-09T00:00:00.000Z"),
      row({ chain: "solana", contract: "SKYGRik", event: "LzReceive", time: "2026-05-11T00:01:00.000Z", args: { guid: "0xaa" } }),
    ];
    expect(queuedSteps(rows, owners)).toEqual([]);
    expect(queuedSteps(rows, owners, "2026-01-03T00:00:00.000Z")).toEqual([{ kind: "lz-message", chain: "ethereum", contract: "0xlz", id: "0xbb", tx: "0x0xbb", time: "2026-11-09T00:00:00.000Z", at: null, primes: [] }]);
  });
});
