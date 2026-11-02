import { describe, expect, it } from "bun:test";
import { parsePrices, pricesUrl, fetchTokenPrices } from "./fetch-prices.ts";
import { priceCoinIds } from "../../lib/tokenPrices.ts";

const SKY_ID = "ethereum:0x56072c95faa701256059aa122697b133aded9279";

describe("priceCoinIds", () => {
  it("prices ERC20s by their Ethereum contract and gas tokens by CoinGecko id", () => {
    const ids = priceCoinIds();
    expect(ids.SKY).toBe(SKY_ID);
    expect(ids.SUSDS).toBe("ethereum:0xa3931d71877c0e7a3148cb7eb4463524fec27fbd");
    expect(ids.ETH).toBe("coingecko:ethereum");
    expect(ids.AVAX).toBe("coingecko:avalanche-2");
    expect(ids.XDAI).toBe("coingecko:xdai");
    expect(ids.SOL).toBe("coingecko:solana");
  });
});

describe("parsePrices", () => {
  const ids = { SKY: SKY_ID, ETH: "coingecko:ethereum", MON: "coingecko:monad" };

  it("maps each coin back to its symbol with the quote's own time", () => {
    const out = parsePrices(ids, {
      coins: {
        [SKY_ID]: { price: 0.07, timestamp: 1_793_000_000, confidence: 0.99 },
        "coingecko:ethereum": { price: 3000, timestamp: 1_793_000_100 },
      },
    });
    expect(out).toEqual({
      SKY: { usd: 0.07, asOf: new Date(1_793_000_000_000).toISOString() },
      ETH: { usd: 3000, asOf: new Date(1_793_000_100_000).toISOString() },
    });
  });

  it("leaves out a coin that is missing, unpriced, undated or low-confidence", () => {
    const out = parsePrices(ids, {
      coins: {
        [SKY_ID]: { price: 0.07, timestamp: 1, confidence: 0.2 },
        "coingecko:ethereum": { timestamp: 1 },
        "coingecko:monad": { price: 0.02 },
      },
    });
    expect(out).toEqual({});
    expect(parsePrices(ids, {})).toEqual({});
  });
});

describe("fetchTokenPrices", () => {
  it("asks for every coin once in a single GET", async () => {
    const seen: string[] = [];
    const fake = async (url: string) => {
      seen.push(url);
      return Response.json({ coins: { "coingecko:ethereum": { price: 3000, timestamp: 1 } } });
    };
    const out = await fetchTokenPrices(fake);
    expect(seen).toEqual([pricesUrl(priceCoinIds())]);
    expect(seen[0]).toContain("coins.llama.fi/prices/current/");
    expect(seen[0]).toContain(SKY_ID);
    expect(out.ETH.usd).toBe(3000);
  });

  it("throws on an error answer rather than reading it as no prices", async () => {
    const fake = async () => new Response("busy", { status: 502 });
    await expect(fetchTokenPrices(fake)).rejects.toThrow("HTTP 502");
  });
});
