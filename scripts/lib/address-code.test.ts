import { describe, it, expect } from "vitest";
import { planCodeChecks, applyCodeResults } from "./address-code.mjs";

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
    const s = applyCodeResults(a, ["0xaaa"], [{ ok: true, code: "0x60806040" }]);
    expect(a["0xaaa"].isContract).toBe(true);
    expect(s).toEqual({ checked: 1, failed: 0, corrected: 1 });
  });

  it("treats '0x' and undefined code as a real EOA answer", () => {
    // viem's getCode resolves to undefined when there is no bytecode.
    const a = addrs();
    applyCodeResults(a, ["0xaaa", "0xbbb"], [{ ok: true, code: "0x" }, { ok: true, code: undefined }]);
    expect(a["0xaaa"].isContract).toBe(false);
    expect(a["0xbbb"].isContract).toBe(false);
  });

  it("keeps the explorer value when the RPC call failed", () => {
    // A network blip must not downgrade a known contract to an EOA — which is
    // why a failure is signalled as {ok:false} and not as an undefined code.
    const a = addrs();
    const s = applyCodeResults(a, ["0xbbb"], [{ ok: false }]);
    expect(a["0xbbb"].isContract).toBe(true);
    expect(s).toEqual({ checked: 0, failed: 1, corrected: 0 });
  });

  it("counts a correction only when getCode disagrees with the explorer", () => {
    const a = addrs();
    const s = applyCodeResults(a, ["0xbbb"], [{ ok: true, code: "0x60806040" }]);
    expect(s.corrected).toBe(0);
    expect(a["0xbbb"].isContract).toBe(true);
  });
});
