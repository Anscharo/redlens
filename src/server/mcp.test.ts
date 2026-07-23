// createMcpServer: tool registration + the per-call wrapper (ok()/error/
// analytics). Run under `bun test`. Uses the REAL indexes.ts + tool-registry.ts
// (mocking either would leak into mcp-tools.test.ts / preview/handler.test.ts —
// bun's mock.module overwrites an already-loaded module's exports in place and
// mock.restore() does not reliably undo that across files). Only the MCP SDK's
// McpServer (so we can observe registered callbacks without a real transport)
// and posthog-capture.ts (the only consumer of which is mcp.ts itself, so
// mocking it is leak-safe) are stubbed.
import { test, expect, mock, beforeEach, afterAll } from "bun:test";
import { config } from "./config.ts";
import { loadIndexes, setIndexes, getIndexes } from "./indexes.ts";
import { ATLAS_TOOLS } from "./tool-registry.ts";

type Registered = { cfg: Record<string, unknown>; cb: (args: Record<string, unknown>) => Promise<unknown> };

// Real indexes (loadIndexes()/setIndexes() are a shared process-wide singleton —
// see preview/handler.test.ts). Reuse whatever's already loaded rather than
// building fake data, so this file can run in any order without corrupting the
// singleton for other test files that expect the real on-disk atlas.
setIndexes(loadIndexes());
const DOC_ID = [...getIndexes().docMap.keys()][0];

let registered: Map<string, Registered>;
let clientVersion: { name: string; version: string } | undefined;
let captured: { event: string; distinctId: string; properties: Record<string, unknown> }[];

beforeEach(() => {
  mock.restore();
  registered = new Map();
  clientVersion = { name: "test-client", version: "9.9" };
  captured = [];

  mock.module("@modelcontextprotocol/sdk/server/mcp.js", () => ({
    McpServer: class {
      server = { getClientVersion: () => clientVersion };
      registerTool(name: string, cfg: Record<string, unknown>, cb: Registered["cb"]) {
        registered.set(name, { cfg, cb });
      }
    },
  }));

  mock.module("./posthog-capture.ts", () => ({
    captureServerEvent: (event: string, distinctId: string, properties: Record<string, unknown>) => {
      captured.push({ event, distinctId, properties });
    },
  }));

  config.appCommit = "";
});

// mock.module mutates an already-loaded module's exports in place; restore
// after this file's tests so the McpServer/posthog-capture stubs don't leak
// into whichever test file bun runs next.
afterAll(() => {
  mock.restore();
});

test("registers every tool from ATLAS_TOOLS with its description/shape/annotations", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer();
  expect(registered.size).toBe(ATLAS_TOOLS.length);
  const t = registered.get("atlas_get")!;
  const real = ATLAS_TOOLS.find((x) => x.name === "atlas_get")!;
  expect(t.cfg.description).toContain(real.description);
  expect(t.cfg.inputSchema).toBe(real.shape);
  expect(t.cfg.annotations).toEqual(real.annotations);
});

test("a successful call wraps the handler's result with _meta and returns MCP content text", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer({ host: "localhost", userAgent: "ua-1", protocolVersion: "2025-01", sessionId: "sess-1" });
  const res = (await registered.get("atlas_get")!.cb({ id: DOC_ID })) as { content: { type: string; text: string }[] };
  const parsed = JSON.parse(res.content[0].text);
  expect(parsed._meta).toEqual(getIndexes().meta);
  expect(parsed.id).toBe(DOC_ID);
});

test("success: captures mcp_tool_call with ok:true, the client version, host/session context", async () => {
  config.appCommit = "abc1234";
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer({ host: "localhost", userAgent: "ua-1", protocolVersion: "2025-01", sessionId: "sess-1" });
  await registered.get("atlas_get")!.cb({ id: DOC_ID });

  expect(captured).toHaveLength(1);
  const c = captured[0];
  expect(c.event).toBe("mcp_tool_call");
  expect(c.distinctId).toBe("sess-1");
  expect(c.properties).toMatchObject({
    product: "mcp",
    tool: "atlas_get",
    ok: true,
    error: undefined,
    client_name: "test-client",
    client_version: "9.9",
    protocol_version: "2025-01",
    user_agent: "ua-1",
    host: "localhost",
    environment: "dev",
    app_commit: "abc1234",
    atlas_commit: getIndexes().meta.atlasCommit ?? null,
    mcp_session: "sess-1",
  });
  expect(typeof c.properties.duration_ms).toBe("number");
  expect(typeof c.properties.result_bytes).toBe("number");
});

test("environment is 'prod' only for the canonical production host", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer({ host: "atlas.redline.support", userAgent: null, protocolVersion: null, sessionId: "sess-2" });
  await registered.get("atlas_get")!.cb({ id: DOC_ID });
  expect(captured[0].properties.environment).toBe("prod");
});

test("a throwing handler (DB-backed tool with no DB available) rethrows, and analytics records ok:false + the error", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer({ host: "localhost", userAgent: null, protocolVersion: null, sessionId: "sess-3" });
  // atlas_first_seen resolves DOC_ID in-memory, then hits Postgres for the
  // history lookup — unreachable here, so it rejects (fast: "Connection closed").
  await expect(registered.get("atlas_first_seen")!.cb({ ids: [DOC_ID] })).rejects.toThrow();

  expect(captured).toHaveLength(1);
  expect(captured[0].properties.ok).toBe(false);
  expect(typeof captured[0].properties.error).toBe("string");
  expect(captured[0].properties.result_bytes).toBeUndefined();
});

test("without a reqCtx, mcp_session is null in properties but distinctId still gets a fresh id", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer();
  await registered.get("atlas_get")!.cb({ id: DOC_ID });
  expect(captured[0].properties.mcp_session).toBeNull();
  expect(captured[0].properties.host).toBeUndefined();
  expect(captured[0].properties.environment).toBe("dev");
  expect(typeof captured[0].distinctId).toBe("string");
  expect(captured[0].distinctId.length).toBeGreaterThan(0);
});

test("large params are truncated to a preview instead of forwarded whole", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer({ host: "localhost", userAgent: null, protocolVersion: null, sessionId: "sess-4" });
  const bigArgs = { id: [DOC_ID], junk: "x".repeat(3000) };
  await registered.get("atlas_get")!.cb(bigArgs);
  const params = captured[0].properties.params as Record<string, unknown>;
  expect(params._truncated).toBe(true);
  expect(typeof params.preview).toBe("string");
  expect((params.preview as string).length).toBe(2000);
});

test("small params are forwarded verbatim (no truncation)", async () => {
  const { createMcpServer } = await import("./mcp.ts");
  createMcpServer({ host: "localhost", userAgent: null, protocolVersion: null, sessionId: "sess-5" });
  await registered.get("atlas_get")!.cb({ id: DOC_ID });
  expect(captured[0].properties.params).toEqual({ id: DOC_ID });
});
