// On-chain facts for the tools: which atlas documents a PAU key belongs to,
// the facts a snapshot becomes, the `onchain` block a tool result carries for
// the keys, documents and addresses it names, and atlas_onchain's filters.
import { describe, expect, it, mock } from "bun:test";
import type { AtlasNode } from "../../types.ts";
import type { StoredPauSnapshot } from "../../lib/pau.ts";
import { buildIndexes, type Entity } from "../retrieval/indexes.ts";
import type { OnchainSource } from "./facts.ts";

const P = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const doc = (id: string, doc_no: string, title: string, content = "") => ({ id, doc_no, title, content, type: "Core", depth: 6, parentId: null, order: 0 }) as unknown as AtlasNode;
const k = (c: string) => "0x" + c.repeat(64);
const [KMINT, KIN, KOUT, KCON, KDER, KOFF, KPOOL] = ["1", "2", "3", "4", "5", "6", "7"].map(k);
const VAULT = "0x" + "a".repeat(40);
const RL = "0x" + "b".repeat(40);
const RELAYER = "0x" + "c".repeat(40);
const LISTED = "0x" + "e".repeat(40);
const KADDR = k("8");
const BEAM = "0x" + "f".repeat(40);

const ent = (id: string, slug: string, name: string, entity_type: string, subtype: string, meta: object): Entity => ({ id, slug, name, entity_type, subtype, defining_doc_id: id, is_active: 1, meta: JSON.stringify(meta) });
const ix = buildIndexes(
  [
    doc(P, "A.6.1.1.2", "Grove"),
    doc("d-mint-max", "A.6.1.1.2.1.1", "USDS Mint Maximum", "The maximum USDS minted (`LIMIT_USDS_MINT`)."),
    doc("d-other", "A.6.1.1.3.1.1", "USDS Mint Maximum", "Another prime's (`LIMIT_USDS_MINT`)."),
  ],
  [
    ent(P, "grove", "Grove", "agent", "prime", { params: { "USDS Mint RateLimitID": [KMINT, "d-mint-id", "A.6.1.1.2.1.2"] } }),
    ent(I, "grove-vault", "Ethereum Mainnet - Vault", "instance", "allocation-system", { agent_doc_id: P, params: {
      "Inflow RateLimitID": [KIN, "d-in", "x"], "Outflow RateLimitID": [KOUT, "d-out", "x"],
      "Inflow Rate Limits / maxAmount": ["5,000,000 USDC", "d-in-lim", "x"], "Outflow Rate Limits / maxAmount": ["Unlimited", "d-out-lim", "x"],
      "Pool ID": [KPOOL, "d-pool", "x"], "Rate Limit IDs / BUIDLI_DEPOSIT": [LISTED, "d-listed", "x"],
    } }),
    ent(C, "grove-conduit", "USDC To USDG Via Paxos", "instance", "allocation-system", { agent_doc_id: P, params: {
      "Rate Limit IDs": [KCON, "d-con", "x"], "TransferAssets Rate Limits / maxAmount": ["50,000,000 USDC", "d-con-lim", "x"],
    } }),
  ],
  [],
  {},
);

const at = { block: 1, time: "2026-10-01T00:00:00.000Z", tx: "0x" + "9".repeat(64) };
const limit = (key: string, maxAmount: string, slope: string, extra: object = {}) => ({ key, configured: { maxAmount, slope }, setAt: at, changes: 2, data: { maxAmount, slope, lastAmount: maxAmount, lastUpdated: "1" }, available: maxAmount, ...extra });
const SNAP: StoredPauSnapshot = {
  deployment: `${P}:ethereum:diamond`, prime: P, primeName: "Grove", chain: "ethereum", kind: "diamond", fetchedAt: "2026-10-08T06:00:00.000Z",
  contracts: [
    { role: "rateLimits", address: RL, events: 9, historyComplete: true, rateLimits: [
      limit(KMINT, "50000000000000000000000000", "578703703703703703703", { derived: { constant: "LIMIT_USDS_MINT", args: [] } }),
      limit(KIN, "5000000000000", "57870370"),
      limit(KDER, "1500000000000", "0", { derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] } }),
      limit(KOFF, "0", "0"),
      limit(KADDR, "2000000000000", "0", { derived: { constant: "LIMIT_ASSET_TRANSFER", args: [VAULT, LISTED] }, unit: { decimals: 6, symbol: "PYUSD", token: VAULT, source: "token" } }),
    ], unsetKeys: [KOUT], beam: { beamState: BEAM, hop: "57600", maxChange: "1200000000000000000", historyComplete: true, defaults: [
      { key: KDER, maxAmount: "3000000000000", slope: "0", scope: "general", setAt: null, derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] }, unit: { decimals: 6, symbol: "USDC", token: VAULT, source: "token" } },
    ] } },
    { role: "controller", address: "0x" + "d".repeat(40), events: 2, historyComplete: false, roles: [{ role: "0xr", name: "RELAYER", account: RELAYER, since: at, holds: true }], agent: { actors: [{ account: RELAYER, since: at }] } },
  ],
};

const { primeAtlasRefs } = await import("./pau-atlas-refs.ts");
const { paramSide } = await import("../../lib/pauParams.ts");
const { snapshotFacts } = await import("./pau-source.ts");
const { valueFacts } = await import("./pau-value-facts.ts");
const fake: OnchainSource = { id: "pau", describe: "fake", read: async () => ({ facts: snapshotFacts(SNAP, primeAtlasRefs(ix, P, [SNAP])), coverage: [{ source: "pau", entity: "Grove", entity_id: P, chain: "ethereum", label: "diamond", contracts: 2, history_complete: false, read_at: SNAP.fetchedAt }] }) };
// A second source that fails while `failing` is set, read only by indexes built for that purpose.
let failing = false;
const flaky: OnchainSource = { id: "flaky", describe: "fails on demand", read: async () => (failing ? Promise.reject(new Error("db down")) : { facts: [], coverage: [] }) };
mock.module("./sources.ts", () => ({ ONCHAIN_SOURCES: [fake, flaky] }));
const { attachOnchain } = await import("./enrich.ts");
const { onchainState } = await import("./query.ts");

describe("primeAtlasRefs", () => {
  it("reads the operation a param names", () => {
    expect(["Aggregate Deposit RateLimitID", "Inflow Rate Limits", "Rate Limit IDs / redeem", "Swap RateLimitID (AUSD)", "Rate Limit IDs"].map(paramSide)).toEqual(["in", "in", "out", "swap", ""]);
  });
  it("ties a key to its own doc, its instance, and the value docs on its side; a key naming no side takes them all", () => {
    const refs = primeAtlasRefs(ix, P);
    expect([...refs.docs.get(KIN)!]).toEqual(["d-in", I, "d-in-lim"]);
    expect([...refs.docs.get(KOUT)!]).toEqual(["d-out", I, "d-out-lim"]);
    expect([...refs.docs.get(KCON)!]).toEqual(["d-con", C, "d-con-lim"]);
    expect(refs.docs.has(KPOOL)).toBe(false);
    expect(refs.labels.get(KMINT)?.[0]).toEqual({ docId: "d-mint-id", label: "USDS Mint" });
    expect(refs.constantDocs.get("LIMIT_USDS_MINT")).toEqual(["d-mint-max"]);
  });
});

describe("snapshotFacts", () => {
  const facts = snapshotFacts(SNAP, primeAtlasRefs(ix, P, [SNAP]));
  const byKey = (key: string) => facts.find((f) => f.values.key === key)!;
  it("scales amounts exactly, per day, by the token's decimals where read, else the ones it inferred", () => {
    expect(byKey(KMINT).values).toMatchObject({ maximum: { amount: "50000000" }, refill_per_day: { amount: "50000000" }, decimals: 18, decimals_source: "inferred" });
    expect(byKey(KIN).summary).toEqual({ key: KIN, maximum: "5000000", refill_per_day: "5000000", available: "5000000" });
    expect(byKey(KADDR).values).toMatchObject({ decimals: 6, decimals_source: "token", unit: "PYUSD", token: VAULT });
    expect(byKey(KADDR).summary).toMatchObject({ maximum: "2000000", unit: "PYUSD" });
  });
  it("says how far the Configurator may move a managed RateLimits, and lists each default it may set a key up to", () => {
    const step = facts.find((f) => f.kind === "beam-state")!;
    expect(step.values).toMatchObject({ beam_state: BEAM, hop_hours: 16, max_change: "1.2", defaults: 1 });
    expect(step.match.addresses).toEqual([RL, BEAM]);
    const def = facts.find((f) => f.kind === "rate-limit-default")!;
    expect(def).toMatchObject({ name: `LIMIT_4626_DEPOSIT · ${VAULT}`, name_source: "derived", set_at: null });
    expect(def.summary).toEqual({ key: KDER, maximum: "3000000", refill_per_day: "0", unit: "USDC", applies_to: "every RateLimits this BeamState manages" });
  });
  it("names a key by the atlas first, else by its derivation, and finds it by the docs and addresses it is about", () => {
    expect(byKey(KMINT)).toMatchObject({ name: "USDS Mint", name_source: "atlas", atlas_doc_id: "d-mint-id" });
    expect(byKey(KMINT).match.docs).toEqual(["d-mint-id", "d-mint-max"]);
    expect(byKey(KDER)).toMatchObject({ name: `LIMIT_4626_DEPOSIT · ${VAULT}`, name_source: "derived" });
    expect(byKey(KDER).match.addresses).toEqual([RL, VAULT]);
    expect(byKey(KOFF)).toMatchObject({ name: null, name_source: null });
    expect(byKey(KADDR)).toMatchObject({ name: "Vault · BUIDLI_DEPOSIT", name_source: "atlas-address", atlas_doc_id: "d-listed", values: { listed_address: LISTED } });
    expect(byKey(KADDR).match.docs).toEqual(["d-listed"]);
  });
  it("lists role holders and members with the history state of their contract", () => {
    expect(facts.filter((f) => f.kind === "role" || f.kind === "member").map((f) => [f.kind, f.name, f.history_complete])).toEqual([["role", "RELAYER", false], ["member", "actors", false]]);
  });
});

describe("valueFacts", () => {
  it("states each atlas value beside what the contract holds, or that the read contract lacks its key, found by the value's document and the instance", () => {
    const facts = valueFacts(ix, P, [SNAP]);
    expect(facts.map((f) => [f.kind, f.name, f.summary])).toEqual([
      ["atlas-vs-contract", "Ethereum Mainnet - Vault · Inflow maxAmount", { value: "Inflow maxAmount", atlas: "5,000,000 USDC", contract: "5000000", agrees: true }],
      ["atlas-vs-contract", "Ethereum Mainnet - Vault · Outflow maxAmount", { value: "Outflow maxAmount", atlas: "Unlimited", contract: "not set", agrees: false }],
    ]);
    expect(facts[1].set_at).toBeNull();
    expect(facts[0].match).toEqual({ hashes: [KIN], addresses: [RL], docs: ["d-in-lim", I] });
    expect(facts[0].set_at?.url).toBe(`https://etherscan.io/tx/${at.tx}`);
  });
});

describe("attachOnchain", () => {
  it("adds the facts a result names by key, document or address, compactly", async () => {
    const out = (await attachOnchain(ix, { rows: [{ uuid: I }], note: `see ${RELAYER}` })) as { onchain: { facts: Record<string, unknown>[]; note: string } };
    expect(out.onchain.facts.map((f) => f.name)).toEqual(["Vault · Inflow", "RELAYER", "actors"]);
    expect(out.onchain.facts[0]).toMatchObject({ maximum: "5000000", set_tx_url: `https://etherscan.io/tx/${at.tx}`, history_complete: true });
    expect(out.onchain.note).toMatch(/not atlas text/);
    expect(out.onchain).toMatchObject({ read_at: SNAP.fetchedAt, count: 3 });
  });
  it("leaves an error, and a result naming nothing on-chain, as they were", async () => {
    expect(await attachOnchain(ix, { error: KIN })).toEqual({ error: KIN });
    expect(await attachOnchain(ix, { rows: [] })).toEqual({ rows: [] });
  });
});

describe("a source that cannot be read", () => {
  it("is named in the result instead of reading as nothing set, and is read again on the next call", async () => {
    const fresh = buildIndexes([doc(P, "A.6.1.1.2", "Grove")], [], [], {});
    failing = true;
    expect(await onchainState(fresh, { kind: "role", limit: 5 })).toMatchObject({ sources_failed: ["flaky"], sources_failed_note: expect.stringContaining("missing, not absent") });
    expect(await attachOnchain(fresh, { rows: [] })).toMatchObject({ onchain: { sources_failed: ["flaky"], facts: [] } });
    failing = false;
    expect(await onchainState(fresh, { kind: "role", limit: 5 })).not.toHaveProperty("sources_failed");
  });
});

describe("atlas_onchain", () => {
  it("takes a chain by full, abbreviated or qualified name", async () => {
    for (const chain of ["ethereum", "eth", "Ethereum Mainnet"]) {
      const res = (await onchainState(ix, { chain, kind: "role", limit: 5 })) as { count: number; coverage: unknown[] };
      expect([chain, res.count, res.coverage.length]).toEqual([chain, 1, 1]);
    }
    expect(((await onchainState(ix, { chain: "base", limit: 5 })) as { count: number }).count).toBe(0);
  });

  it("filters by entity, matches 'deposit' to an Inflow limit, and leaves switched-off limits out unless asked", async () => {
    const res = (await onchainState(ix, { entity: "grove", kind: "rate-limit", query: "deposit", limit: 50 })) as { facts: { name: string }[]; coverage: unknown[] };
    expect(res.facts.map((f) => f.name)).toEqual([`LIMIT_4626_DEPOSIT · ${VAULT}`, "Vault · BUIDLI_DEPOSIT", "Vault · Inflow"]);
    expect(res.coverage).toHaveLength(1);
    const all = (await onchainState(ix, { kind: "rate-limit", include_off: true, limit: 2 })) as { count: number; truncated?: boolean; facts: object[] };
    expect([all.count, all.truncated, all.facts.length]).toEqual([5, true, 2]);
  });
  it("finds BeamState defaults by 'init', with the step limits that say what holds when there are none", async () => {
    const res = (await onchainState(ix, { entity: "grove", query: "init", limit: 50 })) as { facts: { kind: string }[] };
    expect(res.facts.map((f) => f.kind)).toEqual(["beam-state", "rate-limit-default"]);
  });
  it("filters by an address a fact is about, and refuses an unknown entity", async () => {
    const res = (await onchainState(ix, { address: RELAYER.toUpperCase().replace("0X", "0x"), limit: 50 })) as { facts: { kind: string }[] };
    expect(res.facts.map((f) => f.kind)).toEqual(["member", "role"]);
    expect(await onchainState(ix, { entity: "no-such-prime", limit: 5 })).toMatchObject({ error: expect.stringContaining("no-such-prime") });
  });
});
