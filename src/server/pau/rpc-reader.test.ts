// The live reader's failure contract: a chain with no RPC, an RPC that errors,
// and a head lookup that fails all come back as null values, never a throw,
// so one dead endpoint marks its own values unread instead of failing a tick.
//
// viem is mocked here rather than reached through a stubbed fetch: Bun keeps a
// mock.module for the whole run, so another file's viem mock would otherwise
// answer these calls depending on file order.
import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as realViem from "viem";

let multicallImpl: (contracts: unknown[]) => Promise<unknown[]>;
let headImpl: () => Promise<bigint>;

mock.module("viem", () => ({
  ...realViem,
  createPublicClient: () => ({
    multicall: ({ contracts }: { contracts: unknown[] }) => multicallImpl(contracts),
    getBlockNumber: () => headImpl(),
  }),
}));

const { rpcChainReader, rpcHead } = await import("./rpc-reader.ts");

const down = async (): Promise<never> => {
  throw new Error("HTTP request failed. Status: 500");
};

beforeEach(() => {
  multicallImpl = down;
  headImpl = down;
});

const call = { address: "0x" + "1".repeat(40), functionName: "getCurrentRateLimit" as const, args: [`0x${"0".repeat(64)}`] };

describe("rpcChainReader", () => {
  it("answers null for every call on a chain with no RPC", async () => {
    expect(await rpcChainReader()("not-a-chain", [call, call])).toEqual([null, null]);
  });
  it("answers null for every call when the RPC fails", async () => {
    expect(await rpcChainReader()("ethereum", [call])).toEqual([null]);
  });
  it("answers null only for the calls that fail", async () => {
    multicallImpl = async () => [{ status: "success", result: 7n }, { status: "failure", error: new Error("revert") }];
    expect(await rpcChainReader()("ethereum", [call, call])).toEqual([7n, null]);
  });
});

describe("rpcHead", () => {
  it("reads the head block", async () => {
    headImpl = async () => 42n;
    expect(await rpcHead("ethereum")).toBe(42);
  });
  it("is null for a chain with no RPC or an RPC that fails", async () => {
    expect(await rpcHead("not-a-chain")).toBeNull();
    expect(await rpcHead("ethereum")).toBeNull();
  });
});
