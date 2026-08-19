import type { APIRequestContext } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { callTool, parseMcpEnvelope } from "./mcp";

function response(status: number, body: string) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    statusText: () => (status === 503 ? "Service Unavailable" : "OK"),
    text: async () => body,
  };
}

function requestWith(...responses: ReturnType<typeof response>[]): APIRequestContext {
  let index = 0;
  return {
    post: async () => responses[Math.min(index++, responses.length - 1)],
  } as unknown as APIRequestContext;
}

function result(payload: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
}

describe("parseMcpEnvelope", () => {
  it("parses streamable HTTP SSE responses", () => {
    const parsed = parseMcpEnvelope(`event: message\ndata: ${result({ records: [1] })}\n\n`);
    expect(parsed.result?.content?.[0].text).toBe('{"records":[1]}');
  });
});

describe("callTool", () => {
  it("returns a decoded tool payload", async () => {
    await expect(callTool(requestWith(response(200, result({ results: [{ id: "doc" }] }))), "atlas_query", {}))
      .resolves.toEqual({ results: [{ id: "doc" }] });
  });

  it("retries transient HTTP failures only", async () => {
    const pauses: number[] = [];
    const payload = await callTool(
      requestWith(response(503, "cold"), response(200, result({ ok: true }))),
      "atlas_query",
      {},
      { sleep: async (ms) => pauses.push(ms) },
    );
    expect(payload).toEqual({ ok: true });
    expect(pauses).toEqual([250]);
  });

  it("names domain errors without retrying them", async () => {
    await expect(
      callTool(requestWith(response(200, result({ error: "Address not found" }))), "atlas_get_address", {}),
    ).rejects.toThrow("MCP tool atlas_get_address failed: Address not found");
  });
});
