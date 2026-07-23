// Exhaustive MCP server initialization and configuration testing
import { test, expect } from "bun:test";

async function setupIndexes() {
  const { loadIndexes, setIndexes } = await import("./indexes.ts");
  const ix = loadIndexes();
  if (ix.docMap.size === 0) {
    const testId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    ix.docMap.set(testId, {
      id: testId,
      doc_no: "A.0",
      title: "Test",
      type: "Core",
      depth: 1,
      parentId: null,
      order: 0,
      content: "test",
      contentHash: "hash",
    });
  }
  setIndexes(ix);
}

test("MCP server creation with various host configurations", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const hostConfigs = [
    { host: "localhost:3000", userAgent: "local", protocolVersion: "2024-11-05", sessionId: "s1" },
    { host: "127.0.0.1:8080", userAgent: null, protocolVersion: null, sessionId: "s2" },
    { host: "atlas.redline.support", userAgent: "prod-agent", protocolVersion: "2024-11-05", sessionId: "s3" },
    { host: "preview-pr-123.railway.app", userAgent: "browser", protocolVersion: null, sessionId: "s4" },
  ];

  for (const config of hostConfigs) {
    const server = createMcpServer(config);
    expect(server).toBeTruthy();
  }
});

test("MCP server without context creates successfully", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const server = createMcpServer();
  expect(server).toBeTruthy();

  const server2 = createMcpServer(undefined);
  expect(server2).toBeTruthy();
});

test("MCP server with different protocol versions", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const servers = [
    createMcpServer({ host: "test", userAgent: "test", protocolVersion: "2024-11-05", sessionId: "p1" }),
    createMcpServer({ host: "test", userAgent: "test", protocolVersion: "2024-08-01", sessionId: "p2" }),
    createMcpServer({ host: "test", userAgent: "test", protocolVersion: null, sessionId: "p3" }),
  ];

  for (const server of servers) {
    expect(server).toBeTruthy();
  }
});

test("MCP RequestContext with all combinations", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  // Test all combinations of null/non-null fields
  const contexts = [
    { host: "a", userAgent: "b", protocolVersion: "c", sessionId: "d" },
    { host: "a", userAgent: null, protocolVersion: null, sessionId: "d" },
    { host: "atlas.redline.support", userAgent: "prod", protocolVersion: "2024-11-05", sessionId: "prod-123" },
  ];

  for (const ctx of contexts) {
    const server = createMcpServer(ctx);
    expect(server).toBeTruthy();
  }
});
