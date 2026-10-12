// Facet source parsing: every cached diamond facet parses into the key shapes
// its getters prove, in encode order (not the getter's parameter order), and
// anything the parser does not recognise throws rather than reading as a
// facet with no keys.
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { facetShapesAt, parseFacet } from "./facet-source.ts";

const CACHE = path.join(import.meta.dir, "../../../.cache/etherscan");

const HELPERS = `
function makeAddressKey(bytes32 key, address a) pure returns (bytes32) {
    return keccak256(abi.encode(key, a));
}
function makeAddressAddressKey(bytes32 key, address a, address b) pure returns (bytes32) {
    return keccak256(abi.encode(key, a, b));
}`;

const facet = (body: string, helpers = HELPERS) => ({
  contractName: "TestFacet",
  sourceCode: `{${JSON.stringify({ sources: { "src/facets/TestFacet.sol": { content: body }, "src/libraries/RateLimitHelpers.sol": { content: helpers } } })}}`,
});

const GOOD = `
contract TestFacet {
    bytes32 internal constant _LIMIT_DEPOSIT = keccak256("LIMIT_TEST_DEPOSIT");
    bytes32 internal constant _LIMIT_MINT    = keccak256("LIMIT_TEST_MINT");
    function deposit(address vault, address asset, uint256 amount) external {
        _decreaseRateLimit(getDepositRateLimitKey(vault, asset), amount);
        _check(mintRateLimitKey());
    }
    function _check(bytes32 key) internal view {
        require(_rateLimitExists(key), "TestFacet/invalid-action");
    }
    function getDepositRateLimitKey(address vault, address asset) public pure override returns (bytes32) {
        return makeAddressAddressKey(_LIMIT_DEPOSIT, asset, vault);
    }
    function mintRateLimitKey() public pure override returns (bytes32) {
        return _LIMIT_MINT;
    }
}`;

describe("parseFacet", () => {
  it("reads each getter's constant and its arguments in encode order, through a forwarding helper", () => {
    expect(parseFacet(facet(GOOD))).toEqual([
      { facet: "TestFacet", getter: "getDepositRateLimitKey", constant: "LIMIT_TEST_DEPOSIT", types: ["address", "address"], roles: ["asset", "vault"] },
      { facet: "TestFacet", getter: "mintRateLimitKey", constant: "LIMIT_TEST_MINT", types: [], roles: [] },
    ]);
  });
  it("throws on a getter body, a helper, a constant or a rate-limit call it does not recognise", () => {
    expect(() => parseFacet(facet(GOOD.replace("return _LIMIT_MINT;", "return keccak256(abi.encode(_LIMIT_MINT, 1));")))).toThrow(/mintRateLimitKey returns/);
    expect(() => parseFacet(facet(GOOD, HELPERS.replace("abi.encode(key, a, b)", "abi.encode(key, b, a)")))).toThrow(/out of declared order/);
    expect(() => parseFacet(facet(GOOD, HELPERS.replace("abi.encode(key, a)", "abi.encodePacked(key, a)")))).toThrow(/not a plain abi.encode/);
    expect(() => parseFacet(facet(GOOD.replace('keccak256("LIMIT_TEST_MINT")', "0x01")))).toThrow(/not keccak256 of a name/);
    expect(() => parseFacet(facet(GOOD.replace("_check(mintRateLimitKey());", "_decreaseRateLimit(_LIMIT_MINT, amount);")))).toThrow(/outside a getter/);
    expect(() => parseFacet(facet(GOOD.replace("internal view", "public view")))).toThrow(/outside a getter/);
    expect(() => parseFacet(facet(GOOD.replace("asset, vault);", "asset, amountX);")))).toThrow(/passes amountX/);
  });
  it("throws when the source names no file for the contract", () => {
    expect(() => parseFacet({ contractName: "OtherFacet", sourceCode: facet(GOOD).sourceCode })).toThrow(/no source file/);
  });
});

describe("cached facets", () => {
  const files = fs.readdirSync(CACHE).flatMap((c) => fs.readdirSync(path.join(CACHE, c)).map((f) => path.join(CACHE, c, f)));
  const facets = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))).filter((j) => /Facet$/.test(j.contractName ?? ""));

  it("all parse", () => {
    expect(facets.length).toBeGreaterThan(0);
    for (const j of facets) expect(parseFacet(j).length).toBeGreaterThan(0);
  });
  it("reads AaveFacet's deposit key as (underlyingAsset, pool, aToken), not its getter's (aToken, pool, underlyingAsset)", () => {
    const aave = facetShapesAt(CACHE, 1, "0x8CE890A96A193FF2DD4B2EA3C682326F655F6B62");
    expect(aave.map((s) => [s.getter, s.constant, s.roles.join(",")])).toEqual([
      ["getDepositRateLimitKey", "LIMIT_AAVE_DEPOSIT", "underlyingAsset,pool,aToken"],
      ["getWithdrawRateLimitKey", "LIMIT_AAVE_WITHDRAW", "pool,aToken"],
    ]);
  });
  it("has no shapes for a facet that is not cached", () => {
    expect(facetShapesAt(CACHE, 1, "0x" + "0".repeat(40))).toEqual([]);
  });
});
