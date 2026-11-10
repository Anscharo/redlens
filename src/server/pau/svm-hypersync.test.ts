// The Solana HyperSync source against a stubbed fetch, with HyperSync's real
// answer shapes (tables as arrays of batches, a bare slot for /height).
// Pinned: the query selects the program's successful inner EmitEvent calls
// with their signatures and block times, up to the window's end; calls come in
// execution order, each numbered within its transaction; the cursor moves to
// next_slot and never past the window; no progress, or a call without its
// signature or time, throws; the first held slot is found by bisecting
// all-blocks queries that make no progress below it.
import { afterEach, describe, expect, it } from "bun:test";
import { resetBackoff } from "../../lib/upstreamBackoff.ts";
import { svmEventSource } from "./svm-hypersync.ts";

const PROGRAM = "ALM1JSnEhc5PkNecbSZotgprBuJujL5objTbwGtpTgTd";
const FAST = { gapMs: 0, busyWaitsMs: [] };
const real = globalThis.fetch;
let bodies: Record<string, unknown>[];

function stub(answer: (body: Record<string, unknown> | null, url: string) => unknown) {
  bodies = [];
  globalThis.fetch = (async (url: string, init: { body?: string }) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    if (body) bodies.push(body);
    return new Response(JSON.stringify(answer(body, url)), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
const src = () => svmEventSource("solana", "tok", FAST)!;
const call = (slot: number, tx: number, address: number[], data = "00") => ({ slot, transaction_index: tx, instruction_address: address, data });

afterEach(() => {
  globalThis.fetch = real;
  resetBackoff();
});

describe("svmEventSource", () => {
  it("reads the program's inner EmitEvent calls in execution order, with signatures and times", async () => {
    stub(() => ({
      next_slot: 501,
      instruction_calls: [[call(400, 7, [3, 0, 2], "02"), call(400, 7, [3, 0, 0], "01")], [call(300, 1, [0, 1], "03")]],
      transactions: [[{ slot: 400, transaction_index: 7, transaction_id: "sigB" }, { slot: 300, transaction_index: 1, transaction_id: "sigA" }]],
      blocks: [[{ slot: 300, block_time: 1_000 }, { slot: 400, block_time: 2_000 }]],
    }));
    const out = await src().emits(PROGRAM, 100, 900);
    expect(bodies[0]).toMatchObject({ from_slot: 100, to_slot: 901, instruction_calls: [{ executing_account: [PROGRAM], d1: ["00"], is_inner: true, tx_success: true }] });
    expect(out).toEqual({
      next: 501,
      emits: [
        { slot: 300, time: 1_000, signature: "sigA", index: 0, data: "03" },
        { slot: 400, time: 2_000, signature: "sigB", index: 0, data: "01" },
        { slot: 400, time: 2_000, signature: "sigB", index: 1, data: "02" },
      ],
    });
  });
  it("never moves past the window, and throws on no progress or a call it cannot place", async () => {
    stub(() => ({ next_slot: 2_000, instruction_calls: [], transactions: [], blocks: [] }));
    expect((await src().emits(PROGRAM, 100, 900)).next).toBe(901);
    stub(() => ({ next_slot: 100 }));
    await expect(src().emits(PROGRAM, 100, 900)).rejects.toThrow(/no progress/);
    stub(() => ({ next_slot: 200, instruction_calls: [[call(150, 1, [0, 0])]], transactions: [], blocks: [[{ slot: 150, block_time: 9 }]] }));
    await expect(src().emits(PROGRAM, 100, 900)).rejects.toThrow(/no signature or time/);
  });
  it("reads the bare slot /height answers", async () => {
    stub(() => 467_783_434);
    expect(await src().height()).toBe(467_783_434);
  });
  it("finds the first slot HyperSync holds, and that slot's time", async () => {
    const FIRST = 391_000_000;
    stub((b) => {
      const from = Number(b!.from_slot);
      return from < FIRST ? { next_slot: from, blocks: [] } : { next_slot: from + 1, blocks: [[{ slot: from, block_time: from === FIRST ? 1_767_425_822 : 1 }]] };
    });
    expect(await src().firstHeld(467_000_000)).toEqual({ slot: FIRST, time: 1_767_425_822 });
    expect(bodies.length).toBeLessThan(32);
    expect(bodies.every((b) => b.include_all_blocks === true)).toBe(true);
  });
  it("has no source for a chain HyperSync does not serve", () => {
    expect(svmEventSource("eclipse", "tok")).toBeNull();
  });
});
