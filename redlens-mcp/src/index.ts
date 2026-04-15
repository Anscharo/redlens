import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export interface Env {
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

function createMcpServer(db: D1Database): McpServer {
  const server = new McpServer({
    name: "redlens-atlas",
    version: "1.0.0",
  });

  // atlas_search — FTS5 full-text search
  server.tool(
    "atlas_search",
    "Semantic search over the Sky Atlas (9,825 nodes). Returns the top-k most relevant nodes ranked by FTS5 score.",
    {
      query: z.string().describe("Natural-language query."),
      k: z.number().int().min(1).max(50).default(10).describe("Number of results to return (1-50)."),
      type: z.string().optional().describe("Optional Atlas document type filter."),
    },
    async ({ query, k, type }) => {
      let sql = `
        SELECT n.id, n.doc_no, n.title, n.type, n.depth, n.parent_id,
               snippet(atlas_nodes_fts, 4, '<mark>', '</mark>', '…', 24) AS snippet,
               bm25(atlas_nodes_fts) AS score
        FROM atlas_nodes_fts
        JOIN atlas_nodes n ON atlas_nodes_fts.rowid = n.rowid
        WHERE atlas_nodes_fts MATCH ?
        ${type ? "AND n.type = ?" : ""}
        ORDER BY score
        LIMIT ?
      `;
      const params: unknown[] = [query, ...(type ? [type] : []), k];
      const { results } = await db.prepare(sql).bind(...params).all();
      return {
        content: [{ type: "text", text: JSON.stringify({ count: results.length, results }) }],
      };
    }
  );

  // atlas_get — fetch a single node by UUID or doc_no
  server.tool(
    "atlas_get",
    "Fetch a single Atlas node by UUID or document number (e.g. 'A.1.2.3'). Returns full content and parent context.",
    { id: z.string().describe("Node UUID or doc number (e.g. 'A.1.2.3').") },
    async ({ id }) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const col = isUuid ? "n.id" : "n.doc_no";
      const row = await db
        .prepare(`SELECT n.*, p.doc_no AS parent_doc_no, p.title AS parent_title
                  FROM atlas_nodes n LEFT JOIN atlas_nodes p ON n.parent_id = p.id
                  WHERE ${col} = ? LIMIT 1`)
        .bind(id)
        .first();
      if (!row) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] };
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );

  // atlas_neighbors — bounded context around a node
  server.tool(
    "atlas_neighbors",
    "Return the hierarchical context around a node: parent, N siblings above/below, and direct children.",
    {
      id: z.string().describe("Node UUID or doc number."),
      window: z.number().int().min(0).max(32).default(8).describe("Siblings and children to include."),
    },
    async ({ id, window }) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const col = isUuid ? "id" : "doc_no";
      const target = await db.prepare(`SELECT * FROM atlas_nodes WHERE ${col} = ? LIMIT 1`).bind(id).first();
      if (!target) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] };

      const [parent, siblings, children] = await Promise.all([
        target.parent_id
          ? db.prepare("SELECT id,doc_no,title,type,depth FROM atlas_nodes WHERE id = ?").bind(target.parent_id).first()
          : Promise.resolve(null),
        db.prepare(`SELECT id,doc_no,title,type,depth FROM atlas_nodes WHERE parent_id = ? AND id != ? ORDER BY "order" LIMIT ?`)
          .bind(target.parent_id ?? null, target.id, window * 2).all(),
        db.prepare(`SELECT id,doc_no,title,type,depth FROM atlas_nodes WHERE parent_id = ? ORDER BY "order" LIMIT ?`)
          .bind(target.id, window).all(),
      ]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ target, parent, siblings: siblings.results, children: children.results }),
        }],
      };
    }
  );

  // atlas_traverse — multi-hop graph traversal
  server.tool(
    "atlas_traverse",
    "Traverse the graph from a node, following typed edges up to N hops. Use to find all related nodes.",
    {
      id: z.string().describe("Starting node UUID or doc number."),
      edge_type: z.string().optional().describe("Edge type filter (e.g. 'cites', 'responsible_for')."),
      hops: z.number().int().min(1).max(4).default(2).describe("Maximum traversal depth."),
      direction: z.enum(["out", "in", "both"]).default("out"),
    },
    async ({ id, edge_type, hops, direction }) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const startNode = await db
        .prepare(`SELECT id FROM atlas_nodes WHERE ${isUuid ? "id" : "doc_no"} = ? LIMIT 1`)
        .bind(id).first<{ id: string }>();
      if (!startNode) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] };

      const typeFilter = edge_type ? "AND e.type = ?" : "";
      const directionClause =
        direction === "out" ? `e.from_id = r.id ${typeFilter}`
        : direction === "in" ? `e.to_id = r.id ${typeFilter}`
        : `(e.from_id = r.id OR e.to_id = r.id) ${typeFilter}`;

      const bindParams = edge_type ? [startNode.id, hops, edge_type] : [startNode.id, hops];

      const { results } = await db.prepare(`
        WITH RECURSIVE reachable(id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT CASE WHEN e.from_id = r.id THEN e.to_id ELSE e.from_id END, r.depth + 1
          FROM edges e JOIN reachable r ON ${directionClause}
          WHERE r.depth < ?
        )
        SELECT DISTINCT n.id, n.doc_no, n.title, n.type, r.depth,
               e.type AS edge_type, e.from_id, e.to_id
        FROM reachable r
        JOIN atlas_nodes n ON r.id = n.id
        LEFT JOIN edges e ON (e.from_id = ? OR e.to_id = ?)
        WHERE n.id != ?
        ORDER BY r.depth, n.doc_no
      `).bind(...bindParams, startNode.id, startNode.id, startNode.id).all();

      return { content: [{ type: "text", text: JSON.stringify({ count: results.length, results }) }] };
    }
  );

  // atlas_entity — aggregate all info about a named entity
  server.tool(
    "atlas_entity",
    "Get all Atlas sections related to a named entity (agent, role, or actor). Returns nodes, inbound references, and Active Data sections they control.",
    { name: z.string().describe("Entity name (e.g. 'spark', 'operational-facilitator', 'core-govops').") },
    async ({ name }) => {
      const { results: nodes } = await db.prepare(`
        SELECT DISTINCT n.id, n.doc_no, n.title, n.type, n.depth
        FROM edges e JOIN atlas_nodes n ON e.to_id = n.id
        WHERE e.from_id = ? OR n.doc_no LIKE ?
        ORDER BY n.doc_no
        LIMIT 100
      `).bind(name, agentDocPrefix(name) + "%").all();

      const { results: responsibilities } = await db.prepare(`
        SELECT n.id, n.doc_no, n.title, n.type
        FROM edges e JOIN atlas_nodes n ON e.to_id = n.id
        WHERE e.from_id = ? AND e.type = 'responsible_for'
        ORDER BY n.doc_no
      `).bind(name).all();

      const { results: activeData } = await db.prepare(`
        SELECT n.id, n.doc_no, n.title, e.type AS edge_type
        FROM edges e JOIN atlas_nodes n ON e.to_id = n.id
        WHERE e.from_id = ? AND n.type IN ('Active Data Controller', 'Active Data')
        ORDER BY n.doc_no
      `).bind(name).all();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ entity: name, nodes, responsibilities, activeData }),
        }],
      };
    }
  );

  return server;
}

// Map entity slug to Atlas doc_no prefix
function agentDocPrefix(name: string): string {
  const map: Record<string, string> = {
    spark: "A.6.1.1.1",
    grove: "A.6.1.1.2",
    keel: "A.6.1.1.3",
    skybase: "A.6.1.1.4",
    obex: "A.6.1.1.5",
    pattern: "A.6.1.1.6",
  };
  return map[name.toLowerCase()] ?? "";
}

// ---------------------------------------------------------------------------
// Hono app — MCP + REST
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// MCP endpoint (streamable HTTP transport)
app.all("/mcp", async (c) => {
  const server = createMcpServer(c.env.DB);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

// REST: search
app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const k = Math.min(parseInt(c.req.query("k") ?? "10"), 50);
  const type = c.req.query("type");
  if (!q) return c.json({ error: "q required" }, 400);

  let sql = `SELECT n.id,n.doc_no,n.title,n.type,n.depth,
             snippet(atlas_nodes_fts,4,'<mark>','</mark>','…',24) AS snippet,
             bm25(atlas_nodes_fts) AS score
             FROM atlas_nodes_fts JOIN atlas_nodes n ON atlas_nodes_fts.rowid=n.rowid
             WHERE atlas_nodes_fts MATCH ?
             ${type ? "AND n.type=?" : ""}
             ORDER BY score LIMIT ?`;
  const params: unknown[] = [q, ...(type ? [type] : []), k];
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: results.length, results });
});

// REST: get node
app.get("/api/node/:id", async (c) => {
  const id = c.req.param("id");
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const row = await c.env.DB.prepare(
    `SELECT n.*,p.doc_no AS parent_doc_no,p.title AS parent_title
     FROM atlas_nodes n LEFT JOIN atlas_nodes p ON n.parent_id=p.id
     WHERE ${isUuid ? "n.id" : "n.doc_no"}=? LIMIT 1`
  ).bind(id).first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// REST: entity view
app.get("/api/entity/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const prefix = agentDocPrefix(name);

  const [byEdge, byDocNo, responsibilities, activeData] = await Promise.all([
    c.env.DB.prepare(`SELECT DISTINCT n.id,n.doc_no,n.title,n.type,n.depth
                      FROM edges e JOIN atlas_nodes n ON e.to_id=n.id WHERE e.from_id=? LIMIT 100`)
      .bind(name).all(),
    prefix
      ? c.env.DB.prepare(`SELECT id,doc_no,title,type,depth FROM atlas_nodes WHERE doc_no LIKE ? ORDER BY doc_no LIMIT 200`)
          .bind(prefix + "%").all()
      : Promise.resolve({ results: [] }),
    c.env.DB.prepare(`SELECT n.id,n.doc_no,n.title,n.type FROM edges e
                      JOIN atlas_nodes n ON e.to_id=n.id WHERE e.from_id=? AND e.type='responsible_for'`)
      .bind(name).all(),
    c.env.DB.prepare(`SELECT n.id,n.doc_no,n.title,e.type AS edge_type FROM edges e
                      JOIN atlas_nodes n ON e.to_id=n.id
                      WHERE e.from_id=? AND n.type IN ('Active Data Controller','Active Data')`)
      .bind(name).all(),
  ]);

  return c.json({
    entity: name,
    nodes: [...byEdge.results, ...byDocNo.results],
    responsibilities: responsibilities.results,
    activeData: activeData.results,
  });
});

// REST: graph traverse
app.get("/api/traverse/:id", async (c) => {
  const id = c.req.param("id");
  const hops = Math.min(parseInt(c.req.query("hops") ?? "2"), 4);
  const edgeType = c.req.query("type");

  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const start = await c.env.DB.prepare(
    `SELECT id FROM atlas_nodes WHERE ${isUuid ? "id" : "doc_no"}=? LIMIT 1`
  ).bind(id).first<{ id: string }>();
  if (!start) return c.json({ error: "Not found" }, 404);

  const typeFilter = edgeType ? "AND e.type=?" : "";
  const params: unknown[] = [start.id, hops, ...(edgeType ? [edgeType] : [])];

  const { results } = await c.env.DB.prepare(`
    WITH RECURSIVE reachable(id,depth) AS (
      SELECT ?,0
      UNION
      SELECT e.to_id,r.depth+1 FROM edges e JOIN reachable r ON e.from_id=r.id ${typeFilter}
      WHERE r.depth<?
    )
    SELECT DISTINCT n.id,n.doc_no,n.title,n.type,r.depth
    FROM reachable r JOIN atlas_nodes n ON r.id=n.id WHERE n.id!=?
    ORDER BY r.depth,n.doc_no
  `).bind(...params, start.id).all();

  return c.json({ count: results.length, results });
});

export default app;
