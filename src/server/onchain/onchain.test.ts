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
      "Pool ID": [KPOOL, "d-pool", "x"],
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
    ] },
    { role: "controller", address: "0x" + "d".repeat(40), events: 2, historyComplete: false, roles: [{ role: "0xr", name: "RELAYER", account: RELAYER, since: at, holds: true }], agent: { actors: [{ account: RELAYER, since: at }] } },
  ],
};

const { paramSide, primeAtlasRefs } = await import("./pau-atlas-refs.ts");
const { snapshotFacts } = await import("./pau-source.ts");
const fake: OnchainSource = { id: "pau", describe: "fake", read: async () => ({ facts: snapshotFacts(SNAP, primeAtlasRefs(ix, P)), coverage: [{ source: "pau", entity: "Grove", entity_id: P, chain: "ethereum", label: "diamond", contracts: 2, history_complete: false, read_at: SNAP.fetchedAt }] }) };
mock.module("./sources.ts", () => ({ ONCHAIN_SOURCES: [fake] }));
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
  const facts = snapshotFacts(SNAP, primeAtlasRefs(ix, P));
  const byKey = (key: string) => facts.find((f) => f.values.key === key)!;
  it("scales amounts exactly, per day, with the decimals it inferred", () => {
    expect(byKey(KMINT).values).toMatchObject({ maximum: { amount: "50000000" }, refill_per_day: { amount: "50000000" }, decimals: 18 });
    expect(byKey(KIN).summary).toEqual({ key: KIN, maximum: "5000000", refill_per_day: "5000000", available: "5000000" });
  });
  it("names a key by the atlas first, else by its derivation, and finds it by the docs and addresses it is about", () => {
    expect(byKey(KMINT)).toMatchObject({ name: "USDS Mint", name_source: "atlas", atlas_doc_id: "d-mint-id" });
    expect(byKey(KMINT).match.docs).toEqual(["d-mint-id", "d-mint-max"]);
    expect(byKey(KDER)).toMatchObject({ name: `LIMIT_4626_DEPOSIT · ${VAULT}`, name_source: "derived" });
    expect(byKey(KDER).match.addresses).toEqual([RL, VAULT]);
    expect(byKey(KOFF)).toMatchObject({ name: null, name_source: null });
  });
  it("lists role holders and members with the history state of their contract", () => {
    expect(facts.filter((f) => f.kind !== "rate-limit").map((f) => [f.kind, f.name, f.history_complete])).toEqual([["role", "RELAYER", false], ["member", "actors", false]]);
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

describe("atlas_onchain", () => {
  it("filters by entity, matches 'deposit' to an Inflow limit, and leaves switched-off limits out unless asked", async () => {
    const res = (await onchainState(ix, { entity: "grove", kind: "rate-limit", query: "deposit", limit: 50 })) as { facts: { name: string }[]; coverage: unknown[] };
    expect(res.facts.map((f) => f.name)).toEqual([`LIMIT_4626_DEPOSIT · ${VAULT}`, "Vault · Inflow"]);
    expect(res.coverage).toHaveLength(1);
    const all = (await onchainState(ix, { kind: "rate-limit", include_off: true, limit: 2 })) as { count: number; truncated?: boolean; facts: object[] };
    expect([all.count, all.truncated, all.facts.length]).toEqual([4, true, 2]);
  });
  it("filters by an address a fact is about, and refuses an unknown entity", async () => {
    const res = (await onchainState(ix, { address: RELAYER.toUpperCase().replace("0X", "0x"), limit: 50 })) as { facts: { kind: string }[] };
    expect(res.facts.map((f) => f.kind)).toEqual(["member", "role"]);
    expect(await onchainState(ix, { entity: "no-such-prime", limit: 5 })).toMatchObject({ error: expect.stringContaining("no-such-prime") });
  });
});
