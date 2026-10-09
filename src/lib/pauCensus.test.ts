// The PAU census record: values keyed by the stating document's UUID and
// field, one slot per deployment and key, the raw chain value kept only where
// the two disagree, every prime stating values counted even without a
// deployment, and a baseline file that reads back as the same record.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { formatCensus, pauCensus } from "./pauCensus.ts";
import type { SourceEntity } from "./pauPrimeSources.ts";

const k = (c: string) => "0x" + c.repeat(64);
const [K_IN, K_OUT] = [k("1"), k("2")];
const usdc = { decimals: 6, symbol: "USDC", source: "token" as const };
const lim = (key: string, maxAmount: string, slope: string): LiveRateLimit => ({
  key, configured: { maxAmount, slope }, setAt: { block: 1, time: "t", tx: "0xt" }, changes: 1,
  data: { maxAmount, slope, lastAmount: "0", lastUpdated: "0" }, available: maxAmount, unit: usdc,
});
const snap = (prime: string, rateLimits: LiveRateLimit[]): StoredPauSnapshot => ({
  deployment: `${prime}:ethereum`, prime, primeName: prime, chain: "ethereum", kind: "monolithic", fetchedAt: "t",
  contracts: [{ role: "rateLimits", address: "0x" + "f".repeat(40), events: 1, historyComplete: true, rateLimits }],
});
const params = (p: Record<string, string>) => Object.fromEntries(Object.entries(p).map(([name, v], i) => [name, [v, `doc-${name.split(" ")[0]}-${i}`]]));
const entity = (id: string, name: string, type: string, meta: object): SourceEntity => ({ id, name, entity_type: type, defining_doc_id: id, meta: JSON.stringify(meta) });

const ENTITIES = [
  entity("p1", "Prime One", "participant", {}),
  entity("p2", "Prime Two", "participant", {}),
  entity("i1", "Ethereum Mainnet - Vault", "instance", {
    agent_doc_id: "p1",
    params: params({ "Inflow RateLimitID": K_IN, "Outflow RateLimitID": K_OUT, "Inflow Rate Limits / maxAmount": "5,000,000 USDC", "Outflow Rate Limits / maxAmount": "1 USDC" }),
  }),
  entity("i2", "Solana - Pool", "instance", { agent_doc_id: "p2", params: params({ "Deposit Rate Limits / maxAmount": "1,000 USDC" }) }),
];
const SNAPS = [snap("p1", [lim(K_IN, "5000000000000", "0"), lim(K_OUT, "2000000", "0")])];
const DOC_NOS: Record<string, string> = { "doc-Inflow-2": "A.1.2", "doc-Outflow-3": "A.1.3" };
const census = () => pauCensus(ENTITIES, (id) => DOC_NOS[id] ?? null, SNAPS);

describe("pauCensus", () => {
  it("keys values by the stating document and field, with one slot per deployment and key", () => {
    const c = census();
    expect(Object.keys(c.values)).toEqual(["doc-Deposit-0:maxAmount", "doc-Inflow-2:maxAmount", "doc-Outflow-3:maxAmount"]);
    expect(c.values["doc-Inflow-2:maxAmount"]).toEqual({
      prime: "p1", doc_no: "A.1.2", instance: "Ethereum Mainnet - Vault", label: "Inflow maxAmount", stated: "5,000,000 USDC", at: { [`ethereum/monolithic/${K_IN}`]: "match" },
    });
  });
  it("keeps the raw chain value of a disagreement, and how it reads", () => {
    expect(census().values["doc-Outflow-3:maxAmount"].at).toEqual({ [`ethereum/monolithic/${K_OUT}`]: ["mismatch", "2000000", "2 USDC"] });
  });
  it("counts a prime that states values but has no deployment", () => {
    const c = census();
    expect(c.values["doc-Deposit-0:maxAmount"]).toMatchObject({ prime: "p2", at: { "solana/-/-": "no-deployment" } });
    expect(c.counts).toEqual({ match: 1, mismatch: 1, "no-deployment": 1 });
    expect(c.deployments).toEqual(["p1/ethereum/monolithic"]);
  });
  it("writes one line per value and reads back as the same record", () => {
    const text = formatCensus(census(), "fixture");
    expect(text.split("\n").filter((l) => l.startsWith('    "doc-'))).toHaveLength(3);
    expect(JSON.parse(text)).toEqual({ source: "fixture", ...census() });
  });
});
