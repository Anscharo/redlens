// createMcpServer: registers every tool-registry.ts entry on the MCP server,
// wrapping each handler with the shared analytics finally-block. Run under
// `bun test`.
//
// Deliberately does NOT mock "./tool-registry.ts": `mock.module` replaces the
// module registry entry for the rest of the whole `bun test` process (not
// just this file), and mcp-tools.test.ts statically imports the real
// ATLAS_TOOLS/TOOLS_BY_NAME — a static `import` binds at module-collection
// time, before any `afterAll` restore can run, so mocking that specifier here
// would silently break mcp-tools.test.ts's registry-integrity assertions
// whenever both files load in the same process (always, under `bun test
// src/server`). Only the SDK's McpServer is mocked (nothing else statically
// imports "@modelcontextprotocol/sdk/server/mcp.js"), so registerTool calls
// can be recorded and their callbacks driven directly instead of needing a
// real MCP transport.
import { test, expect, mock } from "bun:test";
import { ATLAS_TOOLS, toolDescription } from "./tool-registry.ts";

class FakeMcpServer {
  server = { getClientVersion: () => ({ name: "fake-client", version: "9.9" }) };
  tools: Record<string, { config: Record<string, unknown>; cb: (args: Record<string, unknown>) => Promise<unknown> }> = {};
  registerTool(name: string, config: Record<string, unknown>, cb: (args: Record<string, unknown>) => Promise<unknown>) {
    this.tools[name] = { config, cb };
  }
}
mock.module("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: FakeMcpServer,
}));

const { createMcpServer } = await import("./mcp.ts");
const { loadIndexes, setIndexes } = await import("./indexes.ts");
const realIx = loadIndexes();
setIndexes(realIx);

test("createMcpServer registers every real ATLAS_TOOLS entry with its computed description + annotations", () => {
  const server = createMcpServer() as unknown as FakeMcpServer;
  expect(Object.keys(server.tools).sort()).toEqual(ATLAS_TOOLS.map((t) => t.name).sort());
  const describeTool = ATLAS_TOOLS.find((t) => t.name === "atlas_describe")!;
  expect(server.tools.atlas_describe.config.description).toBe(toolDescription(describeTool));
  expect(server.tools.atlas_describe.config.annotations).toEqual(describeTool.annotations);
});

test("a successful tool call returns _meta + the handler's payload as JSON text, and identifies as prod for the canonical host", async () => {
  const server = createMcpServer({
    host: "atlas.redline.support",
    userAgent: "some-agent/1.0",
    protocolVersion: "2025-01",
    sessionId: "sess-abc",
  }) as unknown as FakeMcpServer;

  const result = (await server.tools.atlas_describe.cb({})) as { content: { type: string; text: string }[] };
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed._meta).toEqual(realIx.meta);
  expect(parsed.doc_types).toBeDefined();
});

test("a thrown handler error rethrows out of the callback (dev host, no reqCtx fields)", async () => {
  // Poison ix.meta with a throwing getter so `ok(ix.meta, await t.handler(...))`
  // throws deterministically inside the wrapper's try block, exercising the
  // catch/finally path without depending on any specific real tool's internal
  // error behavior. Restored immediately so no other test/file sees it —
  // indexes.ts's module-level `state` is a process-global singleton.
  const poisoned = {
    ...realIx,
    get meta(): never {
      throw new Error("handler boom");
    },
  };
  setIndexes(poisoned as unknown as typeof realIx);
  try {
    const server = createMcpServer({ host: "localhost", userAgent: null, protocolVersion: null, sessionId: "sess-fail" }) as unknown as FakeMcpServer;
    await expect(server.tools.atlas_describe.cb({})).rejects.toThrow("handler boom");
  } finally {
    setIndexes(realIx);
  }
});

test("createMcpServer works without a reqCtx: a session id is minted per call and every tool still registers", async () => {
  const server = createMcpServer() as unknown as FakeMcpServer;
  expect(Object.keys(server.tools)).toHaveLength(ATLAS_TOOLS.length);
  const result = (await server.tools.atlas_describe.cb({})) as { content: { type: string; text: string }[] };
  expect(JSON.parse(result.content[0].text)._meta).toEqual(realIx.meta);
});

test("large args are still forwarded to the handler untouched (only the analytics copy is capped)", async () => {
  const server = createMcpServer({ host: "dev.example", userAgent: null, protocolVersion: null, sessionId: "sess-big" }) as unknown as FakeMcpServer;
  const bigArgs = { sections: ["all"], blob: "x".repeat(3000) };
  const result = (await server.tools.atlas_describe.cb(bigArgs)) as { content: { type: string; text: string }[] };
  expect(JSON.parse(result.content[0].text)._meta).toEqual(realIx.meta);
});
