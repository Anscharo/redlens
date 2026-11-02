import { describe, expect, it } from "vitest";
import type { LiveRateLimit, PauParam, PauSnapshot } from "./pau.ts";
import { isGuardParam, paramUse } from "./pauParamUse.ts";

const [POOL, ATOKEN, OTC, LONE] = ["1", "2", "3", "4"].map((c) => "0x" + c.repeat(40));
const at = { block: 1, time: "t", tx: "0xt" };
const lim = (constant: string, args: string[], max: string, live: string | null = max): LiveRateLimit => ({
  key: `${constant}:${args.join()}`, configured: { maxAmount: max, slope: "0" }, setAt: at, changes: 1, available: null, derived: { constant, args },
  data: live === null ? null : { maxAmount: live, slope: "0", lastAmount: "0", lastUpdated: "0" },
});
const snap: PauSnapshot = {
  deployment: "p:ethereum:monolithic", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic",
  contracts: [{ role: "rateLimits", address: "0xrl", events: 0, historyComplete: true, rateLimits: [
    lim("LIMIT_CURVE_SWAP", [POOL], "0"), lim("LIMIT_CURVE_DEPOSIT", [POOL], "0"),
    lim("LIMIT_AAVE_DEPOSIT", [ATOKEN.toUpperCase().replace("0X", "0x")], "0", "5"),
    lim("LIMIT_OTC_SWAP", [OTC], "7", null),
  ] }],
};
const param = (event: string, subject: string): PauParam => ({ event, subject, args: {}, setAt: at });

describe("paramUse", () => {
  it("is off when every rate limit derived from the subject is zero, and names the kind from the key", () => {
    expect(paramUse(snap, param("MaxSlippageSet", POOL))).toEqual({ kind: "Curve pool", state: "off", constants: ["LIMIT_CURVE_SWAP", "LIMIT_CURVE_DEPOSIT"] });
  });

  it("reads the live maxAmount first, and the configured one when the live read failed", () => {
    expect(paramUse(snap, param("MaxSlippageSet", ATOKEN)).state).toBe("on");
    expect(paramUse(snap, param("MaxSlippageSet", OTC))).toMatchObject({ kind: "OTC exchange", state: "on" });
  });

  it("is unkeyed when no named key uses the subject, with the kind from a diamond event", () => {
    expect(paramUse(snap, param("MaxSlippageSet", LONE))).toEqual({ kind: null, state: "unkeyed", constants: [] });
    expect(paramUse(snap, param("CurveMaxSlippageSet", LONE)).kind).toBe("Curve pool");
    expect(paramUse(snap, param("ERC4626MaxExchangeRateSet", LONE)).kind).toBe("ERC-4626 vault");
  });

  it("treats only slippage and exchange-rate settings as guards", () => {
    expect(isGuardParam("MaxSlippageSet")).toBe(true);
    expect(isGuardParam("UniswapV4MaxSlippageSet")).toBe(true);
    expect(isGuardParam("MintRecipientSet")).toBe(false);
  });
});
