// A parameter row reads as a setting and its target, not as the raw event.
import { describe, expect, it } from "vitest";
import { paramTarget, paramTitle } from "./pauParamText.ts";

describe("pauParamText", () => {
  it("names the setting in words, listed events by their title and others from the event name", () => {
    expect(paramTitle("MintRecipientSet")).toBe("CCTP mint recipient");
    expect(paramTitle("LayerZeroRecipientSet")).toBe("LayerZero recipient");
    expect(paramTitle("UniswapV3PoolMaxTickDeltaSet")).toBe("Uniswap V3 pool max tick delta");
    expect(paramTitle("AaveMaxSlippageSet")).toBe("Aave max slippage");
    expect(paramTitle("UniswapV3PoolLowerTickUpdated")).toBe("Uniswap V3 pool lower tick");
  });
  it("names the destination a domain or endpoint number stands for, and leaves an unknown number bare", () => {
    expect(paramTarget("MintRecipientSet", "5")).toBe("CCTP destination domain 5 (Solana)");
    expect(paramTarget("LayerZeroRecipientSet", "30168")).toBe("LayerZero endpoint 30168 (Solana)");
    expect(paramTarget("MintRecipientSet", "99")).toBe("CCTP destination domain 99");
    expect(paramTarget("MaxSlippageSet", "0xpool")).toBeNull();
  });
});
