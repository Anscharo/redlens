// Tests for MCP utility functions
import { test, expect } from "bun:test";

async function setupIndexes() {
  const { loadIndexes, setIndexes } = await import("./indexes.ts");
  const ix = loadIndexes();
  if (ix.docMap.size === 0) {
    // Create minimal test data if artifacts not loaded
    const testId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
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

test("createMcpServer initializes with correct metadata", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const server = createMcpServer({
    host: "test.local",
    userAgent: "test-client",
    protocolVersion: "2024-11-05",
    sessionId: "test-session-123",
  });

  expect(server).toBeTruthy();
});

test("createMcpServer without context", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const server = createMcpServer();
  expect(server).toBeTruthy();
});

test("McpRequestContext with all fields", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const ctx = {
    host: "atlas.redline.support",
    userAgent: "Mozilla/5.0",
    protocolVersion: "2024-11-05",
    sessionId: "abc-def-123",
  };

  const server = createMcpServer(ctx);
  expect(server).toBeTruthy();
});

test("McpRequestContext with partial fields", async () => {
  await setupIndexes();
  const { createMcpServer } = await import("./mcp.ts");

  const ctx = {
    host: "localhost:3000",
    userAgent: null,
    protocolVersion: null,
    sessionId: "test",
  };

  const server = createMcpServer(ctx);
  expect(server).toBeTruthy();
});
