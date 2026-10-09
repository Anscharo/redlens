// The admin-event catalogue and decoder. The two real logs are Grove's Ethereum
// diamond PAU as Blockscout served them; the synthetic ones cover what no
// cheap fixture shows: a tuple argument, and two events that share a topic0
// but index different arguments.
import { describe, expect, it } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, toEventSelector } from "viem";
import { adminTopics, decodeAdminLog, jsonSafe } from "./admin-events.ts";

const RATE_LIMIT_DATA_SET = {
  topics: ["0x356822943b80f809508a684c67d901d5c13b6a22161bf07d510e50a6cb727028", "0x71efb11b03476e40dcc1ade629d360114fcbf838d70a3211270f69414ba9a187"],
  data: "0x000000000000000000000000000000000000000000000000000016bcc41e900000000000000000000000000000000000000000000000000000000000113f28ab000000000000000000000000000000000000000000000000000016bcc41e9000000000000000000000000000000000000000000000000000000000006ac4d36b",
};
const ACTOR_ADDED = {
  topics: ["0xd8b8d40582460da214d7dd2b2e4866eadcbc2cbe60bebc81e83957b9a0b44dcd", "0x0000000000000000000000009187807e07112359c481870feb58f0c117a29179", "0x000000000000000000000000c812aad3fae2d3511c664374b601a9bebfecca2e"],
  data: "0x",
};

describe("adminTopics", () => {
  it("lists one entry per topic0 and nothing for roles without admin events", () => {
    const controller = adminTopics("diamond", "controller");
    expect(controller.filter((t) => t.name === "CentrifugeRecipientSet")).toHaveLength(1);
    expect(new Set(controller.map((t) => t.topic0)).size).toBe(controller.length);
    expect(adminTopics("monolithic", "relayer")).toEqual([]);
    expect(adminTopics("monolithic", "accessControls")).toEqual([]);
  });
  it("polls BeamState for its registrations, defaults and step limits only", () => {
    expect(adminTopics("diamond", "beamState").map((t) => t.name)).toEqual(["AddRateLimits", "DelRateLimits", "AddInitRateLimits", "DelInitRateLimits", "SetHop", "SetMaxChange"]);
  });
  it("polls the governance carriers for their origin evidence under either generation", () => {
    expect(adminTopics("diamond", "configurator").map((t) => t.name)).toEqual(["SetRateLimit", "CallControllerAction"]);
    expect(adminTopics("monolithic", "starGuard").map((t) => t.name)).toEqual(["Plot", "Exec", "Drop"]);
    expect(adminTopics("diamond", "executor").map((t) => t.name)).toEqual(["ActionsSetQueued", "ActionsSetExecuted", "ActionsSetCanceled"]);
  });
  it("keeps operational events out of the rate-limits list", () => {
    const names = adminTopics("monolithic", "rateLimits").map((t) => t.name);
    expect(names).toEqual(["RoleGranted", "RoleRevoked", "RateLimitDataSet"]);
  });
});

describe("decodeAdminLog", () => {
  it("decodes a real StarGuard Plot: Spark's star spell of the 2025-11-13 executive", () => {
    const plot = {
      topics: ["0x0f870ae93c797c0a219447673e1027ae91aaa67bc1ad8f3951235edfc925f5be", "0x00000000000000000000000063fa202a7020e8ee0837196783f0fb768cbfe2f1"],
      data: "0x6e88f81cc72989a637f4b87592dcde2016272fbceb08a2af3b2effdb2d20c0fb00000000000000000000000000000000000000000000000000000000692464f7",
    };
    expect(decodeAdminLog(plot.topics, plot.data)).toEqual({
      event: "Plot",
      args: { addr: "0x63fa202a7020e8ee0837196783f0fb768cbfe2f1", tag: "0x6e88f81cc72989a637f4b87592dcde2016272fbceb08a2af3b2effdb2d20c0fb", deadline: "1763992823" },
    });
  });
  it("decodes a real RateLimitDataSet with amounts as decimal strings", () => {
    expect(decodeAdminLog(RATE_LIMIT_DATA_SET.topics, RATE_LIMIT_DATA_SET.data)).toEqual({
      event: "RateLimitDataSet",
      args: {
        key: "0x71efb11b03476e40dcc1ade629d360114fcbf838d70a3211270f69414ba9a187",
        maxAmount: "25000000000000",
        slope: "289351851",
        lastAmount: "25000000000000",
        lastUpdated: "1791284075",
      },
    });
  });
  it("decodes a real ActorAdded with lowercase addresses", () => {
    expect(decodeAdminLog(ACTOR_ADDED.topics, ACTOR_ADDED.data)).toEqual({
      event: "ActorAdded",
      args: { account: "0x9187807e07112359c481870feb58f0c117a29179", caller: "0xc812aad3fae2d3511c664374b601a9bebfecca2e" },
    });
  });
  it("decodes a tuple argument", () => {
    const abi = parseAbi(["struct Wire { bytes4 callSelector; bytes4 delegateSelector; }", "struct Config { address facet; Wire[] wires; }", "event IntegrationSet(bytes32 indexed id, Config config)"]);
    const id = `0x${"ab".repeat(32)}` as const;
    const facet = "0x445d9dc752f269be48250f1a180cac4000000000";
    const topics = encodeEventTopics({ abi, eventName: "IntegrationSet", args: { id } });
    const data = encodeAbiParameters(abi[0].inputs.slice(1), [{ facet, wires: [{ callSelector: "0x12345678", delegateSelector: "0x9abcdef0" }] }]);
    expect(decodeAdminLog(topics as string[], data)?.args).toEqual({
      id,
      config: { facet, wires: [{ callSelector: "0x12345678", delegateSelector: "0x9abcdef0" }] },
    });
  });
  it("tries every event sharing a topic0 until the indexing fits", () => {
    const topic0 = toEventSelector("CentrifugeRecipientSet(uint16,bytes32)");
    const recipient = `0x${"11".repeat(32)}`;
    const id = `0x${"0".repeat(63)}7`;
    const monolith = decodeAdminLog([topic0, id], recipient);
    const diamond = decodeAdminLog([topic0, id, recipient], "0x");
    expect(monolith?.args).toEqual({ centrifugeId: 7, recipient });
    expect(diamond?.args).toEqual({ centrifugeId: 7, recipient });
  });
  it("returns null for a log no catalogued event matches", () => {
    expect(decodeAdminLog([`0x${"00".repeat(32)}`], "0x")).toBeNull();
  });
});

describe("jsonSafe", () => {
  it("stringifies bigints at any depth and leaves other values alone", () => {
    expect(jsonSafe({ a: [1n, { b: 2n }], c: "x", d: true, e: null })).toEqual({ a: ["1", { b: "2" }], c: "x", d: true, e: null });
  });
});
