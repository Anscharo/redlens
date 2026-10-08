// BeamState's hold on one RateLimits: registration from the chain (else the
// replay), a default set for this RateLimits winning over the general one, a
// zero one falling back to it, and a failed read falling back to the replay.
import { describe, expect, it } from "bun:test";
import type { PauEventRow } from "./replay.ts";
import { beamLimits, replayBeam } from "./beam.ts";
import type { ChainCall } from "./snapshot.ts";

const BEAM = "0x" + "b".repeat(40);
const RL = "0x" + "1".repeat(40);
const OTHER = "0x" + "2".repeat(40);
const ZERO = "0x" + "0".repeat(40);
const [K1, K2, K3, K4] = ["1", "2", "3", "4"].map((c) => "0x" + c.repeat(64));
const row = (event: string, args: Record<string, unknown>, block = 1): PauEventRow => ({ contract: BEAM, event, args, block, block_time: "2026-01-01T00:00:00.000Z", tx_hash: `0xt${block}` });
const events = [
  row("AddRateLimits", { rateLimits_: RL }),
  row("AddInitRateLimits", { key: K1, rateLimits_: RL, maxAmount: "10", slope: "1" }, 2),
  row("AddInitRateLimits", { key: K2, rateLimits_: ZERO, maxAmount: "20", slope: "2" }, 3),
  row("AddInitRateLimits", { key: K3, rateLimits_: OTHER, maxAmount: "30", slope: "3" }, 4),
  row("AddInitRateLimits", { key: K4, rateLimits_: ZERO, maxAmount: "40", slope: "4" }, 5),
  row("DelInitRateLimits", { key: K4, rateLimits_: ZERO }, 6),
];

describe("replayBeam", () => {
  it("keeps this RateLimits' defaults and the general ones, and drops deleted ones", () => {
    const r = replayBeam(events, RL);
    expect(r.registered).toBe(true);
    expect([...r.defaults.keys()]).toEqual([`${K1}:contract`, `${K2}:general`]);
    expect(replayBeam([...events, row("DelRateLimits", { rateLimits_: RL }, 7)], RL).registered).toBe(false);
    expect(replayBeam(events, OTHER).registered).toBeNull();
  });
});

/** A BeamState with the given registration and live (key, target) → [maxAmount, slope]; undefined reads fail. */
function chain(registered: bigint | null, init: Record<string, [bigint, bigint] | undefined>) {
  return async (_c: string, calls: ChainCall[]) =>
    calls.map((c) => {
      if (c.functionName === "rateLimits") return registered;
      if (c.functionName === "getHop") return 57600n;
      if (c.functionName === "getMaxChange") return 1_200000000000000000n;
      return init[`${c.args[0]}:${c.args[1]}`] ?? null;
    });
}

describe("beamLimits", () => {
  const src = { address: BEAM, history: { events, complete: true } };
  it("is null for a RateLimits BeamState does not manage", async () => {
    expect(await beamLimits(chain(0n, {}), "ethereum", src, OTHER, [])).toBeNull();
  });
  it("reads each default live: this RateLimits' own when set, else the general one", async () => {
    const zero: [bigint, bigint] = [0n, 0n];
    const read = chain(1n, { [`${K1}:${RL}`]: [11n, 1n], [`${K1}:${ZERO}`]: [99n, 9n], [`${K2}:${RL}`]: zero, [`${K2}:${ZERO}`]: [20n, 2n], [`${K3}:${RL}`]: zero, [`${K3}:${ZERO}`]: zero });
    const b = await beamLimits(read, "ethereum", src, RL.toUpperCase().replace("0X", "0x"), [K3]);
    expect(b).toMatchObject({ beamState: BEAM, hop: "57600", maxChange: "1200000000000000000", historyComplete: true });
    expect(b!.defaults.map((d) => [d.key, d.maxAmount, d.scope, d.setAt?.block ?? null])).toEqual([[K1, "11", "contract", 2], [K2, "20", "general", 3]]);
  });
  it("falls back to the replay where the chain cannot be read", async () => {
    const b = await beamLimits(chain(null, {}), "ethereum", src, RL, []);
    expect(b!.defaults.map((d) => [d.key, d.maxAmount, d.scope])).toEqual([[K1, "10", "contract"], [K2, "20", "general"]]);
    expect([b!.hop, b!.maxChange]).toEqual(["57600", "1200000000000000000"]);
  });
});
