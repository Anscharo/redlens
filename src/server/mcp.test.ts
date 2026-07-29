import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import MiniSearch from "minisearch";
import { MultiDirectedGraph } from "graphology";
import { loadIndexes, setIndexes, type Indexes } from "./retrieval/indexes.ts";

let previousIndexes: Indexes;

const registeredTools: {
  name: string;
  config: Record<string, unknown>;
  cb: (args: Record<string, unknown>) => Promise<unknown>;
}[] = [];

class FakeMcpServer {
  server = { getClientVersion: () => ({ name: "fake-client", version: "1.0.0" }) };

  registerTool(
    name: string,
    config: Record<string, unknown>,
    cb: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    registeredTools.push({ name, config, cb });
  }
}

mock.module("@modelcontextprotocol/sdk/server/mcp.js", () => ({ McpServer: FakeMcpServer }));
mock.module("@posthog/mcp", () => ({ instrument: mock(() => undefined) }));
// A COMPLETE stand-in for posthog-node: bun's mock.module replaces the module in
// the shared registry for the rest of the process, so any test file loaded after
// this one (the chat/verify + chat/tools suites, after the move reordered bun's
// file discovery) resolves its posthog-node imports through this stub. A partial
// stub ({ getPosthog }) made those files fail to load with "Export named
// 'captureError' not found". Mirror every runtime export; all are no-ops, which
// matches the real module's behaviour under test (no POSTHOG key → getPosthog()
// is null and captureError/captureEvent early-return anyway).
mock.module("./posthog-node.ts", () => ({
  getPosthog: () => null,
  captureError: () => {},
  captureEvent: () => {},
  shutdownPosthog: async () => {},
}));

const { createMcpServer } = await import("./mcp.ts");
const { ATLAS_TOOLS } = await import("./chat/tools/tool-registry.ts");

function emptyIndexes(): Indexes {
  return {
    docMap: new Map(),
    byDocNo: new Map(),
    childrenIndex: new Map(),
    mini: new MiniSearch({ fields: ["title", "content"], storeFields: ["id"] }),
    graph: new MultiDirectedGraph(),
    entities: [],
    edges: [],
    entityBySlug: new Map(),
    entityById: new Map(),
    glossary: new Map(),
    meta: { atlasCommit: "atlas-sha" },
  };
}

beforeEach(() => {
  // Capture the REAL indexes (loading them from disk if nothing has yet) so we can
  // always restore them. Using getIndexes() here threw when this file ran before
  // anything else had loaded indexes, leaving previousIndexes null — then the
  // afterEach below skipped its restore and left the shared module-level state
  // poisoned empty for every later test file that reads loadIndexes() at import
  // (the chat/verify + eval-verifier suites). bun test shares module state across
  // files, so that leak is order-dependent; loading + unconditionally restoring
  // makes this suite self-contained regardless of file discovery order.
  previousIndexes = loadIndexes();
  registeredTools.length = 0;
  setIndexes(emptyIndexes());
});

afterEach(() => {
  setIndexes(previousIndexes);
});

describe("createMcpServer", () => {
  it("registers the atlas tool registry with descriptions and schemas", () => {
    createMcpServer();

    expect(registeredTools.length).toBeGreaterThan(20);
    const describeTool = registeredTools.find((tool) => tool.name === "atlas_describe");
    expect(describeTool?.config).toMatchObject({
      annotations: { readOnlyHint: true },
    });
    expect(describeTool?.config.description).toBeString();
    expect(describeTool?.config.inputSchema).toBeObject();
  });

  it("wraps successful tool responses with atlas metadata", async () => {
    createMcpServer({
      host: "localhost",
      userAgent: "agent",
      protocolVersion: "2025-06-18",
      sessionId: "sess-1",
    });

    const describeTool = registeredTools.find((tool) => tool.name === "atlas_describe")!;
    const res = (await describeTool.cb({})) as { content: { text: string }[] };
    const body = JSON.parse(res.content[0].text);

    expect(body._meta).toEqual({ atlasCommit: "atlas-sha" });
    expect(body.doc_count).toBe(0);
    expect(body.entity_count).toBe(0);
    expect(body.edge_types).toEqual([]);
  });

  it("re-throws when a tool handler fails (after recording the error for analytics)", async () => {
    // mcp.ts registers one callback per ATLAS_TOOLS entry; a handler that throws
    // must propagate (the SDK turns it into an MCP error response) rather than be
    // swallowed. Append a throwing tool to the real registry array, then restore it
    // — local + reversible, avoiding a process-global module mock of tool-registry.
    ATLAS_TOOLS.push({
      name: "atlas_boom",
      description: "throws",
      shape: {},
      annotations: { readOnlyHint: true },
      handler: () => {
        throw new Error("handler exploded");
      },
    });
    try {
      createMcpServer({ host: "localhost", userAgent: null, protocolVersion: null, sessionId: "sess-err" });
      const boom = registeredTools.find((tool) => tool.name === "atlas_boom")!;
      expect(boom).toBeDefined();
      await expect(boom.cb({})).rejects.toThrow("handler exploded");
    } finally {
      ATLAS_TOOLS.pop();
    }
  });
});
