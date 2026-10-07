// The event replays: grants then revokes leave the right holders, the latest
// setting wins, removals delete, and each value remembers where it was set.
import { describe, expect, it } from "bun:test";
import { keccak256, toHex } from "viem";
import { replayAgent, replayIntegrations, replayParams, replayRateLimitKeys, replayRoles, roleName, type PauEventRow } from "./replay.ts";

const RELAYER = keccak256(toHex("RELAYER"));
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
let block = 0;
const ev = (event: string, args: Record<string, unknown>): PauEventRow => {
  block++;
  return { contract: "0xc", event, args, block, block_time: `2026-01-0${block}T00:00:00.000Z`, tx_hash: `0x${block}` };
};

describe("roleName", () => {
  it("names the well-known roles and nothing else", () => {
    expect(roleName(RELAYER)).toBe("RELAYER");
    expect(roleName(`0x${"0".repeat(64)}`)).toBe("DEFAULT_ADMIN_ROLE");
    expect(roleName(`0x${"1".repeat(64)}`)).toBeNull();
  });
});

describe("replayRoles", () => {
  it("keeps the first grant's date, drops revoked holders, and re-adds a later grant", () => {
    block = 0;
    const holders = replayRoles([
      ev("RoleGranted", { role: RELAYER, account: A }),
      ev("RoleGranted", { role: RELAYER, account: A }),
      ev("RoleGranted", { role: RELAYER, account: B }),
      ev("RoleRevoked", { role: RELAYER, account: B }),
      ev("RoleGranted", { role: RELAYER, account: B }),
    ]);
    expect(holders).toEqual([
      { role: RELAYER, account: A, since: { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0x1" } },
      { role: RELAYER, account: B, since: { block: 5, time: "2026-01-05T00:00:00.000Z", tx: "0x5" } },
    ]);
  });
});

describe("replayAgent", () => {
  it("groups AdministeredAgent members by kind and drops removed ones", () => {
    block = 0;
    const agent = replayAgent([ev("ActorAdded", { account: A }), ev("RevokerAdded", { account: B }), ev("AdminAdded", { account: A }), ev("AdminRemoved", { account: A })]);
    expect(Object.keys(agent).sort()).toEqual(["actors", "admins", "revokers"]);
    expect(agent.actors.map((x) => x.account)).toEqual([A]);
    expect(agent.admins).toEqual([]);
  });
});

describe("replayRateLimitKeys", () => {
  it("keeps every key with its latest setting and a change count", () => {
    block = 0;
    const keys = replayRateLimitKeys([
      ev("RateLimitDataSet", { key: "0xk1", maxAmount: "1", slope: "2" }),
      ev("RoleGranted", { role: RELAYER, account: A }),
      ev("RateLimitDataSet", { key: "0xk2", maxAmount: "5", slope: "0" }),
      ev("RateLimitDataSet", { key: "0xk1", maxAmount: "3", slope: "4" }),
    ]);
    expect(keys).toEqual([
      { key: "0xk1", configured: { maxAmount: "3", slope: "4" }, setAt: { block: 4, time: "2026-01-04T00:00:00.000Z", tx: "0x4" }, changes: 2 },
      { key: "0xk2", configured: { maxAmount: "5", slope: "0" }, setAt: { block: 3, time: "2026-01-03T00:00:00.000Z", tx: "0x3" }, changes: 1 },
    ]);
  });
});

describe("replayIntegrations", () => {
  it("replaces on set and deletes on remove", () => {
    block = 0;
    const live = replayIntegrations([
      ev("IntegrationSet", { id: "0x1", config: { facet: A } }),
      ev("IntegrationSet", { id: "0x2", config: { facet: B } }),
      ev("IntegrationSet", { id: "0x1", config: { facet: B } }),
      ev("IntegrationRemoved", { id: "0x2" }),
    ]);
    expect(live.map((x) => [x.id, x.config])).toEqual([["0x1", { facet: B }]]);
  });
});

describe("replayParams", () => {
  it("keeps the latest value per event and subject, and skips non-parameter events", () => {
    block = 0;
    const params = replayParams([
      ev("MaxSlippageSet", { pool: A, maxSlippage: "1" }),
      ev("MaxSlippageSet", { pool: B, maxSlippage: "2" }),
      ev("MaxSlippageSet", { pool: A, maxSlippage: "3" }),
      ev("RoleGranted", { role: RELAYER, account: A }),
      ev("RelayerRemoved", { relayer: A }),
      ev("ActorAdded", { account: A }),
      ev("RateLimitDataSet", { key: "0xk", maxAmount: "1", slope: "1" }),
      ev("IntegrationSet", { id: "0x1", config: {} }),
    ]);
    expect(params.map((p) => [p.event, p.subject, p.args.maxSlippage, p.setAt.block])).toEqual([
      ["MaxSlippageSet", A, "3", 3],
      ["MaxSlippageSet", B, "2", 2],
    ]);
  });
});

describe("replayParams with args read back from jsonb", () => {
  // jsonb orders keys by length then bytewise, so the event's first argument
  // is often not the first key; the subject must come from the ABI.
  const jsonbOrder = (args: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)));
  it("keys each parameter by its ABI subject, so a re-set replaces the old value", () => {
    block = 0;
    const params = replayParams([
      ev("MintRecipientSet", jsonbOrder({ destinationDomain: 3, mintRecipient: "0xold" })),
      ev("MintRecipientSet", jsonbOrder({ destinationDomain: 3, mintRecipient: "0xnew" })),
      ev("CentrifugeRecipientSet", jsonbOrder({ centrifugeId: 7, recipient: "0xr" })),
      ev("CCTPDomainParametersSet", jsonbOrder({ destinationDomain: 1, mintRecipient: "0xa", minFeeCapRate: 0, maxFeeCapRate: 5 })),
      ev("CCTPDomainParametersSet", jsonbOrder({ destinationDomain: 2, mintRecipient: "0xb", minFeeCapRate: 0, maxFeeCapRate: 5 })),
    ]);
    expect(params.map((p) => [p.event, p.subject])).toEqual([
      ["MintRecipientSet", "3"],
      ["CentrifugeRecipientSet", "7"],
      ["CCTPDomainParametersSet", "1"],
      ["CCTPDomainParametersSet", "2"],
    ]);
    expect(params[0].args.mintRecipient).toBe("0xnew");
  });
});
