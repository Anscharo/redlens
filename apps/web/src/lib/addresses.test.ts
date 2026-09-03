import { describe, it, expect, vi } from "vitest";

// vi.hoisted: vi.mock's factory is hoisted above plain module-scope consts, so
// the fixture it reads has to be hoisted with it.
const served = vi.hoisted(() => ({
  atlas: {} as Record<string, unknown>,
  onChain: {} as Record<string, unknown>,
}));
vi.mock("@/lib/verify", () => ({
  fetchJson: (url: string) =>
    Promise.resolve(url.includes("addresses.atlas.json") ? { addresses: served.atlas } : served.onChain),
  StaleAtlasError: class extends Error {},
}));
vi.mock("./atlasBase", () => ({
  liveAtlasBase: () => "/base/",
  handledStale: () => false,
}));

import { loadAddresses } from "./addresses";

const ADDR = "0xa02ec279eea9e56f4e14449a07c5ca5fdaadc51d";

// loadAddresses memoizes per base, so each test uses its own base string.
function serve(atlas: Record<string, unknown>, onChain: Record<string, unknown>) {
  served.atlas = atlas;
  served.onChain = onChain;
}

describe("loadAddresses chain resolution", () => {

  it("prefers the on-chain resolved chain over the atlas's reading", async () => {
    // The atlas offered both readings of an ambiguous doc; build-addresses
    // probed them and found the address only on robinhood.
    serve(
      { [ADDR]: { chain: "arbitrum", chains: ["arbitrum", "robinhood"], roles: [], aliases: [], expectedTokens: [] } },
      { [ADDR]: { chain: "robinhood", isContract: true, isProxy: false } },
    );
    const out = await loadAddresses("/b1/");
    expect(out[ADDR].chain).toBe("robinhood");
    // The explorer link has to follow the resolved chain, not the guess.
    expect(out[ADDR].explorerUrl).toContain("robinhood");
    expect(out[ADDR].explorerUrl).not.toContain("arbiscan");
  });

  it("falls back to the atlas chain when the address isn't in addresses.json", async () => {
    serve({ [ADDR]: { chain: "base", roles: [], aliases: [], expectedTokens: [] } }, {});
    const out = await loadAddresses("/b2/");
    expect(out[ADDR].chain).toBe("base");
    expect(out[ADDR].isContract).toBe(false);
  });

  it("keeps the atlas chain when the two agree", async () => {
    serve(
      { [ADDR]: { chain: "base", roles: [], aliases: [], expectedTokens: [] } },
      { [ADDR]: { chain: "base", isContract: true, isProxy: false } },
    );
    const out = await loadAddresses("/b3/");
    expect(out[ADDR].chain).toBe("base");
  });

  it("resolves the name as chainlogId > etherscanName (never entityLabel) and files non-winners as aliases", async () => {
    serve(
      { [ADDR]: { chain: "ethereum", roles: ["multisig"], aliases: ["Old Name"], expectedTokens: ["USDS"], entityLabel: "Atlas Label" } },
      { [ADDR]: { chain: "ethereum", chainlogId: "MCD_PAUSE_PROXY", etherscanName: "SafeProxy", isContract: true, isProxy: true, implementation: "0ximpl" } },
    );
    const out = await loadAddresses("/b4/");
    expect(out[ADDR].label).toBe("MCD_PAUSE_PROXY");
    // entityLabel is heuristic prose — never a name, and no longer folded into
    // aliases; it is preserved on its own field to surface as the owner.
    expect(out[ADDR].aliases).toEqual(["Old Name", "SafeProxy"]);
    expect(out[ADDR].entityLabel).toBe("Atlas Label");
    expect(out[ADDR].roles).toEqual(["multisig"]);
    expect(out[ADDR].implementation).toBe("0ximpl");
  });

  it("tolerates the minimal build-index artifact shape (chain only, no annotation)", async () => {
    // build-index writes { chain } before build-graph enriches it; a partial
    // build must still render rather than throw on missing arrays.
    serve({ [ADDR]: { chain: "ethereum" } }, {});
    const out = await loadAddresses("/b5/");
    expect(out[ADDR].roles).toEqual([]);
    expect(out[ADDR].aliases).toEqual([]);
    expect(out[ADDR].expectedTokens).toEqual([]);
  });

  it("ignores a stale addresses.json chain the atlas no longer claims", async () => {
    // addresses.json is not atlas-versioned, so it lags a rebuild. Here the
    // atlas has since settled on robinhood alone (the doc's "on Robinhood Chain
    // is" clause), and the lagging arbitrum value must not resurrect it.
    serve(
      { [ADDR]: { chain: "robinhood", chains: ["robinhood"], roles: [], aliases: [], expectedTokens: [] } },
      { [ADDR]: { chain: "arbitrum", isContract: false, isProxy: false } },
    );
    const out = await loadAddresses("/b6/");
    expect(out[ADDR].chain).toBe("robinhood");
    expect(out[ADDR].explorerUrl).not.toContain("arbiscan");
  });
});
