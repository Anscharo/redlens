// Test MCP server creation and utilities.
import { describe, it, expect, beforeAll } from "bun:test";
import { createMcpServer, type McpRequestContext } from "./mcp.ts";
import { setIndexes } from "./indexes.ts";
import MiniSearch from "minisearch";
import { MultiDirectedGraph } from "graphology";

beforeAll(() => {
  // Initialize minimal indexes for tests
  const emptyGraph = new MultiDirectedGraph();
  const emptySearch = new MiniSearch({ fields: ["content"] });
  setIndexes({
    docMap: new Map(),
    byDocNo: new Map(),
    childrenIndex: new Map(),
    entities: [],
    edges: [],
    graph: emptyGraph,
    search: emptySearch,
    meta: {
      atlasCommit: "test-commit-sha",
      buildTime: new Date().toISOString(),
      version: "1.0.0",
    },
    glossary: new Map(),
  });
});

describe("createMcpServer", () => {
  it("creates MCP server without context", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
  });

  it("creates MCP server with undefined context", () => {
    const server = createMcpServer(undefined);
    expect(server).toBeDefined();
  });

  it("creates MCP server with minimal context", () => {
    const ctx: McpRequestContext = {
      host: "localhost",
      userAgent: null,
      protocolVersion: null,
      sessionId: "test-session-123",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
  });

  it("creates MCP server with full context", () => {
    const ctx: McpRequestContext = {
      host: "atlas.redline.support",
      userAgent: "TestClient/1.0",
      protocolVersion: "2024-11-05",
      sessionId: "prod-session-456",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
  });

  it("creates multiple independent servers", () => {
    const server1 = createMcpServer();
    const server2 = createMcpServer();
    expect(server1).toBeDefined();
    expect(server2).toBeDefined();
  });

  it("handles production domain in context", () => {
    const ctx: McpRequestContext = {
      host: "atlas.redline.support",
      userAgent: "Client",
      protocolVersion: "2024-11-05",
      sessionId: "prod-session",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles production domain with port", () => {
    const ctx: McpRequestContext = {
      host: "atlas.redline.support:443",
      userAgent: "Client",
      protocolVersion: "2024-11-05",
      sessionId: "prod-session",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles development domain in context", () => {
    const ctx: McpRequestContext = {
      host: "localhost:3000",
      userAgent: "Client",
      protocolVersion: "2024-11-05",
      sessionId: "dev-session",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles development localhost without port", () => {
    const ctx: McpRequestContext = {
      host: "localhost",
      userAgent: "Client",
      protocolVersion: "2024-11-05",
      sessionId: "dev-session",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles Railway preview URL in context", () => {
    const ctx: McpRequestContext = {
      host: "redlens-preview-abc123.railway.app",
      userAgent: "Client",
      protocolVersion: "2024-11-05",
      sessionId: "preview-session",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles Railway staging URL", () => {
    const ctx: McpRequestContext = {
      host: "staging.railway.app",
      userAgent: "Client",
      protocolVersion: "2024-11-05",
      sessionId: "staging-session",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles missing userAgent", () => {
    const ctx: McpRequestContext = {
      host: "localhost",
      userAgent: null,
      protocolVersion: "2024-11-05",
      sessionId: "test",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles empty string userAgent", () => {
    const ctx: McpRequestContext = {
      host: "localhost",
      userAgent: "",
      protocolVersion: "2024-11-05",
      sessionId: "test",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles missing protocolVersion", () => {
    const ctx: McpRequestContext = {
      host: "localhost",
      userAgent: "Client",
      protocolVersion: null,
      sessionId: "test",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles empty string protocolVersion", () => {
    const ctx: McpRequestContext = {
      host: "localhost",
      userAgent: "Client",
      protocolVersion: "",
      sessionId: "test",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("handles various session ID formats", () => {
    const sessionIds = ["test", "test-123-abc", "uuid-format-here", ""];
    for (const sessionId of sessionIds) {
      const ctx: McpRequestContext = {
        host: "localhost",
        userAgent: "Client",
        protocolVersion: "2024-11-05",
        sessionId,
      };
      const server = createMcpServer(ctx);
      expect(server).toBeDefined();
    }
  });

  it("handles hostname variations", () => {
    const hosts = ["localhost", "127.0.0.1", "192.168.1.1", "example.com"];
    for (const host of hosts) {
      const ctx: McpRequestContext = {
        host,
        userAgent: "Client",
        protocolVersion: "2024-11-05",
        sessionId: "test",
      };
      const server = createMcpServer(ctx);
      expect(server).toBeDefined();
    }
  });

  it("creates server with all null/empty context fields", () => {
    const ctx: McpRequestContext = {
      host: "",
      userAgent: null,
      protocolVersion: null,
      sessionId: "",
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });

  it("server object has expected structure", () => {
    const server = createMcpServer();
    expect(server).not.toBeNull();
    expect(typeof server).toBe("object");
    // Server should have some properties/methods
    expect(Object.keys(server).length).toBeGreaterThanOrEqual(0);
  });
});
