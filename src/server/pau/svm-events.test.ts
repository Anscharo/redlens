// The Solana ALM program's EmitEvent data, as mainnet emitted it
// (svm-events.fixture.json: each transaction's inner EmitEvent calls, hex).
// Pinned: every configuration variant decodes with the account it changed and
// its full state before and after, bigints as decimal strings; an
// AccountingEvent decodes to null; bytes that do not add up throw.
import { describe, expect, it } from "bun:test";
import fixture from "./svm-events.fixture.json" with { type: "json" };
import { decodeEmitEvent } from "./svm-events.ts";

const CONTROLLER = "EeobZr57FSmNvw8Hs719iULJNqv3XLrTB5uPezvC2ND3";
const emits = (sig: string) => (fixture as Record<string, { emits: string[] }>)[sig].emits;
const one = (prefix: string) => {
  const sig = Object.keys(fixture).find((s) => s.startsWith(prefix))!;
  return decodeEmitEvent(emits(sig)[0]);
};

describe("decodeEmitEvent", () => {
  it("decodes the controller's creation", () => {
    expect(one("2GUmmows")).toEqual({
      event: "ControllerUpdate", controller: CONTROLLER, account: CONTROLLER, authority: "PcJcgdWmFZznhhfN28i6T8GHcwA6jmFGuUeNNGvcSY2",
      old: null, new: { id: 0, status: "Active", authority: "EeWDutgcKNTdQGJkGRrWYmTXXuKnPUZNvXepbLkQrxW4" },
    });
  });
  it("decodes a Reserve's and an Integration's creation with their limits", () => {
    expect(one("3hC1ZZhF")).toMatchObject({
      event: "ReserveUpdate", account: "ELdtQWuDKswV5ddhWqHn1EgRDdv5E6mtuhEVhqksYEpi", old: null,
      new: { controller: CONTROLLER, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", status: "Active", slope: "10000000000000", maxOutflow: "25000000000000" },
    });
    expect(one("4FsniAUf")).toMatchObject({
      event: "IntegrationUpdate", account: "3vAnLvHHERj4xdnrGhMcBpdL7p4RtyisgggHq78MWGSw", old: null,
      new: { description: "USDS->USDC AtomicSwap", status: "Active", config: { type: "AtomicSwap" } },
    });
  });
  it("decodes a Permission's suspension with its state before and after", () => {
    const e = one("5oRUDfcB")!;
    expect(e).toMatchObject({ event: "PermissionUpdate", account: "6TdcW3qX25JcN9nMgSkFka5wXTXBFhb5J2tVRdG3pw3w" });
    expect(e.old).toMatchObject({ status: "Active", flags: ["can_execute_swap", "can_reallocate"] });
    expect(e.new).toMatchObject({ status: "Suspended", flags: ["can_execute_swap", "can_reallocate"] });
  });
  it("skips an AccountingEvent, and throws on bytes that do not add up", () => {
    const sig = Object.keys(fixture).find((s) => s.startsWith("3uHcUyk1"))!;
    expect(emits(sig).map(decodeEmitEvent)).toEqual([null, null]);
    const reserve = emits(Object.keys(fixture).find((s) => s.startsWith("3hC1ZZhF"))!)[0];
    expect(() => decodeEmitEvent(reserve.slice(0, -2))).toThrow(/holds/);
    expect(() => decodeEmitEvent(reserve.slice(0, 14) + "09" + reserve.slice(16))).toThrow(/unknown event variant 9/);
  });
});
