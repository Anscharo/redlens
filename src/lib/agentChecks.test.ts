import { describe, expect, it } from "vitest";
import type { ContractState, StoredPauSnapshot } from "./pau.ts";
import { checkAgentInstances, type ChainValues } from "./agentChecks.ts";
import { addressCheckId } from "./pauAddressChecks.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

const [SUB, OTHER, TOKEN, BASE_TOKEN] = ["1", "2", "3", "4"].map((c) => "0x" + c.repeat(40));
const ADMIN = "0x" + "0".repeat(64);
const at = { block: 1, time: "t", tx: "0xt" };

const contract = (role: ContractState["role"], admin: string, holds = true): ContractState => ({
  role, address: "0x" + role.length.toString().repeat(40).slice(0, 40), events: 1, historyComplete: true,
  roles: [{ role: ADMIN, account: admin, since: at, name: null, holds }],
});
const snap = (contracts: ContractState[], chain = "ethereum"): StoredPauSnapshot => ({ deployment: "d", prime: "p", primeName: "P", chain, kind: "monolithic", contracts, fetchedAt: "t" });

const src = (docId: string, params: Record<string, string>): ValueSource => ({
  name: "Spark's Instance", docId, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v, docId]])),
});
const get = (s: ValueSource, name: string, snaps: StoredPauSnapshot[] = [], values: ChainValues | null = null) => checkAgentInstances([s], snaps, values).get(addressCheckId(s.docId!, name));

describe("checkAgentInstances: SubProxy Account", () => {
  const creation = src("c", { "SubProxy Account / Ethereum Mainnet": SUB });
  const name = "SubProxy Account / Ethereum Mainnet";
  it("finds the SubProxy holding the admin role on the Prime's controller contracts", () => {
    expect(get(creation, name, [snap([contract("controller", SUB), contract("rateLimits", SUB)])])).toMatchObject({ status: "match", lines: [{ label: "Admin of", value: "Controller, Rate limits" }] });
  });
  it("flags a different on-chain admin, and does not count a grant the chain denies", () => {
    expect(get(creation, name, [snap([contract("controller", OTHER), contract("rateLimits", SUB, false)])])).toMatchObject({ status: "mismatch", lines: [{ label: "On-chain admin", value: "0x2222…2222" }, { label: "Atlas" }] });
  });
  it("says not yet indexed where nothing on Ethereum is", () => {
    expect(get(creation, name, [snap([contract("controller", SUB)], "base")])).toMatchObject({ status: "unsure", lines: [{ text: "Param or contract not yet indexed." }] });
  });
});

describe("checkAgentInstances: Agent Token", () => {
  const values: ChainValues = { [TOKEN.toUpperCase().replace("0X", "0x")]: { name: "Spark", symbol: "SPK", decimals: "18", totalSupply: "9999999999000000000000000000" } };
  const token = src("t", {
    "Token Name": "spark", "Token Symbol": "SPK", "Genesis Supply": "10 billion",
    "Token Address (Ethereum Mainnet)": TOKEN, "Token Address (Base)": BASE_TOKEN,
  });
  it("matches the name (in any case), the symbol and the address against chain_state", () => {
    expect(get(token, "Token Name", [], values)?.status).toBe("match");
    expect(get(token, "Token Symbol", [], values)?.status).toBe("match");
    expect(get(token, "Token Address (Ethereum Mainnet)", [], values)).toMatchObject({ status: "match", lines: [{ value: "Spark" }, { value: "SPK" }] });
  });
  it("flags a supply that differs, saying burns and emissions change it", () => {
    const c = get(token, "Genesis Supply", [], values);
    expect(c).toMatchObject({ status: "mismatch", lines: [{ label: "On-chain", value: "9,999,999,999" }, { label: "Atlas", value: "10 billion" }, { text: expect.stringContaining("burns or emissions") }] });
  });
  it("says a token on a chain chain_state does not read is not yet indexed, and checks nothing before chain_state loads", () => {
    expect(get(token, "Token Address (Base)", [], values)?.status).toBe("unsure");
    expect(get(token, "Token Name", [], null)).toBeUndefined();
  });
  it("flags a value the atlas leaves to be specified while the token is on-chain", () => {
    const unstated = src("u", { "Token Symbol": "SPK", "Genesis Supply": "The Genesis Supply of SPK will be specified in a future iteration.", "Token Address (Ethereum Mainnet)": TOKEN });
    expect(get(unstated, "Genesis Supply", [], values)).toMatchObject({ status: "candidate", lines: [{ value: "9,999,999,999" }] });
  });
  it("checks nothing for a token the atlas has not given an address yet", () => {
    expect(get(src("k", { "Token Symbol": "KEEL", "Genesis Supply": "10 billion", "Token Address": "will be specified in a future iteration" }), "Token Symbol", [], values)).toBeUndefined();
  });
});
