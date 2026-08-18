// Cross-runtime bridge test. src/lib/patterns.ts is the src-side (TS,
// frontend + server) home for the EVM/Solana address regex sources;
// scripts/lib/address-chains.mjs is the pipeline-side (.mjs — the build
// scripts can't import TS) home. This test IS the sync mechanism between the
// two — not a comment promising they stay aligned — by importing both
// modules and asserting their shared source strings are byte-identical.
//
// The two files use the "_SRC" suffix for DIFFERENT things, and that is a
// naming asymmetry to know about, not a bug to paper over:
//   - address-chains.mjs's `ETH_ADDR_SRC` / `SOL_ADDR_SRC` are the BARE
//     address body — no boundary assertion.
//   - patterns.ts's `EVM_ADDRESS_SRC` / `SOL_ADDRESS_SRC` are already
//     boundary-wrapped (lookaround / `\b`) — the free-text scanning form.
//     patterns.ts's bare-body equivalent is named `*_ADDRESS_BODY_SRC`.
// So the correct pairs are NOT "same name, same runtime" — they're:
//
//   patterns.ts                  <-> address-chains.mjs
//   EVM_ADDRESS_BODY_SRC         <-> ETH_ADDR_SRC            (bare body)
//   SOL_ADDRESS_BODY_SRC         <-> SOL_ADDR_SRC             (bare body)
//   EVM_ADDRESS_SRC              <-> ETH_ADDR_RE.source       (lookaround-wrapped)
//   SOL_ADDRESS_SRC              <-> SOL_ADDR_RE.source       (\b-wrapped)
//   EVM_ADDRESS_EXACT_RE.source  <-> ETH_ADDR_EXACT_RE.source (^...$ anchored)
//   SOL_ADDRESS_EXACT_RE.source  <-> SOL_ADDR_EXACT_RE.source (^...$ anchored)
//
// No intentional VALUE differences are expected in any of these six pairs —
// unlike DOC_NO_CORE's documented dialects, the address forms have exactly
// one correct shape per boundary style, shared verbatim by every runtime.
// Flags matter too — a `.source`-only match would stay green even if one side
// picked up e.g. a stray "i" flag and started matching case-insensitively —
// so the two exact-form pairs also assert `.flags` equality below. The
// free-text pair is compared as source strings only (patterns.ts exports a
// string there, address-chains.mjs a compiled `/g` RegExp); the "g" flag is
// applied identically by every call site (`new RegExp(SRC, "g")`) and is
// covered per-consumer instead, e.g. patterns.test.ts.
import { describe, it, expect } from "vitest";
import {
  EVM_ADDRESS_BODY_SRC,
  SOL_ADDRESS_BODY_SRC,
  EVM_ADDRESS_SRC,
  SOL_ADDRESS_SRC,
  EVM_ADDRESS_EXACT_RE,
  SOL_ADDRESS_EXACT_RE,
} from "./patterns";
import {
  ETH_ADDR_SRC,
  SOL_ADDR_SRC,
  ETH_ADDR_RE,
  SOL_ADDR_RE,
  ETH_ADDR_EXACT_RE,
  SOL_ADDR_EXACT_RE,
} from "../../scripts/lib/address-chains.mjs";

describe("patterns.ts <-> address-chains.mjs address regex sync", () => {
  it("bare address-body sources match (patterns.ts *_BODY_SRC <-> address-chains.mjs *_SRC)", () => {
    expect(EVM_ADDRESS_BODY_SRC).toBe(ETH_ADDR_SRC);
    expect(SOL_ADDRESS_BODY_SRC).toBe(SOL_ADDR_SRC);
  });

  it("free-text scanning sources match (boundary-wrapped: lookaround for EVM, \\b for Solana)", () => {
    expect(EVM_ADDRESS_SRC).toBe(ETH_ADDR_RE.source);
    expect(SOL_ADDRESS_SRC).toBe(SOL_ADDR_RE.source);
  });

  it("whole-string exact-match regexes match, source AND flags (^...$ anchored, no lookaround needed)", () => {
    expect(EVM_ADDRESS_EXACT_RE.source).toBe(ETH_ADDR_EXACT_RE.source);
    expect(EVM_ADDRESS_EXACT_RE.flags).toBe(ETH_ADDR_EXACT_RE.flags);
    expect(SOL_ADDRESS_EXACT_RE.source).toBe(SOL_ADDR_EXACT_RE.source);
    expect(SOL_ADDRESS_EXACT_RE.flags).toBe(SOL_ADDR_EXACT_RE.flags);
  });

  it("the exact forms are genuinely lookaround-free (anchors alone do the boundary job)", () => {
    expect(EVM_ADDRESS_EXACT_RE.source).not.toContain("?<!");
    expect(EVM_ADDRESS_EXACT_RE.source).not.toContain("?!");
    expect(SOL_ADDRESS_EXACT_RE.source).not.toContain("\\b");
  });
});
