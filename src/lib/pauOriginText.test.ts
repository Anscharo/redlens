// The words for a change a LayerZero governance message carried to Solana:
// the chip names the message, and the route says whether its guid proves the
// Ethereum send.
import { describe, expect, it } from "vitest";
import type { PauHistoryEntry, PauOrigin } from "./pauHistory.ts";
import { chipText, routeText } from "./pauOriginText.ts";

const relay = { via: "layerzero" as const, executor: "SKYGRikJcGSa3jC5HDyzDrVsmkCk3e5SqAurycny8PW", actionsSet: 6, messageId: "0xguid" };
const o = (x: Partial<PauOrigin>): PauOrigin => ({ kind: "relayed", path: "layerzero", spell: null, starSpell: null, l1Tx: null, from: null, to: null, relay, evidence: "e", ...x });
const entry = (origin: PauOrigin): PauHistoryEntry => ({ chain: "solana", tx: "sig", block: 1, time: "t", primes: [], origin, executive: null, changes: [] });

describe("LayerZero origin text", () => {
  it("names the message in the chip and the route", () => {
    expect(chipText(entry(o({})))).toBe("relayed · LayerZero 6");
    expect(routeText(o({}), "solana")).toBe("relayed from Ethereum by LayerZero governance message 6; its Ethereum send is not stored yet");
    expect(routeText(o({ l1Tx: "0xsend" }), "solana")).toBe("relayed from Ethereum by LayerZero governance message 6");
    expect(routeText(o({ kind: "spell", spell: "0xspell", l1Tx: "0xsend" }), "solana")).toBe("relayed to Solana by LayerZero governance message 6 (guid proven)");
  });
  it("keeps a Solana change signed directly a direct call", () => {
    expect(routeText(o({ kind: "direct", relay: null, from: "Freezer" }), "solana")).toBe("direct call");
  });
});
