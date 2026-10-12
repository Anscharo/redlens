// The origin reader's JSON-RPC call names what went wrong: an HTTP failure by
// its status, before any attempt to read the body as JSON, and a JSON-RPC error
// by its code and message.
import { afterEach, describe, expect, it } from "bun:test";
import { resetBackoff } from "../../lib/upstreamBackoff.ts";
import { jsonRpc } from "./origin-io.ts";

const realFetch = globalThis.fetch;
const answer = (res: Response) => {
  globalThis.fetch = (async () => res) as unknown as typeof fetch;
};
afterEach(() => {
  globalThis.fetch = realFetch;
  resetBackoff();
});

describe("jsonRpc", () => {
  it("says an HTTP failure's status instead of failing to parse its HTML", async () => {
    answer(new Response("<html>503 Service Unavailable</html>", { status: 503 }));
    await expect(jsonRpc("ethereum", "eth_getTransactionByHash", ["0x1"])).rejects.toThrow("ethereum eth_getTransactionByHash: HTTP 503");
  });
  it("says a JSON-RPC error's code and message, and answers the result otherwise", async () => {
    answer(Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "header not found" } }));
    await expect(jsonRpc("ethereum", "eth_getBlockByNumber", ["0x1", true])).rejects.toThrow("ethereum eth_getBlockByNumber: code -32000 header not found");
    answer(Response.json({ jsonrpc: "2.0", id: 1, result: { hash: "0x1" } }));
    expect(await jsonRpc("ethereum", "eth_getTransactionByHash", ["0x1"])).toEqual({ hash: "0x1" });
  });
});
