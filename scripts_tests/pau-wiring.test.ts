// Wiring checks against a fake chain. The cases are the ones the real run
// surfaced: a controller the atlas still lists after a spell rotated it out
// (the live one comes back as a proposal from the RateLimits grant history),
// a controller pointing at a proxy the registry lacks, a diamond's actors and
// facets enumerated on-chain, and an explorer that refuses the history query.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplorerLog, LogFetcher } from "../scripts/lib/explorer-logs.ts";
import { checkRegistryWiring } from "../scripts/lib/pau-wiring-check.ts";
import { rpcReader, type Reader } from "../scripts/lib/pau-wiring.ts";
import type { PauDeployment, PauRegistry } from "../src/lib/pauRegistry.ts";

const P = "11111111-1111-4111-8111-111111111111";
const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const [CTRL, PROXY, RL, OTHER_PROXY, LIVE, RELAYER, FREEZER, AGENT, FACET, SHARED_FACET, BEACON] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(a);
const ROLE = { CONTROLLER: "0xc0", FREEZER: "0xf0", RELAYER: "0xe0" };
const m = (role: PauDeployment["members"][0]["role"], address: string) => ({ role, address, provenance: [{ source: "manual" as const }] });

/** A chain as a table of `address.fn(args)` → value; anything missing reverts (null). */
function fakeReader(state: Record<string, unknown>): Reader {
  return async (_chain, calls) => calls.map((c) => state[`${c.address}.${c.functionName}(${(c.args ?? []).map(String).join(",")})`] ?? null);
}
const granted = (account: string, ts: number): ExplorerLog => ({
  address: RL, topics: ["0x2f87", ROLE.CONTROLLER, `0x${account.slice(2).padStart(64, "0")}`, "0x0"], data: "0x", blockNumber: ts, timeStamp: ts, transactionHash: `0x${ts}`, logIndex: 0,
});

const monolith: PauDeployment = {
  prime: P, primeName: "P", chain: "base", kind: "monolithic",
  members: [m("controller", CTRL), m("almProxy", PROXY), m("rateLimits", RL), m("relayer", RELAYER), m("freezer", FREEZER)],
};
const registry = (deployments: PauDeployment[]): PauRegistry => ({ shared: [{ chain: "base", members: [m("facet", SHARED_FACET), m("beacon", BEACON)] }], deployments, ignored: [] });

const monolithChain = {
  [`${CTRL}.proxy()`]: OTHER_PROXY,
  [`${CTRL}.rateLimits()`]: RL,
  [`${CTRL}.FREEZER()`]: ROLE.FREEZER,
  [`${CTRL}.RELAYER()`]: ROLE.RELAYER,
  [`${CTRL}.hasRole(${ROLE.FREEZER},${FREEZER})`]: true,
  [`${CTRL}.hasRole(${ROLE.RELAYER},${RELAYER})`]: false,
  [`${RL}.CONTROLLER()`]: ROLE.CONTROLLER,
  [`${RL}.hasRole(${ROLE.CONTROLLER},${LIVE})`]: true,
  [`${RL}.hasRole(${ROLE.CONTROLLER},${CTRL})`]: false,
};

describe("monolithic wiring", () => {
  it("proposes the live controller and the proxy the controller actually points at", async () => {
    const logs: LogFetcher = async () => [granted(CTRL, 1_700_000_000), granted(LIVE, 1_760_000_000)];
    const r = await checkRegistryWiring(registry([monolith]), fakeReader(monolithChain), logs);
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.check).sort();
    expect(failed).toEqual(["live controller", "proxy", `relayer ${RELAYER}`]);
    expect(r.proposals.map((p) => `${p.role} ${p.address}`).sort()).toEqual([`almProxy ${OTHER_PROXY}`, `controller ${LIVE}`]);
    expect(r.proposals.find((p) => p.role === "controller")!.note).toMatch(/granted 2025-10-09/);
  });
  it("still verifies the listed controller when the explorer refuses the history", async () => {
    const logs: LogFetcher = async () => {
      throw new Error("explorer logs: HTTP 403");
    };
    const r = await checkRegistryWiring(registry([monolith]), fakeReader(monolithChain), logs);
    const live = r.checks.find((c) => c.check === "live controller")!;
    expect(live.ok).toBe(false);
    expect(live.detail).toMatch(/HTTP 403/);
    expect(r.proposals.some((p) => p.role === "controller")).toBe(false);
  });
});

describe("diamond wiring", () => {
  const diamond: PauDeployment = {
    prime: P, primeName: "P", chain: "base", kind: "diamond",
    members: [m("controller", CTRL), m("almProxy", PROXY), m("rateLimits", RL), m("administeredAgent", AGENT), m("relayer", RELAYER), m("relayer", a(99))],
  };
  const chain = {
    [`${CTRL}.proxy()`]: PROXY,
    [`${CTRL}.rateLimits()`]: RL,
    [`${CTRL}.beacon()`]: BEACON,
    [`${CTRL}.integrations()`]: [{ id: "0x1", config: { facet: FACET } }],
    [`${AGENT}.actorCount()`]: 1n,
    [`${AGENT}.getActor(0)`]: RELAYER,
    [`${AGENT}.revokerCount()`]: 1n,
    [`${AGENT}.getRevoker(0)`]: FREEZER,
    [`${RL}.CONTROLLER()`]: ROLE.CONTROLLER,
    [`${RL}.hasRole(${ROLE.CONTROLLER},${CTRL})`]: true,
  };
  it("compares enumerated facets, actors and revokers with the registry both ways", async () => {
    const r = await checkRegistryWiring(registry([diamond]), fakeReader(chain), null);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.check).sort()).toEqual(["accessControls", `relayer ${a(99)}`]);
    expect(r.proposals.map((p) => `${p.role} ${p.address}`).sort()).toEqual([`facet ${FACET}`, `freezer ${FREEZER}`]);
  });
});

describe("rpcReader", () => {
  afterEach(() => vi.unstubAllEnvs());
  const calls = [{ address: CTRL, functionName: "proxy" }, { address: RL, functionName: "CONTROLLER" }];
  it("answers null for every call on a chain with no RPC", async () => {
    expect(await rpcReader()("not-a-chain", calls)).toEqual([null, null]);
  });
  it("fails an unreachable chain's calls instead of the whole run", async () => {
    vi.stubEnv("RPC_URL_BASE", "http://127.0.0.1:1");
    expect(await rpcReader()("base", calls)).toEqual([null, null]);
  });
});
