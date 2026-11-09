// @vitest-environment jsdom
// The instance cards' checks for one prime: nothing until the controller
// snapshots and the graph load, then every kind of check over the prime's own
// snapshots, with the keys they hold indexed by chain.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PauResponse } from "@/lib/pau";

const PRIME = "prime-1";
const HELD = "0x" + "a".repeat(64);
const VAULT = "0x" + "1".repeat(40);
const at = { block: 1, time: "2026-01-02T00:00:00Z", tx: "0xt" };

const pau: PauResponse = {
  deployments: [{
    deployment: "d", prime: PRIME, primeName: "P", chain: "ethereum", kind: "monolithic", fetchedAt: "t",
    contracts: [{
      role: "rateLimits", address: "0xrl", events: 1, historyComplete: true,
      rateLimits: [{ key: HELD, configured: { maxAmount: "1", slope: "0" }, setAt: at, changes: 1, data: null, available: null, derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] } }],
    }],
  }],
};
const params = { "Rate Limit IDs": [HELD, "inst-doc"], "Token Address": [VAULT, "inst-doc"], Network: ["Ethereum Mainnet", "inst-doc"] };
const graph = {
  participants: [{ id: PRIME, slug: "p", name: "P", et: "agent", st: "prime", did: "prime-doc", m: "{}" }],
  instances: [{ id: "i", slug: "i", name: "Ethereum Mainnet - Vault", et: "instance", st: "allocation-system", did: "inst-doc", m: JSON.stringify({ agent_doc_id: PRIME, params }) }],
  invocations: [], primitives: [], edges: [],
};

vi.mock("../lib/pau", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/pau")>()), loadPau: () => Promise.resolve(pau) }));
vi.mock("../lib/graph", () => ({ loadGraph: () => Promise.resolve(graph) }));
vi.mock("../lib/docs", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/docs")>()), loadAtlas: () => new Promise(() => {}) }));
vi.mock("../lib/chainstate", () => ({ loadChainState: () => Promise.resolve({ block: "1", values: {} }) }));

afterEach(cleanup);

describe("usePrimeCardMarks", () => {
  it("is null without a prime", async () => {
    const { usePrimeCardMarks } = await import("./usePrimeAtlasChecks");
    const { result } = renderHook(() => usePrimeCardMarks(undefined));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });

  it("checks the prime's IDs and addresses against its snapshots and indexes the keys they hold by chain", async () => {
    const { usePrimeCardMarks } = await import("./usePrimeAtlasChecks");
    const { result } = renderHook(() => usePrimeCardMarks(PRIME));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.addresses.get("inst-doc|Rate Limit IDs")).toMatchObject({ status: "match" });
    expect(result.current!.addresses.get("inst-doc|Token Address")).toMatchObject({ status: "match" });
    expect(result.current!.held.get(`ethereum|${HELD}`)).toHaveLength(1);
    expect(result.current!.plain.size).toBe(0);
  });
});

describe("usePrimeAtlasChecks", () => {
  it("checks nothing without a prime", async () => {
    const { usePrimeAtlasChecks } = await import("./usePrimeAtlasChecks");
    const { result } = renderHook(() => usePrimeAtlasChecks(undefined, pau.deployments));
    expect(result.current).toEqual([]);
  });
});
