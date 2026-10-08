// The explorer plumbing shared by address enrichment and the PAU grant
// history: one provider list (Etherscan v2 only with a key and only where it
// covers the chain, then Routescan, then the chain's Blockscout) and one
// request clock per host whose waiters queue instead of firing together.

import { afterEach, describe, expect, it, vi } from "vitest";
import { explorerBases, explorerIntervalMs, throttleExplorer } from "../scripts/lib/explorer-api.ts";

afterEach(() => vi.unstubAllEnvs());

describe("explorerBases", () => {
  it("puts Etherscan v2 first only when a key is given and the chain is covered", () => {
    expect(explorerBases("ethereum", "k").map((b) => b.name)).toEqual(["etherscan", "blockscout"]);
    expect(explorerBases("ethereum", undefined).map((b) => b.name)).toEqual(["blockscout"]);
    expect(explorerBases("base", undefined)).toEqual([]);
    expect(explorerBases("robinhood", "k").map((b) => b.name)).toEqual(["etherscan", "blockscout"]);
    expect(explorerBases("plume", "k").map((b) => b.name)).toEqual(["blockscout"]);
  });
  it("puts Routescan after Etherscan and gives it no key", () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "bs");
    expect(explorerBases("avalanche", "k")).toEqual([
      { name: "etherscan", base: "https://api.etherscan.io/v2/api?chainid=43114&apikey=k&" },
      { name: "routescan", base: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api?" },
    ]);
  });
  it("sends BLOCKSCOUT_API_KEY only to instances Blockscout hosts", () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "bs");
    expect(explorerBases("xlayer", "k")).toEqual([{ name: "blockscout", base: "https://api.xlayerscan.com/api?" }]);
    expect(explorerBases("plume", "k")).toEqual([{ name: "blockscout", base: "https://explorer.plume.org/api?" }]);
  });
  it("ends every base where the module/action params follow", () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "bs");
    expect(explorerBases("ethereum", "k")).toEqual([
      { name: "etherscan", base: "https://api.etherscan.io/v2/api?chainid=1&apikey=k&" },
      { name: "blockscout", base: "https://eth.blockscout.com/api?apikey=bs&" },
    ]);
  });
});

describe("explorerIntervalMs", () => {
  it("keeps a host's registry gap even when the default is shorter", () => {
    vi.stubEnv("ETHERSCAN_THROTTLE_MS", "0");
    expect(explorerIntervalMs("https://api.xlayerscan.com/api?module=logs")).toBe(6000);
    expect(explorerIntervalMs("https://eth.blockscout.com/api?module=logs")).toBe(0);
    vi.stubEnv("ETHERSCAN_THROTTLE_MS", "8000");
    expect(explorerIntervalMs("https://api.xlayerscan.com/api?module=logs")).toBe(8000);
  });
});

describe("throttleExplorer", () => {
  it("does not make one host wait on another host's clock", async () => {
    vi.stubEnv("ETHERSCAN_THROTTLE_MS", "200");
    await throttleExplorer("https://a.example/api");
    const t0 = Date.now();
    await throttleExplorer("https://b.example/api");
    expect(Date.now() - t0).toBeLessThan(100);
  });
  it("spaces concurrent callers by the interval instead of releasing them together", async () => {
    vi.stubEnv("ETHERSCAN_THROTTLE_MS", "40");
    await throttleExplorer();
    const times: number[] = [];
    await Promise.all([0, 1, 2].map(async () => {
      await throttleExplorer();
      times.push(Date.now());
    }));
    times.sort((x, y) => x - y);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(35);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(35);
  });
});
