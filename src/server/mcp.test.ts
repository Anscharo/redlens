// Test MCP server creation and utilities.
import { describe, it, expect } from "bun:test";
import { createMcpServer, type McpRequestContext } from "./mcp.ts";

describe("createMcpServer", () => {
  it("creates MCP server without context", () => {
    // Should create a server even without request context
    const server = createMcpServer();
    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
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
});
