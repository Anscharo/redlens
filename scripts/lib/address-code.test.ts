import { describe, it, expect, vi } from "vitest";
import { planCodeChecks, applyCodeResults, applyOnchainCode, resolvePresentChains } from "./address-code.mjs";

// Stands in for the RPC, injected via applyOnchainCode's `clientFor`. Built
// fresh per test — a shared spy reset in beforeEach leaks a pending rejection
// from one test into the next.
function fakeRpc(impl, nonceImpl = () => Promise.resolve(0)) {
  const getCode = vi.fn(impl);
  const getTransactionCount = vi.fn(nonceImpl);
  return { getCode, getTransactionCount, clientFor: () => ({ getCode, getTransactionCount }) };
}

describe("planCodeChecks", () => {
  it("groups EVM addresses by chain", () => {
    const plan = planCodeChecks({
      "0xaaa": { chain: "ethereum" },
      "0xbbb": { chain: "base" },
      "0xccc": { chain: "ethereum" },
    });
    expect(plan.get("ethereum")).toEqual(["0xaaa", "0xccc"]);
    expect(plan.get("base")).toEqual(["0xbbb"]);
  });

  it("skips chains with no RPC in the registry", () => {
    // solana has no rpcUrl — getCode is meaningless there, and its addresses
    // must keep whatever the explorer pass decided rather than be called EOAs.
    const plan = planCodeChecks({ SoLaNaAddr: { chain: "solana" } });
    expect(plan.size).toBe(0);
  });

  it("includes addresses the explorer already verified", () => {
    // getCode is the field's definition now, so a disagreement should surface.
    const plan = planCodeChecks({ "0xaaa": { chain: "ethereum", isContract: true } });
    expect(plan.get("ethereum")).toEqual(["0xaaa"]);
  });
});

describe("applyCodeResults", () => {
  const addrs = () => ({
    "0xaaa": { chain: "ethereum", isContract: false },
    "0xbbb": { chain: "ethereum", isContract: true },
  });

  it("marks an address with bytecode as a contract", () => {
    const a = addrs();
    const s = applyCodeResults(a, "ethereum", ["0xaaa"], [{ ok: true, code: "0x60806040" }]);
    expect(a["0xaaa"].isContract).toBe(true);
    expect(s).toEqual({ checked: 1, failed: 0, corrected: 1, present: 1 });
  });

  it("treats '0x' and undefined code as a real EOA answer", () => {
    // viem's getCode resolves to undefined when there is no bytecode.
    const a = addrs();
    applyCodeResults(a, "ethereum", ["0xaaa", "0xbbb"], [{ ok: true, code: "0x" }, { ok: true, code: undefined }]);
    expect(a["0xaaa"].isContract).toBe(false);
    expect(a["0xbbb"].isContract).toBe(false);
  });

  it("keeps the explorer value when the RPC call failed", () => {
    // A network blip must not downgrade a known contract to an EOA — which is
    // why a failure is signalled as {ok:false} and not as an undefined code.
    const a = addrs();
    const s = applyCodeResults(a, "ethereum", ["0xbbb"], [{ ok: false }]);
    expect(a["0xbbb"].isContract).toBe(true);
    expect(s).toEqual({ checked: 0, failed: 1, corrected: 0, present: 0 });
  });

  it("counts a correction only when getCode disagrees with the explorer", () => {
    const a = addrs();
    const s = applyCodeResults(a, "ethereum", ["0xbbb"], [{ ok: true, code: "0x60806040" }]);
    expect(s.corrected).toBe(0);
    expect(a["0xbbb"].isContract).toBe(true);
  });
});

describe("applyOnchainCode", () => {
  it("checks every chain, rewrites isContract, and counts non-EVM addresses as skipped", async () => {
    const addresses = {
      "0xaaa": { chain: "ethereum", isContract: false }, // unverified contract
      "0xbbb": { chain: "ethereum", isContract: true }, // agrees
      "0xccc": { chain: "base", isContract: false }, // genuinely an EOA
      SoLaNaAddr: { chain: "solana", isContract: false }, // no RPC → untouched
    };
    const { getCode, clientFor } = fakeRpc(({ address }) =>
      Promise.resolve(address === "0xccc" ? undefined : "0x60806040"),
    );

    const log = vi.fn();
    const totals = await applyOnchainCode(addresses, { log, clientFor });

    expect(getCode).toHaveBeenCalledTimes(3); // solana never queried
    expect(addresses["0xaaa"].isContract).toBe(true);
    expect(addresses["0xbbb"].isContract).toBe(true);
    expect(addresses["0xccc"].isContract).toBe(false);
    expect(addresses.SoLaNaAddr.isContract).toBe(false);
    expect(totals).toEqual({ checked: 3, failed: 0, corrected: 1, skipped: 1, resolved: 0 });
    // One line per chain checked.
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("survives an RPC rejection, leaving that address on its explorer value", async () => {
    const addresses = { "0xaaa": { chain: "ethereum", isContract: true } };
    // Lazy: mockRejectedValue builds the rejected promise up front, which reads
    // as an unhandled rejection before applyOnchainCode ever attaches .catch.
    const { clientFor } = fakeRpc(() => Promise.reject(new Error("rpc down")));

    const totals = await applyOnchainCode(addresses, { log: vi.fn(), clientFor });

    expect(addresses["0xaaa"].isContract).toBe(true);
    expect(totals).toEqual({ checked: 0, failed: 1, corrected: 0, skipped: 0, resolved: 0 });
  });

  it("batches a list longer than one request's worth", async () => {
    // BATCH is 50 internally; 120 addresses must all still be checked.
    const addresses = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [
        `0x${i.toString(16).padStart(40, "0")}`,
        { chain: "ethereum", isContract: false },
      ]),
    );
    const { getCode, clientFor } = fakeRpc(() => Promise.resolve("0x60806040"));

    const totals = await applyOnchainCode(addresses, { log: vi.fn(), clientFor });

    expect(getCode).toHaveBeenCalledTimes(120);
    expect(totals.checked).toBe(120);
    expect(totals.corrected).toBe(120);
  });

  it("does nothing and logs nothing when no address has a usable chain", async () => {
    const log = vi.fn();
    const { getCode, clientFor } = fakeRpc(() => Promise.resolve("0x60806040"));
    const totals = await applyOnchainCode({ SoLaNaAddr: { chain: "solana" } }, { log, clientFor });
    expect(getCode).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(totals).toEqual({ checked: 0, failed: 0, corrected: 0, skipped: 1, resolved: 0 });
  });
});

describe("resolvePresentChains", () => {
  it("keeps the atlas chain when the chain data confirms it, and orders it first", () => {
    const a = { "0xaaa": { chain: "base", chains: ["base", "ethereum"], presentOnChains: ["ethereum", "base"] } };
    expect(resolvePresentChains(a)).toBe(0);
    expect(a["0xaaa"].chain).toBe("base");
    expect(a["0xaaa"].presentOnChains).toEqual(["base", "ethereum"]);
  });

  it("moves to the chain the address actually exists on when the atlas guessed wrong", () => {
    // The Grove case: doc titled for one chain, body naming another. Only one
    // candidate comes back with code, so that one is real.
    const a = {
      "0xaaa": {
        chain: "arbitrum",
        chains: ["arbitrum", "robinhood"],
        presentOnChains: ["robinhood"],
        codeByChain: { arbitrum: false, robinhood: true },
        isContract: false,
      },
    };
    expect(resolvePresentChains(a)).toBe(1);
    expect(a["0xaaa"].chain).toBe("robinhood");
    expect(a["0xaaa"].isContract).toBe(true); // follows the resolved chain
  });

  it("keeps every chain when the address exists on more than one", () => {
    const a = { "0xaaa": { chain: "ethereum", presentOnChains: ["base", "ethereum"] } };
    resolvePresentChains(a);
    expect(a["0xaaa"].presentOnChains).toEqual(["ethereum", "base"]);
  });

  it("leaves the atlas answer alone when no chain shows any presence", () => {
    const a = { "0xaaa": { chain: "arbitrum", chains: ["arbitrum", "robinhood"], isContract: false } };
    expect(resolvePresentChains(a)).toBe(0);
    expect(a["0xaaa"].chain).toBe("arbitrum");
  });
});

describe("applyOnchainCode presence probing", () => {
  it("counts an EOA with a non-zero nonce as present on that chain", async () => {
    const addresses = { "0xaaa": { chain: "ethereum", isContract: false } };
    const { clientFor } = fakeRpc(
      () => Promise.resolve(undefined), // no bytecode
      () => Promise.resolve(4), // but it has transacted
    );
    await applyOnchainCode(addresses, { log: vi.fn(), clientFor });
    expect(addresses["0xaaa"].presentOnChains).toEqual(["ethereum"]);
    expect(addresses["0xaaa"].isContract).toBe(false);
  });

  it("treats a never-used address as present nowhere", async () => {
    const addresses = { "0xaaa": { chain: "ethereum", isContract: false } };
    const { clientFor } = fakeRpc(() => Promise.resolve("0x"), () => Promise.resolve(0));
    await applyOnchainCode(addresses, { log: vi.fn(), clientFor });
    expect(addresses["0xaaa"].presentOnChains).toBeUndefined();
  });

  it("resolves an ambiguous address end to end", async () => {
    const addresses = {
      "0xaaa": { chain: "arbitrum", chains: ["arbitrum", "base"], isContract: false },
    };
    // Code on base only — the atlas primary (arbitrum) is unsupported.
    const perChain = (chain: string) => ({
      getCode: () => Promise.resolve(chain === "base" ? "0x60806040" : "0x"),
      getTransactionCount: () => Promise.resolve(0),
    });
    const totals = await applyOnchainCode(addresses, { log: vi.fn(), clientFor: perChain });
    expect(addresses["0xaaa"].chain).toBe("base");
    expect(addresses["0xaaa"].isContract).toBe(true);
    expect(totals.resolved).toBe(1);
  });
});
