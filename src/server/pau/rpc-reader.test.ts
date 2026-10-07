// The live reader's failure contract: a chain with no RPC, an RPC that errors,
// and a head lookup that fails all come back as null values, never a throw,
// so one dead endpoint marks its own values unread instead of failing a tick.
import { afterEach, describe, expect, it } from "bun:test";
import { rpcChainReader, rpcHead } from "./rpc-reader.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(body: (req: { method: string; id: number }) => unknown) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    const reply = Array.isArray(req) ? req.map((r) => ({ jsonrpc: "2.0", id: r.id, result: body(r) })) : { jsonrpc: "2.0", id: req.id, result: body(req) };
    return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const call = { address: "0x" + "1".repeat(40), functionName: "getCurrentRateLimit" as const, args: [`0x${"0".repeat(64)}`] };

describe("rpcChainReader", () => {
  it("answers null for every call on a chain with no RPC", async () => {
    expect(await rpcChainReader()("not-a-chain", [call, call])).toEqual([null, null]);
  });
  it("answers null for every call when the RPC fails", async () => {
    globalThis.fetch = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    expect(await rpcChainReader()("ethereum", [call])).toEqual([null]);
  });
});

describe("rpcHead", () => {
  it("reads the head block", async () => {
    answer(() => "0x2a");
    expect(await rpcHead("ethereum")).toBe(42);
  });
  it("is null for a chain with no RPC or an RPC that fails", async () => {
    expect(await rpcHead("not-a-chain")).toBeNull();
    globalThis.fetch = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    expect(await rpcHead("ethereum")).toBeNull();
  });
});
