// A leaf under "<…> Rate Limits" > chain that lists maxAmount/slope bullets is a
// value source of its own: keyed by the hash the prime states under the same
// name, else by the controller constant its text names, on the chain heading's
// chain and the heading's deployment kind, and shown beside the heading above it.
import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types.ts";
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { checkAtlasValues } from "./pauAtlasValues.ts";
import { withInstanceLimitDocs } from "./pauInstanceLimitDocs.ts";
import { limitDocSources, limitHeadingScope, type LimitDocs } from "./pauLimitDocs.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

const node = (id: string, title: string, content = ""): AtlasNode => ({ id, doc_no: id, title, type: "Core", depth: 6, parentId: null, content, order: 0, addressRefs: [] });
const tree: [string | null, AtlasNode[]][] = [
  [null, [node("spark", "Spark")]],
  ["spark", [node("diamond", "Diamond PAU Rate Limits", "The documents herein list the rate limits."), node("mono", "RateLimits"), node("loose", "Loose Limit", "- `maxAmount`: 1")]],
  ["diamond", [node("arb", "Arbitrum")]],
  ["arb", [node("agg", "Aggregate CCTP Limit", "Specified herein.\n\n- `maxAmount`: Unlimited"), node("eth", "CCTP To Ethereum Limit", "Specified herein.\n\n- `maxAmount`: 5,000,000 USDC\n- `slope`: 50,000,000 USDC per day")]],
  ["mono", [node("main", "Ethereum Mainnet")]],
  ["main", [node("mint", "USDS Mint Maximum", "The maximum (`LIMIT_USDS_MINT`) is specified herein.\n\n- `maxAmount`: 1,000,000,000 USDS\n- `slope`: 1,000,000,000 USDS per day"), node("plain", "Ethereum Mainnet Notes")]],
];
const docs: LimitDocs = { byParent: new Map(tree), docs: Object.fromEntries(tree.flatMap(([, kids]) => kids).map((n) => [n.id, n])) };
const [K_AGG, K_ETH, K_MINT] = ["1", "2", "3"].map((c) => "0x" + c.repeat(64));
const prime: ValueSource = { name: "Spark", docId: null, params: { "Aggregate CCTP Rate Limit ID": [K_AGG, "idDoc1"], "CCTP To Ethereum Rate Limit ID": [K_ETH, "idDoc2"] } };

const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const usdc = { decimals: 6, symbol: "USDC", source: "token" as const };
const UNL = ((1n << 256n) - 1n).toString();
const lim = (key: string, maxAmount: string, slope: string, derived?: LiveRateLimit["derived"]): LiveRateLimit => ({
  key, configured: { maxAmount, slope }, setAt: at, changes: 1, data: { maxAmount, slope, lastAmount: "0", lastUpdated: "0" }, available: maxAmount, unit: usdc, ...(derived ? { derived } : {}),
});
const snap = (chain: string, kind: "diamond" | "monolithic", rateLimits: LiveRateLimit[]): StoredPauSnapshot => ({
  deployment: `spark:${chain}:${kind}`, prime: "spark", primeName: "Spark", chain, kind, fetchedAt: "t",
  contracts: [{ role: "rateLimits", address: "0x" + "e".repeat(40), events: 1, historyComplete: true, rateLimits }],
});

describe("limitDocSources", () => {
  it("makes a source of each leaf in the shape, on its chain and deployment kind, and none of a leaf outside it", () => {
    const sources = limitDocSources(prime, "spark", docs);
    expect(sources.map((s) => [s.name, s.kind, s.constant])).toEqual([
      ["Arbitrum - Aggregate CCTP Limit", "diamond", undefined],
      ["Arbitrum - CCTP To Ethereum Limit", "diamond", undefined],
      ["Ethereum Mainnet - USDS Mint Maximum", undefined, "LIMIT_USDS_MINT"],
    ]);
  });
  it("checks each leaf's stated values against the chain: by the prime's stated key, or by the constant it names", () => {
    const snaps = [
      snap("arbitrum", "diamond", [lim(K_AGG, UNL, "0"), lim(K_ETH, "5000000000000", "578703703")]),
      snap("ethereum", "monolithic", [{ ...lim(K_MINT, "1000000000000000000000000000", "11574074074074074074074", { constant: "LIMIT_USDS_MINT", args: [] }), unit: { decimals: 18, symbol: "USDS", source: "token" as const } }]),
    ];
    const checks = checkAtlasValues(limitDocSources(prime, "spark", docs), snaps);
    expect(checks.map((c) => [c.docId, c.label, c.key, c.status])).toEqual([
      ["agg", "Aggregate CCTP maxAmount", K_AGG, "match"],
      ["eth", "CCTP To Ethereum maxAmount", K_ETH, "match"],
      ["eth", "CCTP To Ethereum slope", K_ETH, "match"],
      ["mint", "USDS Mint maxAmount", K_MINT, "match"],
      ["mint", "USDS Mint slope", K_MINT, "match"],
    ]);
  });
  it("reads only the deployment kind the heading names", () => {
    const snaps = [snap("arbitrum", "monolithic", [lim(K_ETH, "5000000000000", "57870370")])];
    expect(checkAtlasValues(limitDocSources(prime, "spark", docs), snaps).filter((c) => c.docId === "eth").map((c) => c.status)).toEqual(["no-deployment", "no-deployment"]);
  });
});

describe("a Rate Limits heading whose text names the chain", () => {
  const stated = (text: string) => {
    const kids: [string | null, AtlasNode[]][] = [
      [null, [node("osero", "Osero")]],
      ["osero", [node("dl", "Diamond PAU Rate Limits", text)]],
      ["dl", [node("burn", "USDS Burn Maximum", "The maximum (`LIMIT_USDS_BURN`) is specified herein.\n\n- `maxAmount`: 50,000,000 USDS\n- `slope`: 50,000,000 USDS per day")]],
    ];
    return { byParent: new Map(kids), docs: Object.fromEntries(kids.flatMap(([, k]) => k).map((n) => [n.id, n])) } satisfies LimitDocs;
  };
  const os: ValueSource = { name: "Osero", docId: null, params: {} };
  it("takes that chain and the heading's deployment kind for a leaf directly under the heading", () => {
    const d = stated("The documents herein list the controller-wide rate limits for the Osero Diamond PAU on Ethereum Mainnet. Values are set via a cBEAM; the on-chain value can be queried.");
    expect(limitDocSources(os, "osero", d).map((s) => [s.name, s.kind, s.constant])).toEqual([["Ethereum Mainnet - USDS Burn Maximum", "diamond", "LIMIT_USDS_BURN"]]);
  });
  it("reads no chain when the text names none, or names two", () => {
    expect(limitDocSources(os, "osero", stated("The documents herein list the rate limits."))).toEqual([]);
    expect(limitDocSources(os, "osero", stated("Limits on Ethereum Mainnet and on Base."))).toEqual([]);
  });
});

describe("limitHeadingScope", () => {
  it("covers everything below a Rate Limits heading or a chain heading under one, and nothing for other documents", () => {
    expect(limitHeadingScope("diamond", docs).sort()).toEqual(["agg", "arb", "eth"]);
    expect(limitHeadingScope("arb", docs).sort()).toEqual(["agg", "eth"]);
    expect(limitHeadingScope("main", docs).sort()).toEqual(["mint", "plain"]);
    expect(limitHeadingScope("agg", docs)).toEqual([]);
    expect(limitHeadingScope("spark", docs)).toEqual([]);
  });
});

describe("a group heading between the chain and the leaf", () => {
  const nested: [string | null, AtlasNode[]][] = [
    [null, [node("keel", "Keel")]],
    ["keel", [node("rl", "Rate Limits")]],
    ["rl", [node("kmain", "Ethereum Mainnet")]],
    ["kmain", [node("kusds", "Ethereum Mainnet USDS"), node("ksusds", "Ethereum Mainnet sUSDS")]],
    ["kusds", [node("kmint", "USDS Mint Maximum", "(`LIMIT_USDS_MINT`) is specified herein.\n\n- `maxAmount`: 1,000,000,000 USDS")]],
    ["ksusds", [node("kdep", "sUSDS Deposit Maximum", "(`LIMIT_4626_DEPOSIT`) is specified herein.\n\n- `maxAmount`: 100,000,000 USDS"), node("kdom", "Bridged To Solana", "(`LIMIT_USDC_TO_DOMAIN`, hashed with Solana domain) is specified herein.\n\n- `maxAmount`: 5,000,000 USDC")]],
  ];
  const nestedDocs: LimitDocs = { byParent: new Map(nested), docs: Object.fromEntries(nested.flatMap(([, kids]) => kids).map((n) => [n.id, n])) };

  it("reads the leaf, names its constant, and leaves a hashed constant unnamed", () => {
    expect(limitDocSources({ name: "Keel", docId: null, params: {} }, "keel", nestedDocs).map((s) => [s.name, s.constant])).toEqual([
      ["Ethereum Mainnet - USDS Mint Maximum", "LIMIT_USDS_MINT"],
      ["Ethereum Mainnet - sUSDS Deposit Maximum", "LIMIT_4626_DEPOSIT"],
      ["Ethereum Mainnet - Bridged To Solana", undefined],
    ]);
  });
  it("keys a constant by the one key of it a deployment holds, and by none where it holds several", () => {
    const one = lim("0x" + "5".repeat(64), "100000000000000000000000000", "0", { constant: "LIMIT_4626_DEPOSIT", args: ["0xvault"] });
    const unit18 = { decimals: 18, symbol: "USDS", source: "token" as const };
    const sources = limitDocSources({ name: "Keel", docId: null, params: {} }, "keel", nestedDocs).filter((s) => s.constant === "LIMIT_4626_DEPOSIT");
    const held = (...limits: LiveRateLimit[]) => checkAtlasValues(sources, [snap("ethereum", "monolithic", limits.map((l) => ({ ...l, unit: unit18 })))]).map((c) => c.status);
    expect(held(one)).toEqual(["match"]);
    expect(held(one, lim("0x" + "6".repeat(64), "1", "0", { constant: "LIMIT_4626_DEPOSIT", args: ["0xother"] }))).toEqual(["no-key"]);
  });
});

describe("withInstanceLimitDocs", () => {
  const inst: [string | null, AtlasNode[]][] = [
    [null, [node("inst", "Ethereum Mainnet - Spark Savings v2 USDC Instance Configuration Document")]],
    ["inst", [node("risk", "Risk Parameters Current Configuration")]],
    ["risk", [node("take", "Take Rate Limits", "The take rate limits are:\n\n- `maxAmount`: Unlimited"), node("other", "Spark Savings USDC Risk Parameters", "- Supply cap: 2,000,000,000 USDC")]],
  ];
  const instDocs: LimitDocs = { byParent: new Map(inst), docs: Object.fromEntries(inst.flatMap(([, kids]) => kids).map((n) => [n.id, n])) };
  const VAULT = "0x28b3a8fb53b741a8fd78c0fb9a6b2393d896a43d";
  const src: ValueSource = { name: "Ethereum Mainnet - Spark Savings v2 USDC instance", docId: "inst", params: { "Token Address": [VAULT, "tokenDoc"] } };

  it("adds the values the instance's subtree states in a leaf titled '<X> Rate Limits', and nothing already carried", () => {
    const out = withInstanceLimitDocs(src, instDocs);
    expect(out.params["Take Rate Limits / maxAmount"]).toEqual(["Unlimited", "take"]);
    expect(withInstanceLimitDocs(out, instDocs)).toBe(out);
    expect(withInstanceLimitDocs({ ...src, docId: null }, instDocs).params).toBe(src.params);
  });
  it("compares a take limit with the vault's LIMIT_SPARK_VAULT_TAKE key the instance's token address derives", () => {
    const key = lim("0x" + "7".repeat(64), UNL, "0", { constant: "LIMIT_SPARK_VAULT_TAKE", args: [VAULT] });
    const checks = checkAtlasValues([withInstanceLimitDocs(src, instDocs)], [snap("ethereum", "monolithic", [key])]);
    expect(checks.map((c) => [c.docId, c.label, c.status, c.via])).toEqual([["take", "Take maxAmount", "match", VAULT]]);
  });
});
