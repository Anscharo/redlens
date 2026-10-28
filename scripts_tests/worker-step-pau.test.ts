// The pau tick step: it syncs events, then rebuilds snapshots with a key namer
// fed the stored spell material and the atlas's retired addresses, each read
// once; a failed read of either warns and names keys without it, and a
// deployment whose rebuild failed is warned about.
import { afterEach, describe, expect, it, vi } from "vitest";

const syncPauEvents = vi.fn(async () => ({ visited: 4, pending: 1, events: 2, errors: 0, rateLimited: [] as string[] }));
const maybeRefreshPauState = vi.fn();
const keyNamer = vi.fn((..._args: unknown[]) => "namer");
const spellMaterial = vi.fn();
const atlasRetiredAddresses = vi.fn();
vi.mock("../src/server/config.ts", () => ({ config: { pauEventBudgetSeconds: 30, pauRefreshSeconds: 3600 } }));
vi.mock("../src/server/pau/sync-events.ts", () => ({ syncPauEvents }));
vi.mock("../src/server/pau/store.ts", () => ({ maybeRefreshPauState }));
vi.mock("../src/server/pau/rpc-reader.ts", () => ({ rpcChainReader: () => "reader", rpcHead: async () => 1 }));
vi.mock("../scripts/lib/explorer-logs.ts", () => ({ explorerLogs: async () => [] }));
vi.mock("../scripts/lib/rpc-logs.ts", () => ({ logsRpcsFor: () => [] }));
vi.mock("../src/server/pau/rpc-sync.ts", () => ({ rpcChains: () => new Set(["base"]) }));
vi.mock("../src/server/pau/diamond-derive.ts", () => ({ keyNamer }));
vi.mock("../src/server/pau/probe.ts", () => ({ atlasKeysByPrime: () => new Map() }));
vi.mock("../src/server/pau/spell-sources.ts", () => ({ spellMaterial }));
vi.mock("../src/server/pau/retired-addresses.ts", () => ({ atlasRetiredAddresses }));

// @ts-expect-error — .mjs without types
const { default: pau } = await import("../scripts/lib/worker-steps/pau.mjs");
const db = {};
const empty = { names: [], addresses: [], words: [], spells: [] };

type Sources = { retired: () => Map<string, unknown>; material: () => unknown };
const sourcesGiven = () => keyNamer.mock.calls.at(-1)![3] as Sources;

afterEach(() => vi.clearAllMocks());

describe("pau step", () => {
  it("names keys with the stored spell material and the clone's retired addresses, and says what it did", async () => {
    const material = { ...empty, names: ["LIMIT_OTC_SWAP"] };
    const retired = new Map([["0xjaaa", { address: "0xjaaa", removedAt: "2025-08-25", commit: "dd13" }]]);
    spellMaterial.mockResolvedValueOnce(material);
    atlasRetiredAddresses.mockReturnValueOnce(retired);
    maybeRefreshPauState.mockResolvedValueOnce({ refreshed: 3, removed: 1, reason: "due", failed: [{ deployment: "p:base:monolithic", error: "boom" }] });
    const warn = vi.fn();
    expect(await pau.run({ db, warn })).toBe("pau events 4 read, 1 pending, 2 new; state rebuilt 3, dropped 1, 1 kept their last snapshot");
    expect(keyNamer.mock.calls[0].slice(0, 3)).toEqual([["public/addresses.atlas.json", "public/addresses.json"], expect.anything(), undefined]);
    expect([sourcesGiven().material(), sourcesGiven().retired()]).toEqual([material, retired]);
    expect(atlasRetiredAddresses).toHaveBeenCalledWith("vendor/next-gen-atlas");
    expect(maybeRefreshPauState.mock.calls[0][3]).toMatchObject({ refreshSeconds: 3600, nameKeys: "namer" });
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["atlas-worker: pau snapshot p:base:monolithic not rebuilt, keeping its last: boom"]);
  });

  it("names keys without the spell material or the retired addresses when either read fails, warning once for each", async () => {
    spellMaterial.mockRejectedValueOnce(new Error('relation "pau_spell_sources" does not exist'));
    atlasRetiredAddresses.mockImplementationOnce(() => {
      throw new Error("git log in vendor/next-gen-atlas: not a git repository");
    });
    maybeRefreshPauState.mockResolvedValueOnce({ refreshed: 0, removed: 0, reason: "fresh" });
    const warn = vi.fn();
    expect(await pau.run({ db, warn })).toBe("pau events 4 read, 1 pending, 2 new; state fresh");
    expect([sourcesGiven().material(), sourcesGiven().retired()]).toEqual([empty, new Map()]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'atlas-worker: pau spell sources not read, keys only they name stay unnamed: relation "pau_spell_sources" does not exist',
      "atlas-worker: pau retired atlas addresses not read, keys derived from them stay unmarked: git log in vendor/next-gen-atlas: not a git repository",
    ]);
  });
});
