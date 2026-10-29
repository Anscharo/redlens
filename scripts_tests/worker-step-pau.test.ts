// The pau tick step: it syncs events, then rebuilds snapshots with a key namer
// fed the stored spell material and the atlas's retired addresses, each read
// once; a failed read of either warns and names keys without it, and a
// deployment whose rebuild failed is warned about. The atlas artifacts a rebuild
// reads come from the published set, fetched once and only when one is due.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const syncPauEvents = vi.fn(async () => ({ visited: 4, pending: 1, events: 2, errors: 0, rateLimited: [] as string[] }));
const maybeRefreshPauState = vi.fn();
const keyNamer = vi.fn((..._args: unknown[]) => async () => "named");
const spellMaterial = vi.fn();
const atlasRetiredAddresses = vi.fn();
const atlasKeysByPrime = vi.fn((..._args: unknown[]) => new Map([["p", ["0xk"]]]));
const pauAtlasInputs = vi.fn();
vi.mock("../src/server/config.ts", () => ({ config: { pauEventBudgetSeconds: 30, pauRefreshSeconds: 3600 } }));
vi.mock("../src/server/pau/sync-events.ts", () => ({ syncPauEvents }));
vi.mock("../src/server/pau/store.ts", () => ({ maybeRefreshPauState }));
vi.mock("../src/server/pau/rpc-reader.ts", () => ({ rpcChainReader: () => "reader", rpcHead: async () => 1 }));
vi.mock("../scripts/lib/explorer-logs.ts", () => ({ explorerLogs: async () => [] }));
vi.mock("../scripts/lib/rpc-logs.ts", () => ({ logsRpcsFor: () => [] }));
vi.mock("../src/server/pau/rpc-sync.ts", () => ({ rpcChains: () => new Set(["base"]) }));
vi.mock("../src/server/pau/diamond-derive.ts", () => ({ keyNamer }));
vi.mock("../src/server/pau/probe.ts", () => ({ atlasKeysByPrime }));
vi.mock("../src/server/pau/spell-sources.ts", () => ({ spellMaterial }));
vi.mock("../src/server/pau/retired-addresses.ts", () => ({ atlasRetiredAddresses }));
// A public/ that holds neither artifact, whatever the checkout has built.
const NO_PUBLIC = { "graph.json": "/nonexistent/public/graph.json", "addresses.atlas.json": "/nonexistent/public/addresses.atlas.json" };
vi.mock("../src/server/pau/atlas-inputs.ts", () => ({ pauAtlasInputs, publicInputs: () => NO_PUBLIC }));

// @ts-expect-error — .mjs without types
const { default: pau } = await import("../scripts/lib/worker-steps/pau.mjs");
const db = {};
const empty = { names: [], addresses: [], words: [], spells: [] };

type Sources = { retired: () => Map<string, unknown>; material: unknown };
type Opts = { refreshSeconds: number; nameKeys: (...a: unknown[]) => Promise<unknown>; atlasKeys: () => Promise<Map<string, string[]>> };
const sourcesGiven = () => keyNamer.mock.calls.at(-1)![2] as Sources;

/** Published copies of both artifacts, as pauAtlasInputs writes them. */
function published() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pau-step-"));
  const paths = { "graph.json": path.join(dir, "graph.json"), "addresses.atlas.json": path.join(dir, "addresses.atlas.json") };
  for (const p of Object.values(paths)) fs.writeFileSync(p, "{}");
  return paths;
}

/** A due rebuild: loads the atlas keys, then names two deployments' keys, as refreshEach does. */
function rebuild(result: object) {
  maybeRefreshPauState.mockImplementationOnce(async (_db: unknown, _reg: unknown, _read: unknown, opts: Opts) => {
    const keys = await opts.atlasKeys();
    await opts.nameKeys("snap-a");
    await opts.nameKeys("snap-b");
    return { ...result, keys };
  });
}

afterEach(() => vi.clearAllMocks());

describe("pau step", () => {
  it("names keys with the stored spell material and the clone's retired addresses, and says what it did", async () => {
    const material = { ...empty, names: ["LIMIT_OTC_SWAP"] };
    const retired = new Map([["0xjaaa", { address: "0xjaaa", removedAt: "2025-08-25", commit: "dd13" }]]);
    spellMaterial.mockResolvedValueOnce(material);
    atlasRetiredAddresses.mockReturnValueOnce(retired);
    pauAtlasInputs.mockResolvedValueOnce(published());
    rebuild({ refreshed: 3, removed: 1, reason: "due", failed: [{ deployment: "p:base:monolithic", error: "boom" }] });
    const warn = vi.fn();
    expect(await pau.run({ db, warn })).toBe("pau events 4 read, 1 pending, 2 new; state rebuilt 3, dropped 1, 1 kept their last snapshot");
    expect([sourcesGiven().material, sourcesGiven().retired()]).toEqual([material, retired]);
    expect(atlasRetiredAddresses).toHaveBeenCalledWith(expect.stringMatching(/\/vendor\/next-gen-atlas$/));
    expect(maybeRefreshPauState.mock.calls[0][3]).toMatchObject({ refreshSeconds: 3600 });
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["atlas-worker: pau snapshot p:base:monolithic not rebuilt, keeping its last: boom"]);
  });

  it("reads the published graph and address artifacts once per rebuild, and builds the namer once", async () => {
    const paths = published();
    pauAtlasInputs.mockResolvedValueOnce(paths);
    spellMaterial.mockResolvedValueOnce(empty);
    rebuild({ refreshed: 2, removed: 0, reason: "due" });
    await pau.run({ db, warn: vi.fn() });
    expect(pauAtlasInputs).toHaveBeenCalledTimes(1);
    expect(pauAtlasInputs).toHaveBeenCalledWith(db);
    expect(atlasKeysByPrime).toHaveBeenCalledWith(paths["graph.json"]);
    expect(await maybeRefreshPauState.mock.results[0].value).toMatchObject({ keys: new Map([["p", ["0xk"]]]) });
    expect(keyNamer).toHaveBeenCalledTimes(1);
    expect(keyNamer.mock.calls[0][0]).toEqual([paths["addresses.atlas.json"], "public/addresses.json"]);
  });

  it("fetches nothing when no rebuild is due", async () => {
    spellMaterial.mockResolvedValueOnce(empty);
    maybeRefreshPauState.mockResolvedValueOnce({ refreshed: 0, removed: 0, reason: "fresh" });
    expect(await pau.run({ db, warn: vi.fn() })).toBe("pau events 4 read, 1 pending, 2 new; state fresh");
    expect(pauAtlasInputs).not.toHaveBeenCalled();
    expect(keyNamer).not.toHaveBeenCalled();
  });

  it("falls back to public/ when the store read fails, warning about it and about each artifact found nowhere", async () => {
    pauAtlasInputs.mockRejectedValueOnce(new Error("connection refused"));
    spellMaterial.mockResolvedValueOnce(empty);
    rebuild({ refreshed: 1, removed: 0, reason: "due" });
    const warn = vi.fn();
    await pau.run({ db, warn });
    expect(atlasKeysByPrime).toHaveBeenCalledWith(NO_PUBLIC["graph.json"]);
    expect(keyNamer.mock.calls[0][0]).toEqual([NO_PUBLIC["addresses.atlas.json"], "public/addresses.json"]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      "atlas-worker: pau published atlas artifacts not read, reading public/: connection refused",
      "atlas-worker: pau has no /nonexistent/public/graph.json (not published, not built)",
      "atlas-worker: pau has no /nonexistent/public/addresses.atlas.json (not published, not built)",
    ]);
  });

  it("probes no key when the graph cannot be read, warning once, and still rebuilds", async () => {
    pauAtlasInputs.mockResolvedValueOnce(published());
    spellMaterial.mockResolvedValueOnce(empty);
    atlasKeysByPrime.mockImplementationOnce(() => {
      throw new Error("Unexpected end of JSON input");
    });
    rebuild({ refreshed: 2, removed: 0, reason: "due" });
    const warn = vi.fn();
    expect(await pau.run({ db, warn })).toBe("pau events 4 read, 1 pending, 2 new; state rebuilt 2");
    expect(await maybeRefreshPauState.mock.results[0].value).toMatchObject({ keys: new Map() });
    expect(warn.mock.calls.map((c) => c[0])).toEqual(["atlas-worker: pau atlas RateLimitIDs not read, no key is probed: Unexpected end of JSON input"]);
  });

  it("builds one namer when two deployments ask for it at once", async () => {
    pauAtlasInputs.mockResolvedValueOnce(published());
    spellMaterial.mockResolvedValueOnce(empty);
    maybeRefreshPauState.mockImplementationOnce(async (_db: unknown, _reg: unknown, _read: unknown, opts: Opts) => {
      await Promise.all([opts.nameKeys("a"), opts.nameKeys("b")]);
      return { refreshed: 2, removed: 0, reason: "due" };
    });
    await pau.run({ db, warn: vi.fn() });
    expect(keyNamer).toHaveBeenCalledTimes(1);
  });

  it("names keys without the spell material or the retired addresses when either read fails, warning once for each", async () => {
    spellMaterial.mockRejectedValueOnce(new Error('relation "pau_spell_sources" does not exist'));
    atlasRetiredAddresses.mockImplementationOnce(() => {
      throw new Error("git log in vendor/next-gen-atlas: not a git repository");
    });
    pauAtlasInputs.mockResolvedValueOnce(published());
    rebuild({ refreshed: 1, removed: 0, reason: "due" });
    const warn = vi.fn();
    await pau.run({ db, warn });
    expect([sourcesGiven().material, sourcesGiven().retired()]).toEqual([empty, new Map()]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'atlas-worker: pau spell sources not read, keys only they name stay unnamed: relation "pau_spell_sources" does not exist',
      "atlas-worker: pau retired atlas addresses not read, keys derived from them stay unmarked: git log in vendor/next-gen-atlas: not a git repository",
    ]);
  });
});
