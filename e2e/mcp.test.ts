import { describe, it, expect } from "vitest";
import type { APIRequestContext } from "@playwright/test";
import { callTool } from "./mcp";

// A dropped Postgres connection reaches the client as a 200 whose tool payload is
// the plain text "Connection closed". Parsing that as JSON produced
// `SyntaxError: Unexpected token 'C'`, naming neither the tool nor the cause —
// which is how seven E2E failures shared one invisible root cause.

interface Reply {
  status?: number;
  text: string;
}

function stubContext(replies: Reply[]): { ctx: APIRequestContext; calls: () => number } {
  let i = 0;
  const ctx = {
    post: async () => {
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return { status: () => r.status ?? 200, text: async () => r.text };
    },
  };
  return { ctx: ctx as unknown as APIRequestContext, calls: () => i };
}

const ok = (payload: unknown): Reply => ({
  text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }),
});
const toolText = (text: string): Reply => ({
  text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }),
});

describe("callTool", () => {
  it("returns the parsed tool payload", async () => {
    const { ctx, calls } = stubContext([ok({ results: [1, 2] })]);
    expect(await callTool(ctx, "atlas_search", { q: "x" })).toEqual({ results: [1, 2] });
    expect(calls()).toBe(1);
  });

  it("parses an SSE envelope, which the streamable-HTTP transport may return", async () => {
    const env = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"ok":true}' }] } };
    const { ctx } = stubContext([{ text: `event: message\ndata: ${JSON.stringify(env)}\n\n` }]);
    expect(await callTool(ctx, "atlas_describe", {})).toEqual({ ok: true });
  });

  it("retries a dropped connection and succeeds on the second attempt", async () => {
    const { ctx, calls } = stubContext([toolText("Connection closed"), ok({ events: [] })]);
    expect(await callTool(ctx, "atlas_recent_changes", { k: 5 })).toEqual({ events: [] });
    expect(calls()).toBe(2);
  });

  it("names the tool and the real cause when a connection failure persists", async () => {
    const { ctx, calls } = stubContext([toolText("Connection closed")]);
    await expect(callTool(ctx, "atlas_recent_changes", { k: 5 })).rejects.toThrow(
      /atlas_recent_changes.*Connection closed/s,
    );
    expect(calls()).toBe(3); // exhausts the retries rather than giving up at once
  });

  it("surfaces a JSON-RPC error verbatim and does not retry it", async () => {
    const err = { jsonrpc: "2.0", id: 1, error: { code: -32603, message: 'relation "atlas_history" does not exist' } };
    const { ctx, calls } = stubContext([{ text: JSON.stringify(err) }]);
    await expect(callTool(ctx, "atlas_history", { id: "x" })).rejects.toThrow(/atlas_history.*does not exist/s);
    expect(calls()).toBe(1); // a broken query won't fix itself on a second try
  });

  it("retries a 5xx but not a 4xx", async () => {
    const server = stubContext([{ status: 503, text: "upstream unavailable" }]);
    await expect(callTool(server.ctx, "atlas_get", {})).rejects.toThrow(/503/);
    expect(server.calls()).toBe(3);

    const client = stubContext([{ status: 400, text: "bad arguments" }]);
    await expect(callTool(client.ctx, "atlas_get", {})).rejects.toThrow(/400/);
    expect(client.calls()).toBe(1);
  });

  it("reports an unparseable response instead of throwing a bare SyntaxError", async () => {
    const { ctx } = stubContext([{ text: "<html>gateway error</html>" }]);
    await expect(callTool(ctx, "atlas_query", {})).rejects.toThrow(/unparseable \/mcp response/);
  });

  it("reports a result that carries no text content", async () => {
    const { ctx } = stubContext([{ text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }) }]);
    await expect(callTool(ctx, "atlas_entity", {})).rejects.toThrow(/no text content/);
  });
});
