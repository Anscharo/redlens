// The deferred-chain mechanism, tested against a synthetic deferred entry.
//
// This file exists because promoting plasma/monad/plume emptied
// FUTURE_TO_ETHEREUM, and the tests that covered the mechanism only ever
// passed because those three happened to be in the list. Coverage that
// evaporates the moment the data changes was never really covering the code —
// so the deferred list is mocked here, and the mechanism stays tested no matter
// what the registry currently holds.
//
// What it guards: a chain the atlas names but the registry has not registered
// yet must collapse to ethereum *deliberately* — bucketed `deferred` rather
// than `unknown` by census:chains, and resolved from its own list row instead
// of falling through to whatever chain a neighbouring row happens to name.

import { describe, it, expect, vi } from "vitest";

// Inject a deferred chain at the source — the registry JSON chains.mjs reads —
// rather than stubbing its exports. Mocking the module would only change what
// *importers* see; classifyChainLabel lives inside chains.mjs and closes over
// its own reference, so it would keep the real list. Patching the registry is
// also the more faithful scenario: it is exactly "a registry with a deferred
// chain in it".
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (p: Parameters<typeof actual.readFileSync>[0], enc?: unknown) => {
      const out = actual.readFileSync(p, enc as never);
      if (!String(p).includes("chain-registry.json")) return out;
      return JSON.stringify({ ...JSON.parse(String(out)), deferred: ["zephyr"] });
    },
  };
});

const { classifyChainLabel, normalizeChainLabel } = await import("./chains.mjs");
const { chainFromLabel, detectChainSignal, detectChain } = await import("./address-chains.mjs");

const A = "0xa02eC279eEA9E56F4E14449a07C5ca5FDAAdc51d";
const B = "0x10E6593CDda8c58a1d0f14C5164B376352a55f2F";

describe("a deferred chain", () => {
  it("classifies as deferred → ethereum, not unknown", () => {
    expect(classifyChainLabel("Zephyr Network")).toMatchObject({
      kind: "deferred",
      chain: "ethereum",
      deferred: "zephyr",
    });
  });

  it("normalizes to ethereum without an unknown-label warning", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeChainLabel("Zephyr", "test-ctx")).toBe("ethereum");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("resolves from a label to ethereum, so an ancestor walk stops there", () => {
    // Returning null instead would let the walk continue to a grandparent
    // naming some unrelated chain.
    expect(chainFromLabel("Zephyr")).toBe("ethereum");
  });

  it("resolves its own list row to ethereum, not to a neighbouring row's chain", () => {
    const list = `- Avalanche - \`${B}\`\n- Zephyr - \`${A}\``;
    expect(detectChain(list, list.indexOf(A))).toBe("ethereum");
  });

  it("reports the deferred name alongside the collapsed chain", () => {
    const text = `- Avalanche - \`${B}\`\n- Zephyr - \`${A}\``;
    expect(detectChainSignal(text, text.indexOf(A))).toEqual({
      chain: "ethereum",
      explicit: false,
      deferred: "zephyr",
    });
  });

  it("still loses to an explicit 'on <chain> is' clause", () => {
    const text = `The address of the Zephyr relay on Base is: \`${A}\``;
    expect(detectChainSignal(text, text.indexOf(A))).toEqual({ chain: "base", explicit: true });
  });
});
