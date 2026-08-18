import { describe, it, expect } from "vitest";
import {
  EVM_ADDRESS_BODY_SRC,
  SOL_ADDRESS_BODY_SRC,
  EVM_ADDRESS_SRC,
  SOL_ADDRESS_SRC,
  EVM_ADDRESS_EXACT_RE,
  SOL_ADDRESS_EXACT_RE,
} from "./patterns";

// This package (W3-3) converted rehypeEthAddresses.ts, explorer.ts, and
// ActorInstances.tsx from their own literal RegExp copies to composing off
// patterns.ts. Each `it` below hardcodes that consumer's PRIOR literal,
// captured verbatim before the conversion, so a change here that silently
// altered the composed pattern fails loudly in this file instead of only
// showing up as a rendering regression somewhere downstream.
describe("patterns.ts preserves each converted consumer's exact prior regex", () => {
  it("rehypeEthAddresses.ts's global scanning forms (composed via `new RegExp(SRC, \"g\")`)", () => {
    // Was: const ETH_ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
    const eth = new RegExp(EVM_ADDRESS_SRC, "g");
    expect(eth.source).toBe("(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])");
    expect(eth.flags).toBe("g");
    // Was: const SOL_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
    const sol = new RegExp(SOL_ADDRESS_SRC, "g");
    expect(sol.source).toBe("\\b[1-9A-HJ-NP-Za-km-z]{43,44}\\b");
    expect(sol.flags).toBe("g");
  });

  it("explorer.ts's anchored Solana form", () => {
    // Was: const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
    expect(SOL_ADDRESS_EXACT_RE.source).toBe("^[1-9A-HJ-NP-Za-km-z]{43,44}$");
    expect(SOL_ADDRESS_EXACT_RE.flags).toBe("");
  });

  it("ActorInstances.tsx's anchored EVM + Solana forms", () => {
    // Was: const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
    expect(EVM_ADDRESS_EXACT_RE.source).toBe("^0x[0-9a-fA-F]{40}$");
    expect(EVM_ADDRESS_EXACT_RE.flags).toBe("");
    // Was: const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/; (same literal as explorer.ts's)
    expect(SOL_ADDRESS_EXACT_RE.source).toBe("^[1-9A-HJ-NP-Za-km-z]{43,44}$");
    expect(SOL_ADDRESS_EXACT_RE.flags).toBe("");
  });

  it("bare body sources carry no boundary assertion of their own", () => {
    expect(EVM_ADDRESS_BODY_SRC).toBe("0x[0-9a-fA-F]{40}");
    expect(SOL_ADDRESS_BODY_SRC).toBe("[1-9A-HJ-NP-Za-km-z]{43,44}");
  });

  it("matches real address shapes end to end", () => {
    const evm = "0x" + "a".repeat(40);
    const sol = "So11111111111111111111111111111111111111112";
    expect(EVM_ADDRESS_EXACT_RE.test(evm)).toBe(true);
    expect(SOL_ADDRESS_EXACT_RE.test(sol)).toBe(true);
    expect(new RegExp(EVM_ADDRESS_SRC, "g").test(`prefix ${evm} suffix`)).toBe(true);
  });

  it("free-text EVM form does not carve a match out of the leading 40 hex of a longer hex run", () => {
    // The load-bearing case: a 64-hex tx hash must not yield a phantom address.
    const txHash = "0x" + "a".repeat(64);
    expect(new RegExp(EVM_ADDRESS_SRC, "g").test(txHash)).toBe(false);
    // The anchored exact form is unaffected by this concern (it requires the
    // WHOLE string to be exactly 40 hex chars), by construction.
    expect(EVM_ADDRESS_EXACT_RE.test(txHash)).toBe(false);
  });
});
