// The explorer plumbing shared by address enrichment and the PAU grant
// history: one provider list (Etherscan v2 only with a key and only where it
// covers the chain, then the chain's Blockscout) and one request clock whose
// waiters queue instead of firing together.

import { afterEach, describe, expect, it, vi } from "vitest";
import { explorerBases, throttleExplorer } from "../scripts/lib/explorer-api.ts";

afterEach(() => vi.unstubAllEnvs());

describe("explorerBases", () => {
  it("puts Etherscan v2 first only when a key is given and the chain is covered", () => {
    expect(explorerBases("ethereum", "k").map((b) => b.name)).toEqual(["etherscan", "blockscout"]);
    expect(explorerBases("ethereum", undefined).map((b) => b.name)).toEqual(["blockscout"]);
    expect(explorerBases("base", undefined)).toEqual([]);
    expect(explorerBases("robinhood", "k").map((b) => b.name)).toEqual(["blockscout"]);
  });
  it("ends every base where the module/action params follow", () => {
    vi.stubEnv("BLOCKSCOUT_API_KEY", "bs");
    expect(explorerBases("ethereum", "k")).toEqual([
      { name: "etherscan", base: "https://api.etherscan.io/v2/api?chainid=1&apikey=k&" },
      { name: "blockscout", base: "https://eth.blockscout.com/api?apikey=bs&" },
    ]);
  });
});

describe("throttleExplorer", () => {
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
