// Sourcify's v2 contract answer mapped onto the explorer cache entry, and the
// statuses fetchSourcify turns into errors so nothing is cached on a miss.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSourcify, sourcifyEntry, sourcifyUrl } from "../scripts/lib/sourcify-source.ts";
import { materialOf } from "../src/server/pau/source-material.ts";
import { resetBackoff } from "../src/lib/upstreamBackoff.ts";

const ADDR = "0x7f8408ebbbc3504f83eeda52910dd75eba92c955";
const SRC = 'contract C { bytes32 public constant LIMIT_SWAP = keccak256("LIMIT_SWAP"); }';
const CONTRACT = {
  abi: [{ type: "function", name: "LIMIT_SWAP", inputs: [], outputs: [{ type: "bytes32" }] }],
  compilation: { name: "ForeignController", language: "Solidity" },
  sources: { "src/C.sol": { content: SRC } },
  proxyResolution: { isProxy: false, implementations: [] },
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  process.env.ETHERSCAN_THROTTLE_MS = "0";
  resetBackoff();
});
afterEach(() => vi.unstubAllGlobals());

describe("sourcifyEntry", () => {
  it("maps name, ABI string and sources onto the Etherscan-shaped entry", () => {
    const e = sourcifyEntry(8453, ADDR, CONTRACT);
    expect(e).toMatchObject({ chainid: 8453, address: ADDR, contractName: "ForeignController", proxy: false, implementation: "" });
    expect(JSON.parse(e.abi)).toEqual(CONTRACT.abi);
    expect(JSON.parse(e.sourceCode)).toEqual({ language: "Solidity", sources: CONTRACT.sources });
  });

  it("keeps the LIMIT_* names source-material reads from the packed sources", () => {
    expect(materialOf(sourcifyEntry(8453, ADDR, CONTRACT).sourceCode).names).toEqual(["LIMIT_SWAP"]);
  });

  it("reads a proxy's first implementation, lowercased", () => {
    const e = sourcifyEntry(8453, ADDR, { ...CONTRACT, proxyResolution: { isProxy: true, implementations: [{ address: "0xC5A845985BdF088F44E3dDF2bd1a79b08dBe9611" }] } });
    expect(e).toMatchObject({ proxy: true, implementation: "0xc5a845985bdf088f44e3ddf2bd1a79b08dbe9611" });
  });

  it("leaves every field empty for an answer without them", () => {
    expect(sourcifyEntry(1, ADDR, {})).toMatchObject({ contractName: "", abi: "", sourceCode: "", proxy: false, implementation: "" });
  });
});

describe("fetchSourcify", () => {
  it("asks the v2 endpoint for the chain and address", async () => {
    const fetchMock = vi.fn(async (_url: string) => reply(200, CONTRACT));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchSourcify(8453, ADDR)).contractName).toBe("ForeignController");
    expect(String(fetchMock.mock.calls[0][0])).toBe(sourcifyUrl(8453, ADDR));
  });

  it.each([
    [404, /sourcify has no 8453\//],
    [429, /sourcify rate limit/],
    [500, /HTTP 500/],
  ])("throws on HTTP %i", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(status, {})));
    await expect(fetchSourcify(8453, ADDR)).rejects.toThrow(message);
  });
});
