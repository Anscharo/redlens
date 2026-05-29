import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import askAtlasAgent from "../../.claude/agents/ask-atlas.md";

export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORS: VectorizeIndex;
}

const VECTOR_MODEL = "@cf/baai/bge-base-en-v1.5";
const VECTOR_DIM = 768;
const RRF_K = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

type MetaInfo = Record<string, string | null>;

// kv_meta is 4–8 rows on a PK lookup — cheaper to query each request than
// to manage cache invalidation across isolates after a sync writes new keys.
async function getMeta(db: D1Database): Promise<MetaInfo> {
  try {
    const { results } = await db.prepare("SELECT key, value FROM kv_meta").all<{ key: string; value: string }>();
    if (results.length === 0) return {};
    const out: MetaInfo = {};
    for (const r of results) out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
}

function ok(meta: MetaInfo, payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ _meta: meta, ...(payload as object) }) }],
  };
}

// Resolve a list of UUIDs/doc_nos in a single query.
async function resolveIds(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const sql = `SELECT id, doc_no FROM docs WHERE id IN (${placeholders}) OR doc_no IN (${placeholders})`;
  const { results } = await db.prepare(sql).bind(...ids, ...ids).all<{ id: string; doc_no: string }>();
  const map = new Map<string, string>();
  for (const r of results) {
    map.set(r.id, r.id);
    map.set(r.doc_no, r.id);
  }
  return map;
}

// ---- Search helpers (lexical + semantic + RRF merge) ---------------------

interface BaseRow {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parent_id: string | null;
  content: string;
  snippet?: string;
}
interface LexicalRow extends BaseRow { source: "lexical"; rank: number; score: number; }
interface SemanticRow extends BaseRow { source: "semantic"; rank: number; score: number; }
type SearchRow = (LexicalRow | SemanticRow) & { sources?: string[]; rrf_score?: number };

async function runLexical(
  db: D1Database,
  query: string,
  type: string | undefined,
  fetchK: number,
): Promise<LexicalRow[]> {
  const sql = `
    SELECT n.id, n.doc_no, n.title, n.type, n.depth, n.parent_id, n.content,
           snippet(docs_fts, 4, '<mark>', '</mark>', '…', 24) AS snippet,
           bm25(docs_fts) AS score
    FROM docs_fts JOIN docs n ON docs_fts.rowid = n.rowid
    WHERE docs_fts MATCH ?
    ${type ? "AND n.type = ?" : ""}
    ORDER BY score
    LIMIT ?
  `;
  const params: unknown[] = [query, ...(type ? [type] : []), fetchK];
  try {
    const { results } = await db.prepare(sql).bind(...params).all<{
      id: string; doc_no: string; title: string; type: string; depth: number;
      parent_id: string | null; content: string; snippet: string; score: number;
    }>();
    return results.map((r, i) => ({ ...r, source: "lexical" as const, rank: i, score: r.score }));
  } catch (err) {
    // FTS MATCH errors on bad syntax (e.g., bare punctuation) — return empty.
    console.error("lexical search failed:", err);
    return [];
  }
}

async function runSemantic(
  env: Env,
  db: D1Database,
  query: string,
  type: string | undefined,
  fetchK: number,
): Promise<SemanticRow[]> {
  // Embed the query.
  const embedRes = (await env.AI.run(VECTOR_MODEL, { text: query })) as { data: number[][] };
  const vec = embedRes.data?.[0];
  if (!vec || vec.length !== VECTOR_DIM) {
    throw new Error(`bad embedding shape: ${vec?.length}`);
  }
  // L2-normalize so cosine == dot.
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const normalized = vec.map((x) => x / norm);

  // Post-filter `type` from D1 rather than via Vectorize metadata-filter,
  // which silently returns [] unless a metadata index has been created.
  // Over-fetch when filtering so we still get a useful number of hits.
  const overFetch = type ? Math.min(fetchK * 4, 200) : fetchK;
  const queryRes = await env.VECTORS.query(normalized, { topK: overFetch });
  const matches = queryRes.matches ?? [];
  if (matches.length === 0) return [];

  const ids = matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: rows } = await db
    .prepare(`SELECT id, doc_no, title, type, depth, parent_id, content FROM docs WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<BaseRow>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: SemanticRow[] = [];
  let kept = 0;
  for (let i = 0; i < matches.length && kept < fetchK; i++) {
    const row = byId.get(matches[i].id);
    if (!row) continue;
    if (type && row.type !== type) continue;
    out.push({ ...row, source: "semantic", rank: kept, score: matches[i].score });
    kept++;
  }
  return out;
}

function rrfMerge(lex: LexicalRow[], sem: SemanticRow[]): SearchRow[] {
  const acc = new Map<string, SearchRow>();
  const bump = (row: LexicalRow | SemanticRow) => {
    const prev = acc.get(row.id);
    const inc = 1 / (RRF_K + row.rank + 1);
    if (prev) {
      prev.rrf_score = (prev.rrf_score ?? 0) + inc;
      if (!prev.sources?.includes(row.source)) {
        prev.sources = [...(prev.sources ?? []), row.source];
      }
    } else {
      acc.set(row.id, { ...row, rrf_score: inc, sources: [row.source] });
    }
  };
  for (const r of lex) bump(r);
  for (const r of sem) bump(r);
  return [...acc.values()].sort((a, b) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
}

// One recursive query: ancestor chain (parent → ... → root) for a set of seed UUIDs.
type Ancestor = { id: string; doc_no: string; title: string; type: string; depth: number };
async function getAncestorChains(db: D1Database, seedUuids: string[]): Promise<Map<string, Ancestor[]>> {
  if (seedUuids.length === 0) return new Map();
  const placeholders = seedUuids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`
      WITH RECURSIVE chain(seed, id, hop) AS (
        SELECT id, parent_id, 1 FROM docs WHERE id IN (${placeholders})
        UNION ALL
        SELECT c.seed, d.parent_id, c.hop + 1
        FROM docs d JOIN chain c ON d.id = c.id
        WHERE d.parent_id IS NOT NULL
      )
      SELECT c.seed, c.hop, n.id, n.doc_no, n.title, n.type, n.depth
      FROM chain c JOIN docs n ON n.id = c.id
      ORDER BY c.seed, c.hop
    `)
    .bind(...seedUuids)
    .all<Ancestor & { seed: string; hop: number }>();

  const out = new Map<string, Ancestor[]>();
  for (const seed of seedUuids) out.set(seed, []);
  for (const r of results) {
    out.get(r.seed)!.push({ id: r.id, doc_no: r.doc_no, title: r.title, type: r.type, depth: r.depth });
  }
  return out;
}

// ── Query helpers (used by /api/query) ───────────────────────────────────────

// "30d" → ISO date 30 days ago; ISO strings pass through.
function resolveSince(s: string): string {
  const rel = s.match(/^(\d+)d$/);
  if (rel) {
    const d = new Date(Date.now() - parseInt(rel[1]) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return s;
}

// Set of doc IDs that have a history entry matching the given constraints.
// recent_commits=N → docs changed within the last N commits of HEAD (commit_seq based).
// since/until → date-based filter. Both can be combined (AND semantics).
// Returns null when no constraints are specified (= no filter).
async function getHistorySet(
  db: D1Database,
  since: string | undefined,
  until: string | undefined,
  changeType: string | undefined,
  recentCommits: number | undefined,
): Promise<Set<string> | null> {
  if (!since && !until && !changeType && !recentCommits) return null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (recentCommits) {
    where.push("commit_seq >= (SELECT MAX(commit_seq) FROM node_history) - ?");
    params.push(recentCommits);
  }
  if (since) { where.push("date >= ?"); params.push(since); }
  if (until) { where.push("date <= ?"); params.push(until); }
  if (changeType) { where.push("change_type = ?"); params.push(changeType); }
  const { results } = await db
    .prepare(`SELECT DISTINCT doc_id FROM node_history WHERE ${where.join(" AND ")}`)
    .bind(...params)
    .all<{ doc_id: string }>();
  return new Set(results.map((r) => r.doc_id));
}

// Set of all descendant doc IDs under a given ancestor node.
async function getAncestorSet(db: D1Database, ancestorId: string): Promise<Set<string> | null> {
  const node = await db
    .prepare(`SELECT id FROM docs WHERE ${isUuid(ancestorId) ? "id" : "doc_no"} = ? LIMIT 1`)
    .bind(ancestorId)
    .first<{ id: string }>();
  if (!node) return null;
  const { results } = await db
    .prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT ? UNION ALL SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
      )
      SELECT id FROM tree
    `)
    .bind(node.id)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

// Set of doc IDs that match a status string (checked via FTS on content).
async function getStatusSet(db: D1Database, status: string): Promise<Set<string> | null> {
  if (!status) return null;
  try {
    const { results } = await db
      .prepare(`
        SELECT n.id FROM docs_fts
        JOIN docs n ON docs_fts.rowid = n.rowid
        WHERE docs_fts MATCH ?
        LIMIT 500
      `)
      .bind(status)
      .all<{ id: string }>();
    return new Set(results.map((r) => r.id));
  } catch {
    return null;
  }
}

type CoreParam = { id: string; doc_no: string; name: string; type: string; value: string };

// For a set of doc IDs, fetch their immediate child docs as "params".
async function fetchDocParams(db: D1Database, docIds: string[]): Promise<Map<string, CoreParam[]>> {
  if (docIds.length === 0) return new Map();
  const ph = docIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`
      SELECT id, doc_no, title AS name, type, content AS value, parent_id
      FROM docs WHERE parent_id IN (${ph}) ORDER BY parent_id, ord
    `)
    .bind(...docIds)
    .all<CoreParam & { parent_id: string }>();
  const map = new Map<string, CoreParam[]>();
  for (const { parent_id, ...param } of results) {
    if (!map.has(parent_id)) map.set(parent_id, []);
    map.get(parent_id)!.push(param);
  }
  return map;
}

// Intersect a list of IDs against constraint sets.
// A null set means "no constraint" (pass through). An empty set means "no matches".
function applyConstraints(
  ids: string[],
  ...sets: Array<Set<string> | null>
): string[] {
  let result = ids;
  for (const s of sets) {
    if (s !== null) result = result.filter((id) => s.has(id));
  }
  return result;
}

// Where the deployed RedLens app serves the per-node history JSON.
// v0: hardcoded GitHub Pages URL. Swap to an env var when we have a stable need.
const HISTORY_BASE_URL = "https://anscharo.github.io/redlens/history";


// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

function createMcpServer(env: Env): McpServer {
  const db = env.DB;
  const server = new McpServer({ name: "redlens-atlas", version: "1.3.0" });

  // ---- atlas_describe ----
  server.tool(
    "atlas_describe",
    "Self-describing schema. Returns live doc-type taxonomy with counts, edge-type vocabulary with counts, " +
    "entity types and slugs, entity_type_graph (how entity types connect via graph edges — use this to " +
    "understand traversal chains like facilitator → executor → prime), Type Specifications, and atlas/vectors " +
    "commit pins. Call when you need the live schema, entity traversal chains, exact counts, or the atlas commit pin.",
    {},
    async () => {
      const meta = await getMeta(db);
      const [docTypes, edgeTypes, entityTypes, entitySlugs, typeSpecs, docCount, entityTypeGraph] = await Promise.all([
        db.prepare(`SELECT type, COUNT(*) AS count FROM docs GROUP BY type ORDER BY count DESC`)
          .all<{ type: string; count: number }>(),
        db.prepare(`SELECT edge_type, COUNT(*) AS count FROM edges GROUP BY edge_type ORDER BY count DESC`)
          .all<{ edge_type: string; count: number }>(),
        db.prepare(`SELECT entity_type, subtype, COUNT(*) AS count FROM entities WHERE is_active = 1
                    GROUP BY entity_type, subtype ORDER BY entity_type, subtype`)
          .all<{ entity_type: string; subtype: string | null; count: number }>(),
        db.prepare(`SELECT slug FROM entities WHERE is_active = 1 ORDER BY slug`)
          .all<{ slug: string }>(),
        db.prepare(`SELECT id, doc_no, title FROM docs WHERE type = 'Type Specification'
                    ORDER BY doc_no LIMIT 200`)
          .all<{ id: string; doc_no: string; title: string }>(),
        db.prepare(`SELECT COUNT(*) AS count FROM docs`).first<{ count: number }>(),
        // Entity→entity edge relationships: shows which entity types connect to which,
        // and via what edge type. Deterministically derived from the graph — use this
        // to understand traversal chains (e.g. facilitator → executor → prime).
        db.prepare(`
          SELECT e1.entity_type AS from_type, ed.edge_type, e2.entity_type AS to_type,
                 COUNT(*) AS count
          FROM entities e1
          JOIN edges ed ON ed.from_id = e1.id AND ed.from_type = 'entity' AND ed.to_type = 'entity'
          JOIN entities e2 ON e2.id = ed.to_id
          WHERE e1.is_active = 1 AND e2.is_active = 1
          GROUP BY e1.entity_type, ed.edge_type, e2.entity_type
          ORDER BY count DESC
        `).all<{ from_type: string; edge_type: string; to_type: string; count: number }>(),
      ]);
      return ok(meta, {
        doc_count: docCount?.count ?? 0,
        doc_types: docTypes.results,
        edge_types: edgeTypes.results,
        entity_types: entityTypes.results,
        entity_slugs: entitySlugs.results.map((r) => r.slug),
        entity_type_graph: entityTypeGraph.results,
        type_specifications: typeSpecs.results,
      });
    },
  );

  // ---- atlas_search ----
  server.tool(
    "atlas_search",
    'Search the Sky Atlas. mode="lexical" uses FTS5 (good for exact terms, IDs, addresses). mode="semantic" uses bge-base-en embeddings (good for paraphrase / concept queries). mode="hybrid" (default) merges both via reciprocal rank fusion. Quoted phrases ("...") are post-filtered to require exact substring match in title or content.',
    {
      query: z.string().describe('Query. Quote phrases for exact-substring match: foo "USDS PSM" bar'),
      k: z.number().int().min(1).max(50).default(10),
      type: z.string().optional().describe("Optional Atlas document type filter."),
      mode: z.enum(["lexical", "semantic", "hybrid"]).default("hybrid"),
    },
    async ({ query, k, type, mode }) => {
      const meta = await getMeta(db);
      const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const fetchK = mode === "lexical" && phrases.length === 0 ? k : Math.min(k * 4, 200);

      const [lex, sem] = await Promise.all([
        mode === "semantic"
          ? Promise.resolve<LexicalRow[]>([])
          : runLexical(db, query, type, fetchK),
        mode === "lexical"
          ? Promise.resolve<SemanticRow[]>([])
          : runSemantic(env, db, query, type, fetchK).catch((err) => {
              console.error("semantic search failed:", err);
              return [] as SemanticRow[];
            }),
      ]);

      let merged: SearchRow[];
      if (mode === "lexical") merged = lex;
      else if (mode === "semantic") merged = sem;
      else merged = rrfMerge(lex, sem);

      const filtered = phrases.length === 0
        ? merged
        : merged.filter((r) => {
            const hay = `${r.title}\n${r.content}`.toLowerCase();
            return phrases.every((p) => hay.includes(p.toLowerCase()));
          });
      const trimmed = filtered.slice(0, k).map(({ content: _c, ...rest }) => rest);
      return ok(meta, {
        count: trimmed.length,
        mode,
        phrase_filter: phrases,
        results: trimmed,
      });
    },
  );

  // ---- atlas_get (single or bulk) ----
  server.tool(
    "atlas_get",
    "Fetch one or many Atlas nodes by UUID or doc_no. Each result includes the full ancestor chain (parent → root). Pass a string for one node or an array for bulk.",
    {
      id: z.union([z.string(), z.array(z.string()).min(1).max(100)]).describe("UUID or doc_no, or an array of them."),
    },
    async ({ id }) => {
      const meta = await getMeta(db);
      const inputs = Array.isArray(id) ? id : [id];
      const isBulk = Array.isArray(id);

      const resolved = await resolveIds(db, inputs);
      const uuids = [...new Set(inputs.map((q) => resolved.get(q)).filter((x): x is string => !!x))];
      if (uuids.length === 0) return ok(meta, isBulk ? { results: [] } : { error: "Not found" });

      const placeholders = uuids.map(() => "?").join(",");
      const { results: rows } = await db
        .prepare(`SELECT * FROM docs WHERE id IN (${placeholders})`)
        .bind(...uuids)
        .all<{ id: string; doc_no: string; title: string; type: string; depth: number;
              parent_id: string | null; content: string; ord: number }>();
      const ancestors = await getAncestorChains(db, uuids);

      const enriched = rows.map((r) => ({ ...r, ancestors: ancestors.get(r.id) ?? [] }));

      if (!isBulk) {
        const found = enriched.find((r) => inputs.includes(r.id) || inputs.includes(r.doc_no));
        return ok(meta, found ?? { error: "Not found" });
      }

      // Preserve input order; mark misses.
      const byId = new Map(enriched.map((r) => [r.id, r]));
      const ordered = inputs.map((q) => {
        const uuid = resolved.get(q);
        return uuid ? (byId.get(uuid) ?? { query: q, error: "Not found" }) : { query: q, error: "Not found" };
      });
      return ok(meta, { count: ordered.length, results: ordered });
    },
  );

  // ---- atlas_neighbors ----
  server.tool(
    "atlas_neighbors",
    "Return the hierarchical context around a node: parent, N siblings above/below, and direct children.",
    {
      id: z.string().describe("Node UUID or doc number."),
      window: z.number().int().min(0).max(32).default(8).describe("Siblings and children to include."),
    },
    async ({ id, window }) => {
      const meta = await getMeta(db);
      const col = isUuid(id) ? "id" : "doc_no";
      const target = await db.prepare(`SELECT * FROM docs WHERE ${col} = ? LIMIT 1`).bind(id).first();
      if (!target) return ok(meta, { error: "Not found" });

      const [parent, siblings, children] = await Promise.all([
        target.parent_id
          ? db.prepare("SELECT id,doc_no,title,type,depth FROM docs WHERE id = ?").bind(target.parent_id).first()
          : Promise.resolve(null),
        db.prepare(
          `SELECT id,doc_no,title,type,depth FROM docs WHERE parent_id = ? AND id != ? ORDER BY ord LIMIT ?`,
        ).bind(target.parent_id ?? null, target.id, window * 2).all(),
        db.prepare(
          `SELECT id,doc_no,title,type,depth FROM docs WHERE parent_id = ? ORDER BY ord LIMIT ?`,
        ).bind(target.id, window).all(),
      ]);

      return ok(meta, { target, parent, siblings: siblings.results, children: children.results });
    },
  );

  // ---- atlas_traverse ----
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
      const meta = await getMeta(db);
      const startNode = await db
        .prepare(`SELECT id FROM docs WHERE ${isUuid(id) ? "id" : "doc_no"} = ? LIMIT 1`)
        .bind(id)
        .first<{ id: string }>();
      if (!startNode) return ok(meta, { error: "Not found" });

      const typeFilter = edge_type ? "AND e.edge_type = ?" : "";
      const directionClause =
        direction === "out"
          ? `e.from_id = r.id ${typeFilter}`
          : direction === "in"
            ? `e.to_id = r.id ${typeFilter}`
            : `(e.from_id = r.id OR e.to_id = r.id) ${typeFilter}`;

      const bindParams = edge_type ? [startNode.id, hops, edge_type] : [startNode.id, hops];

      const { results } = await db
        .prepare(`
        WITH RECURSIVE reachable(id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT CASE WHEN e.from_id = r.id THEN e.to_id ELSE e.from_id END, r.depth + 1
          FROM edges e JOIN reachable r ON ${directionClause}
          WHERE r.depth < ?
        )
        SELECT DISTINCT n.id, n.doc_no, n.title, n.type, r.depth
        FROM reachable r
        JOIN docs n ON r.id = n.id
        WHERE n.id != ?
        ORDER BY r.depth, n.doc_no
      `)
        .bind(...bindParams, startNode.id)
        .all();

      return ok(meta, { count: results.length, results });
    },
  );

  // ---- atlas_entity ----
  server.tool(
    "atlas_entity",
    "Get all Atlas sections related to a named entity (agent, role, or actor). Returns nodes, inbound references, and Active Data sections they control.",
    {
      name: z.string().describe("Entity name (e.g. 'spark', 'operational-facilitator', 'core-govops')."),
    },
    async ({ name }) => {
      const meta = await getMeta(db);
      const entity = await db.prepare(`SELECT id, defining_doc_id FROM entities WHERE slug = ? LIMIT 1`)
        .bind(name)
        .first<{ id: string; defining_doc_id: string | null }>();
      const entityId = entity?.id ?? null;
      const rootUuid = entity?.defining_doc_id ?? agentRootUuid(name);

      const [byEdge, byDocNo, responsibilities, activeData] = await Promise.all([
        entityId
          ? db.prepare(`SELECT DISTINCT n.id,n.doc_no,n.title,n.type,n.depth
                        FROM edges e JOIN docs n ON e.to_id=n.id
                        WHERE e.from_id=? LIMIT 100`).bind(entityId).all()
          : Promise.resolve({ results: [] }),
        rootUuid
          ? db.prepare(`WITH RECURSIVE tree(id) AS (
                          SELECT ? UNION ALL
                          SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
                        )
                        SELECT d.id,d.doc_no,d.title,d.type,d.depth
                        FROM docs d JOIN tree t ON d.id = t.id
                        ORDER BY d.doc_no LIMIT 200`).bind(rootUuid).all()
          : Promise.resolve({ results: [] }),
        entityId
          ? db.prepare(`SELECT n.id,n.doc_no,n.title,n.type FROM edges e
                        JOIN docs n ON e.to_id=n.id
                        WHERE e.from_id=? AND e.edge_type='responsible_for'
                        ORDER BY n.doc_no`).bind(entityId).all()
          : Promise.resolve({ results: [] }),
        entityId
          ? db.prepare(`SELECT n.id,n.doc_no,n.title,e.edge_type FROM edges e
                        JOIN docs n ON e.to_id=n.id
                        WHERE e.from_id=? AND n.type IN ('Active Data Controller','Active Data')
                        ORDER BY n.doc_no`).bind(entityId).all()
          : Promise.resolve({ results: [] }),
      ]);

      return ok(meta, {
        entity: name,
        entityId,
        nodes: [...byEdge.results, ...byDocNo.results],
        responsibilities: responsibilities.results,
        activeData: activeData.results,
      });
    },
  );

  // ---- atlas_filter (with structural filters) ----
  server.tool(
    "atlas_filter",
    "Filter Atlas documents by structural attributes. Compose any of: type, entity slug (restricts to entity's artifact subtree), ancestor_id (recursive descendants), doc_no_pattern (SQL LIKE, e.g. '%.0.4.%' for Action Tenets, '%.varX' for variations), depth_min/max.",
    {
      type: z.string().optional().describe("Atlas document type (e.g. 'Active Data', 'Core', 'Action Tenet')."),
      entity: z.string().optional().describe("Entity slug — restricts to the entity's defining_doc subtree."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restricts to recursive descendants of this node."),
      doc_no_pattern: z.string().optional().describe("SQL LIKE pattern over doc_no (use % wildcards)."),
      depth_min: z.number().int().min(0).max(20).optional(),
      depth_max: z.number().int().min(0).max(20).optional(),
      limit: z.number().int().min(1).max(500).default(200),
      include_content: z.boolean().default(true).describe("Include full content in each result row. Set false for lighter responses when listing many rows."),
    },
    async ({ type, entity, ancestor_id, doc_no_pattern, depth_min, depth_max, limit, include_content }) => {
      const meta = await getMeta(db);
      if (!type && !entity && !ancestor_id && !doc_no_pattern && depth_min == null && depth_max == null) {
        return ok(meta, { error: "Provide at least one filter: type, entity, ancestor_id, doc_no_pattern, or depth_min/max" });
      }

      // Resolve subtree root UUID, if any.
      let rootUuid: string | null = null;
      if (entity) {
        const ent = await db.prepare(`SELECT defining_doc_id FROM entities WHERE slug = ? LIMIT 1`)
          .bind(entity.toLowerCase())
          .first<{ defining_doc_id: string | null }>();
        if (!ent?.defining_doc_id) return ok(meta, { error: `Entity '${entity}' not found` });
        rootUuid = ent.defining_doc_id;
      }
      if (ancestor_id) {
        const node = await db
          .prepare(`SELECT id FROM docs WHERE ${isUuid(ancestor_id) ? "id" : "doc_no"} = ? LIMIT 1`)
          .bind(ancestor_id)
          .first<{ id: string }>();
        if (!node) return ok(meta, { error: `ancestor_id '${ancestor_id}' not found` });
        // entity + ancestor_id both set → ancestor_id wins (more specific)
        rootUuid = node.id;
      }

      const cols = `d.id, d.doc_no, d.title, d.type, d.depth, d.parent_id${include_content ? ", d.content" : ""}`;
      const where: string[] = [];
      const params: unknown[] = [];
      if (type) { where.push("d.type = ?"); params.push(type); }
      if (doc_no_pattern) { where.push("d.doc_no LIKE ?"); params.push(doc_no_pattern); }
      if (depth_min != null) { where.push("d.depth >= ?"); params.push(depth_min); }
      if (depth_max != null) { where.push("d.depth <= ?"); params.push(depth_max); }

      let sql: string;
      if (rootUuid) {
        sql = `
          WITH RECURSIVE tree(id) AS (
            SELECT ?
            UNION ALL
            SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
          )
          SELECT ${cols}
          FROM docs d JOIN tree t ON d.id = t.id
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY d.doc_no
          LIMIT ?
        `;
        params.unshift(rootUuid);
        params.push(limit);
      } else {
        sql = `
          SELECT ${cols}
          FROM docs d
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY d.doc_no
          LIMIT ?
        `;
        params.push(limit);
      }

      const { results } = await db.prepare(sql).bind(...params).all();
      return ok(meta, { count: results.length, results });
    },
  );

  // ---- atlas_get_address ----
  server.tool(
    "atlas_get_address",
    "Look up an on-chain address. Returns merged atlas + chain metadata (label, chainlog id, etherscan name, roles, aliases, expected tokens, chain_state snapshot), the linked entity, and the doc edges that reference the address.",
    {
      address: z.string().describe("0x… (EVM) or base58 (Solana)."),
      chain: z.string().optional().describe("Optional chain filter (e.g. 'ethereum', 'solana')."),
    },
    async ({ address, chain }) => {
      const meta = await getMeta(db);
      const addr = address.toLowerCase();

      const addrSql = `
        SELECT a.address, a.chain, a.label, a.chainlog_id, a.etherscan_name,
               a.is_contract, a.is_proxy, a.implementation,
               a.roles AS roles_json, a.aliases AS aliases_json,
               a.expected_tokens AS expected_tokens_json,
               a.chain_state AS chain_state_json, a.state_block, a.entity_id,
               e.slug AS entity_slug, e.name AS entity_name,
               e.entity_type AS entity_type, e.subtype AS entity_subtype,
               e.defining_doc_id AS entity_defining_doc_id
        FROM addresses a
        LEFT JOIN entities e ON a.entity_id = e.id
        WHERE a.address = ? ${chain ? "AND a.chain = ?" : ""}
      `;
      const { results: addrRows } = await db
        .prepare(addrSql)
        .bind(...(chain ? [addr, chain] : [addr]))
        .all();
      if (addrRows.length === 0) return ok(meta, { error: "Address not found", address: addr });

      // Edges where this address is the target.
      const { results: edges } = await db
        .prepare(`
          SELECT e.edge_type, e.source_doc_nos, e.meta AS edge_meta,
                 n.id AS doc_id, n.doc_no, n.title, n.type
          FROM edges e
          LEFT JOIN docs n ON e.from_id = n.id AND e.from_type = 'doc'
          WHERE e.to_id = ? AND e.to_type = 'address'
          ORDER BY n.doc_no
          LIMIT 200
        `)
        .bind(addr)
        .all();

      // Parse JSON columns for ergonomics; drop the raw `_json` strings.
      const records = addrRows.map((r: any) => {
        const { roles_json, aliases_json, expected_tokens_json, chain_state_json, ...rest } = r;
        return {
          ...rest,
          roles: safeJson(roles_json, []),
          aliases: safeJson(aliases_json, []),
          expected_tokens: safeJson(expected_tokens_json, []),
          chain_state: safeJson(chain_state_json, null),
        };
      });

      return ok(meta, { address: addr, records, edges });
    },
  );

  // ---- atlas_entity_params ----
  server.tool(
    "atlas_entity_params",
    "Return the immediate Core children of a doc as a parameter map. Useful for any ICD (operational Instances and in-progress Invocations alike) whose params are encoded as child Cores. Pass either a doc id (UUID/doc_no) or an entity slug — for an entity, returns params for every ICD doc under its defining subtree.",
    {
      id: z.string().optional().describe("Doc UUID or doc_no (typically an instance doc)."),
      entity: z.string().optional().describe("Entity slug — fetch params for all instance docs under entity."),
      type_hint: z.string().optional().describe("Filter instance docs by type (e.g. 'Reward', 'Primitive Instance'). Only applies with `entity`."),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ id, entity, type_hint, limit }) => {
      const meta = await getMeta(db);
      if (!id && !entity) return ok(meta, { error: "Provide id or entity" });

      // Resolve which instance docs to read params for.
      let instanceIds: string[] = [];
      if (id) {
        const node = await db.prepare(`SELECT id FROM docs WHERE ${isUuid(id) ? "id" : "doc_no"} = ? LIMIT 1`)
          .bind(id).first<{ id: string }>();
        if (!node) return ok(meta, { error: "Not found" });
        instanceIds = [node.id];
      } else if (entity) {
        const ent = await db.prepare(`SELECT defining_doc_id FROM entities WHERE slug = ? LIMIT 1`)
          .bind(entity.toLowerCase()).first<{ defining_doc_id: string | null }>();
        if (!ent?.defining_doc_id) return ok(meta, { error: `Entity '${entity}' not found` });
        const sql = `
          WITH RECURSIVE tree(id) AS (
            SELECT ?
            UNION ALL
            SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
          )
          SELECT d.id FROM docs d JOIN tree t ON d.id = t.id
          ${type_hint ? "WHERE d.type = ?" : ""}
          LIMIT ?
        `;
        const params: unknown[] = type_hint ? [ent.defining_doc_id, type_hint, limit] : [ent.defining_doc_id, limit];
        const { results } = await db.prepare(sql).bind(...params).all<{ id: string }>();
        instanceIds = results.map((r) => r.id);
      }
      if (instanceIds.length === 0) return ok(meta, { instances: [] });

      // For each instance, fetch the instance row + its immediate Core children.
      const placeholders = instanceIds.map(() => "?").join(",");
      const [{ results: instRows }, { results: childRows }] = await Promise.all([
        db.prepare(`SELECT id, doc_no, title, type FROM docs WHERE id IN (${placeholders})`)
          .bind(...instanceIds).all<{ id: string; doc_no: string; title: string; type: string }>(),
        db.prepare(`
          SELECT id, doc_no, title, type, content, parent_id
          FROM docs WHERE parent_id IN (${placeholders})
          ORDER BY ord
        `).bind(...instanceIds).all<{ id: string; doc_no: string; title: string; type: string; content: string; parent_id: string }>(),
      ]);

      const childrenByParent = new Map<string, typeof childRows>();
      for (const c of childRows) {
        if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, []);
        childrenByParent.get(c.parent_id)!.push(c);
      }

      const instances = instRows.map((inst) => ({
        ...inst,
        params: (childrenByParent.get(inst.id) ?? []).map((c) => ({
          id: c.id, doc_no: c.doc_no, name: c.title, type: c.type, value: c.content,
        })),
      }));
      return ok(meta, { count: instances.length, instances });
    },
  );

  // ---- atlas_query — unified multi-dimensional query ----
  server.tool(
    "atlas_query",
    "One-call multi-dimensional atlas query. Combines any subset of: semantic/lexical search (q), " +
    "entity graph traversal (entity + edge_types), entity-chain traversal (entity + via_entity_type), " +
    "doc-type filter (target_type), history window (since/until/change_type), status filter, " +
    "ancestor scope (ancestor_id), and inline instance params (include_params). " +
    "All active dimensions are intersected server-side. " +
    "Use instead of chaining atlas_search + atlas_filter + atlas_entity + atlas_history when the question " +
    "spans multiple dimensions (e.g. 'Active Primitive Instances for primes connected to X updated in last 30 days').",
    {
      q:               z.string().optional().describe("Keyword/semantic search terms (hybrid FTS5+vector by default)."),
      entity:          z.string().optional().describe("Entity slug. With no other graph params: returns all edge-grouped docs (broad view)."),
      edge_types:      z.array(z.string()).optional().describe("Filter entity edges to these types. Omit for broad view."),
      target_type:     z.string().optional().describe("Atlas doc type filter (e.g. 'Active Data', 'Primitive Instance')."),
      via_entity_type: z.string().optional().describe("Entity-chain traversal: entity → entities of this type → their docs. E.g. via_entity_type='prime' with entity='endgame-edge' finds docs for primes connected to that entity."),
      recent_commits:  z.number().int().min(1).max(500).optional().describe("Restrict to docs changed within the last N commits of HEAD. Prefer this over since/until for 'recent' questions — commit proximity is more meaningful than calendar time for atlas changes."),
      since:           z.string().optional().describe("ISO date (YYYY-MM-DD) or relative ('30d') — restrict to docs changed on/after this date. Use recent_commits instead when the question says 'recently' without a specific date."),
      until:           z.string().optional().describe("ISO date or relative — restrict to docs changed on/before this date."),
      change_type:     z.enum(["added", "modified", "removed", "moved"]).optional().describe("Filter history to this change type."),
      status:          z.string().optional().describe("Filter by instance status: Active, Suspended, Completed, Inactive."),
      ancestor_id:     z.string().optional().describe("UUID or doc_no — restrict results to descendants of this node."),
      include_params:  z.boolean().optional().describe("Inline immediate child docs as 'params' on each result (for Primitive Instance and Reward docs)."),
      direction:       z.enum(["out", "in", "both"]).optional().describe("Edge direction for entity traversal. Default: out."),
      k:               z.number().int().min(1).max(50).default(10).describe("Max results to return."),
      enrich:          z.boolean().default(true).describe("Include full content and ancestor chain. Default true."),
    },
    async ({ q, entity, edge_types, target_type, via_entity_type, recent_commits,
             since: sinceRaw, until: untilRaw, change_type, status, ancestor_id,
             include_params, direction, k, enrich }) => {
      const meta = await getMeta(db);

      if (!q && !entity && !target_type) {
        return ok(meta, { error: "at least one of q, entity, or target_type is required" });
      }

      const since = sinceRaw ? resolveSince(sinceRaw) : undefined;
      const until = untilRaw ? resolveSince(untilRaw) : undefined;

      // Resolve entity
      let entityId: string | null = null;
      if (entity) {
        const rec = await db.prepare(`SELECT id FROM entities WHERE slug = ? LIMIT 1`).bind(entity).first<{ id: string }>();
        if (!rec) return ok(meta, { error: `Entity '${entity}' not found` });
        entityId = rec.id;
      }

      // Build constraint sets in parallel
      const [historySet, ancestorSet, statusSet] = await Promise.all([
        getHistorySet(db, since, until, change_type, recent_commits),
        ancestor_id ? getAncestorSet(db, ancestor_id) : Promise.resolve(null),
        status ? getStatusSet(db, status) : Promise.resolve(null),
      ]);

      const constrain = (ids: string[]) => applyConstraints(ids, historySet, ancestorSet, statusSet);

      const enrichRows = async (rows: BaseRow[]) => {
        if (rows.length === 0) return rows as (BaseRow & Record<string, unknown>)[];
        const ids = rows.map((r) => r.id);
        const [anc, paramsMap] = await Promise.all([
          enrich ? getAncestorChains(db, ids) : Promise.resolve(new Map<string, Ancestor[]>()),
          include_params ? fetchDocParams(db, ids) : Promise.resolve(new Map<string, CoreParam[]>()),
        ]);
        return rows.map((r) => ({
          ...r,
          ...(enrich ? { ancestors: anc.get(r.id) ?? [] } : {}),
          ...(include_params ? { params: paramsMap.get(r.id) ?? [] } : {}),
        }));
      };

      const cols = `n.id, n.doc_no, n.title, n.type, n.depth, n.parent_id${enrich ? ", n.content" : ""}`;

      // ── Mode: entity chain ──────────────────────────────────────────────
      if (entityId && via_entity_type) {
        const edgeFilter = edge_types?.length
          ? `AND ed.edge_type IN (${edge_types.map(() => "?").join(",")})`
          : "";
        const { results: chainEnts } = await db
          .prepare(`SELECT e2.id FROM edges ed JOIN entities e2 ON e2.id = ed.to_id
                    WHERE ed.from_id = ? AND ed.from_type = 'entity' AND ed.to_type = 'entity'
                    ${edgeFilter} AND e2.entity_type = ?`)
          .bind(...[entityId, ...(edge_types ?? []), via_entity_type])
          .all<{ id: string }>();
        const chainIds = chainEnts.map((e) => e.id);
        if (chainIds.length === 0) return ok(meta, { entity, via_entity_type, mode: "entity_chain", count: 0, results: [] });
        const ph = chainIds.map(() => "?").join(",");
        const { results: docRows } = await db
          .prepare(`SELECT DISTINCT ${cols} FROM edges ed JOIN docs n ON n.id = ed.to_id
                    WHERE ed.from_id IN (${ph}) AND ed.from_type = 'entity' AND ed.to_type = 'doc'
                    ${target_type ? "AND n.type = ?" : ""} ORDER BY n.doc_no LIMIT ?`)
          .bind(...[...chainIds, ...(target_type ? [target_type] : []), k * 4])
          .all<BaseRow>();
        const kept = docRows.filter((r) => constrain([r.id]).length > 0).slice(0, k);
        const enriched = await enrichRows(kept);
        return ok(meta, { entity, via_entity_type, mode: "entity_chain", count: enriched.length, results: enriched });
      }

      // ── Mode: entity broad ──────────────────────────────────────────────
      if (entityId && !edge_types?.length && !q) {
        const { results } = await db
          .prepare(`SELECT e.edge_type, ${cols} FROM edges e JOIN docs n ON e.to_id = n.id
                    WHERE e.from_id = ? ${target_type ? "AND n.type = ?" : ""}
                    ORDER BY e.edge_type, n.doc_no LIMIT 200`)
          .bind(...(target_type ? [entityId, target_type] : [entityId]))
          .all<BaseRow & { edge_type: string }>();
        const grouped: Record<string, unknown[]> = {};
        for (const { edge_type, ...doc } of results) {
          (grouped[edge_type] ??= []).push(doc);
        }
        for (const rel of Object.keys(grouped)) {
          const docs = grouped[rel] as BaseRow[];
          const kept = docs.filter((d) => constrain([d.id]).length > 0);
          grouped[rel] = await enrichRows(kept);
          if ((grouped[rel] as unknown[]).length === 0) delete grouped[rel];
        }
        return ok(meta, { entity, mode: "entity_broad", by_relationship: grouped });
      }

      // ── Mode: target_type only ──────────────────────────────────────────
      if (!entity && !q && target_type) {
        const { results: typeRows } = await db
          .prepare(`SELECT ${cols} FROM docs n WHERE n.type = ? ORDER BY n.doc_no LIMIT ?`)
          .bind(target_type, k * 4)
          .all<BaseRow>();
        const kept = typeRows.filter((r) => constrain([r.id]).length > 0).slice(0, k);
        const enriched = await enrichRows(kept);
        return ok(meta, { mode: "type_list", type: target_type, count: enriched.length, results: enriched });
      }

      // ── Build entity doc set ────────────────────────────────────────────
      let entityDocIds: Set<string> | null = null;
      if (entityId) {
        const typeFilter = edge_types?.length
          ? `AND e.edge_type IN (${edge_types.map(() => "?").join(",")})`
          : "";
        const { results: edgeRows } = await db
          .prepare(`SELECT DISTINCT n.id FROM edges e JOIN docs n ON e.to_id = n.id
                    WHERE e.from_id = ? ${typeFilter} ${target_type ? "AND n.type = ?" : ""} LIMIT 500`)
          .bind(...[entityId, ...(edge_types ?? []), ...(target_type ? [target_type] : [])])
          .all<{ id: string }>();
        entityDocIds = new Set(constrain(edgeRows.map((r) => r.id)));
      }

      // ── Search ──────────────────────────────────────────────────────────
      let searchRows: SearchRow[] = [];
      if (q) {
        const fetchK = Math.min(k * 4, 200);
        const [lex, sem] = await Promise.all([
          runLexical(db, q, target_type, fetchK),
          runSemantic(env, db, q, target_type, fetchK).catch(() => [] as SemanticRow[]),
        ]);
        searchRows = rrfMerge(lex, sem);
      }

      // ── Intersect and constrain ─────────────────────────────────────────
      let resultRows: SearchRow[];
      if (q && entityDocIds) {
        resultRows = searchRows.filter((r) => entityDocIds!.has(r.id));
      } else if (q) {
        resultRows = searchRows;
      } else {
        const ids = [...(entityDocIds ?? [])].slice(0, k);
        if (ids.length === 0) return ok(meta, { entity, mode: "entity_narrow", count: 0, results: [] });
        const ph = ids.map(() => "?").join(",");
        const { results: docRows } = await db
          .prepare(`SELECT ${cols} FROM docs n WHERE n.id IN (${ph}) ORDER BY n.doc_no`)
          .bind(...ids).all<BaseRow>();
        const enriched = await enrichRows(docRows);
        return ok(meta, { entity, mode: "entity_narrow", count: enriched.length, results: enriched });
      }

      const constrainedIds = new Set(constrain(resultRows.map((r) => r.id)));
      const trimmed = resultRows.filter((r) => constrainedIds.has(r.id)).slice(0, k);
      const baseRows: BaseRow[] = trimmed.map((r) => ({
        id: r.id, doc_no: r.doc_no, title: r.title, type: r.type,
        depth: r.depth, parent_id: r.parent_id, content: r.content,
      }));
      const enriched = await enrichRows(baseRows);
      const mode = q && entityDocIds ? "hybrid_graph" : "search";
      const out = enriched.map((r, i) => ({
        ...r, snippet: trimmed[i]?.snippet ?? "", score: trimmed[i]?.rrf_score ?? trimmed[i]?.score ?? 0,
      }));
      return ok(meta, { mode, count: out.length, results: out });
    },
  );

  // atlas_history — change log for one doc, with PR rationale
  server.tool(
    "atlas_history",
    "Why was this changed? Returns the git-log of changes for one Atlas doc (UUID or doc_no), newest first, each with PR title/author/url and the matched summary/description from the PR body. Filter by date range, PR number, or change type. Set with_diff=true to also fetch line+word diffs from the deployed RedLens site.",
    {
      id: z.string().describe("Doc UUID or doc_no (e.g. 'A.1.2.3')."),
      since: z.string().optional().describe("ISO date (YYYY-MM-DD) — only changes on or after this date."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD) — only changes on or before this date."),
      pr: z.number().int().optional().describe("Filter to a single PR number."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      with_diff: z.boolean().default(false).describe("If true, fetch line+word diffs from the deployed RedLens history JSON and inline them into matching events."),
    },
    async ({ id, since, until, pr, change_type, with_diff }) => {
      // Resolve id to UUID — history is keyed by UUID
      const doc = await db
        .prepare(`SELECT id, doc_no, title, type FROM docs WHERE ${UUID_RE.test(id) ? "id" : "doc_no"} = ? LIMIT 1`)
        .bind(id)
        .first<{ id: string; doc_no: string; title: string; type: string }>();
      if (!doc) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }] };
      }

      const where = ["doc_id = ?"];
      const params: unknown[] = [doc.id];
      if (since) { where.push("date >= ?"); params.push(since); }
      if (until) { where.push("date <= ?"); params.push(until); }
      if (pr != null) { where.push("pr_number = ?"); params.push(pr); }
      if (change_type) { where.push("change_type = ?"); params.push(change_type); }

      const { results } = await db
        .prepare(`SELECT date, commit_hash, change_type, pr_number, pr_title, pr_author, pr_url,
                         summary, description, moved_from, moved_to
                  FROM node_history WHERE ${where.join(" AND ")}
                  ORDER BY date DESC, id DESC`)
        .bind(...params)
        .all<{
          date: string; commit_hash: string; change_type: string;
          pr_number: number | null; pr_title: string | null; pr_author: string | null; pr_url: string | null;
          summary: string | null; description: string | null;
          moved_from: string | null; moved_to: string | null;
        }>();

      let events: Array<Record<string, unknown>> = results;

      if (with_diff && results.length > 0) {
        try {
          const res = await fetch(`${HISTORY_BASE_URL}/${doc.id}.json`, { cf: { cacheTtl: 300 } } as RequestInit);
          if (res.ok) {
            const raw = (await res.json()) as Array<{ commitHash: string; diff?: unknown }>;
            const diffByCommit = new Map(raw.map((e) => [e.commitHash, e.diff]));
            events = results.map((e) => ({ ...e, diff: diffByCommit.get(e.commit_hash) ?? null }));
          }
        } catch (err) {
          console.error("atlas_history with_diff fetch failed:", err);
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ doc, count: events.length, events }) }],
      };
    },
  );

  // atlas_recent_changes — global feed of recent changes, type-filterable
  server.tool(
    "atlas_recent_changes",
    "What changed recently? Returns the most recent change events across the whole atlas, optionally filtered by doc type (e.g. 'Active Data'), change type, or entity (restricts to docs owned by that entity via responsible_party_for / active_data_for edges). Defaults to the last 30 days.",
    {
      since: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 30 days ago."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      type: z.string().optional().describe("Atlas doc type filter (e.g. 'Active Data', 'Core', 'Annotation')."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      entity: z.string().optional().describe("Entity slug — restricts to docs linked to this entity via responsible_party_for or active_data_for edges (e.g. 'spark', 'phoenix-labs')."),
      k: z.number().int().min(1).max(200).default(50),
    },
    async ({ since, until, type, change_type, entity, k }) => {
      const defaultSince = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 30);
        return d.toISOString().slice(0, 10);
      })();

      let entityId: string | null = null;
      if (entity) {
        const ent = await db
          .prepare("SELECT id FROM entities WHERE slug = ? LIMIT 1")
          .bind(entity)
          .first<{ id: string }>();
        if (!ent) return { content: [{ type: "text", text: JSON.stringify({ error: `entity '${entity}' not found` }) }] };
        entityId = ent.id;
      }

      const where = ["h.date >= ?"];
      const params: unknown[] = [since ?? defaultSince];
      if (until) { where.push("h.date <= ?"); params.push(until); }
      if (type) { where.push("n.type = ?"); params.push(type); }
      if (change_type) { where.push("h.change_type = ?"); params.push(change_type); }

      const entityJoin = entityId
        ? `JOIN edges ef ON ef.to_id = h.doc_id AND ef.from_id = ? AND ef.edge_type IN ('responsible_party_for', 'active_data_for')`
        : "";
      if (entityId) params.unshift(entityId);

      const { results } = await db
        .prepare(`SELECT h.date, h.commit_hash, h.change_type,
                         h.pr_number, h.pr_title, h.pr_author, h.pr_url,
                         h.summary, h.description,
                         n.id AS doc_id, n.doc_no, n.title, n.type
                  FROM node_history h
                  JOIN docs n ON n.id = h.doc_id
                  ${entityJoin}
                  WHERE ${where.join(" AND ")}
                  ORDER BY h.date DESC, h.id DESC
                  LIMIT ?`)
        .bind(...params, k)
        .all();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            since: since ?? defaultSince,
            until: until ?? null,
            type: type ?? null,
            change_type: change_type ?? null,
            entity: entity ?? null,
            count: results.length,
            events: results,
          }),
        }],
      };
    },
  );

  // atlas_pr — every doc touched by a single PR
  server.tool(
    "atlas_pr",
    "What did PR #N touch? Returns every doc affected by a single GitHub PR against next-gen-atlas, with the matched per-doc summary/description from the PR body.",
    {
      pr_number: z.number().int().describe("GitHub PR number on sky-ecosystem/next-gen-atlas."),
    },
    async ({ pr_number }) => {
      const { results } = await db
        .prepare(`SELECT h.date, h.commit_hash, h.change_type,
                         h.pr_title, h.pr_author, h.pr_url,
                         h.summary, h.description,
                         h.moved_from, h.moved_to,
                         n.id AS doc_id, n.doc_no, n.title, n.type
                  FROM node_history h
                  LEFT JOIN docs n ON n.id = h.doc_id
                  WHERE h.pr_number = ?
                  ORDER BY n.doc_no, h.change_type`)
        .bind(pr_number)
        .all<{ pr_title: string | null; pr_author: string | null; pr_url: string | null }>();

      const first = results[0];
      const pr = first
        ? { number: pr_number, title: first.pr_title, author: first.pr_author, url: first.pr_url }
        : { number: pr_number, title: null, author: null, url: null };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ pr, count: results.length, events: results }),
        }],
      };
    },
  );

  // atlas_changed_between — diff view between two atlas commits
  server.tool(
    "atlas_changed_between",
    "Which docs changed between two atlas commits? Pass two short commit SHAs (as returned by atlas_describe, atlas_history, or atlas_recent_changes) and get every doc that was added, modified, moved, or removed in that window. Uses commit_seq (topological git order) for exact ordering — immune to author-date rebase skew. Optionally filter by change_type, ancestor_id (subtree), or entity (docs owned by a facilitator via responsible_party_for / active_data_for edges). Results are grouped by doc, each with its change events.",
    {
      commit_a: z.string().describe("First boundary commit SHA (7-char prefix or full)."),
      commit_b: z.string().describe("Second boundary commit SHA (7-char prefix or full)."),
      change_type: z.enum(["added", "modified", "removed", "moved"]).optional(),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restrict results to descendants of this node."),
      entity: z.string().optional().describe("Entity slug — restricts to docs linked to this entity via responsible_party_for or active_data_for edges (e.g. 'spark', 'phoenix-labs')."),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ commit_a, commit_b, change_type, ancestor_id, entity, limit }) => {
      const sha_a = commit_a.slice(0, 7);
      const sha_b = commit_b.slice(0, 7);

      const [rowA, rowB] = await Promise.all([
        db.prepare("SELECT commit_seq FROM node_history WHERE commit_hash = ? LIMIT 1").bind(sha_a).first<{ commit_seq: number }>(),
        db.prepare("SELECT commit_seq FROM node_history WHERE commit_hash = ? LIMIT 1").bind(sha_b).first<{ commit_seq: number }>(),
      ]);

      if (!rowA) return { content: [{ type: "text", text: JSON.stringify({ error: `commit_a '${sha_a}' not found in history — may have had no doc changes` }) }] };
      if (!rowB) return { content: [{ type: "text", text: JSON.stringify({ error: `commit_b '${sha_b}' not found in history — may have had no doc changes` }) }] };

      const seq_lo = Math.min(rowA.commit_seq, rowB.commit_seq);
      const seq_hi = Math.max(rowA.commit_seq, rowB.commit_seq);

      let rootUuid: string | null = null;
      if (ancestor_id) {
        const node = await db
          .prepare(`SELECT id FROM docs WHERE ${isUuid(ancestor_id) ? "id" : "doc_no"} = ? LIMIT 1`)
          .bind(ancestor_id)
          .first<{ id: string }>();
        if (!node) return { content: [{ type: "text", text: JSON.stringify({ error: `ancestor_id '${ancestor_id}' not found` }) }] };
        rootUuid = node.id;
      }

      let entityId: string | null = null;
      if (entity) {
        const ent = await db
          .prepare("SELECT id FROM entities WHERE slug = ? LIMIT 1")
          .bind(entity)
          .first<{ id: string }>();
        if (!ent) return { content: [{ type: "text", text: JSON.stringify({ error: `entity '${entity}' not found` }) }] };
        entityId = ent.id;
      }

      const where = ["h.commit_seq >= ?", "h.commit_seq <= ?"];
      const params: unknown[] = [seq_lo, seq_hi];
      if (change_type) { where.push("h.change_type = ?"); params.push(change_type); }

      const entityJoin = entityId
        ? `JOIN edges ef ON ef.to_id = h.doc_id AND ef.from_id = ? AND ef.edge_type IN ('responsible_party_for', 'active_data_for')`
        : "";

      let sql: string;
      if (rootUuid) {
        // param order: rootUuid (CTE seed), [entityId], seq_lo, seq_hi, [change_type], limit
        const orderedParams: unknown[] = [rootUuid];
        if (entityId) orderedParams.push(entityId);
        orderedParams.push(...params, limit);
        sql = `
          WITH RECURSIVE tree(id) AS (
            SELECT ?
            UNION ALL
            SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
          )
          SELECT h.doc_id, h.date, h.commit_hash, h.commit_seq, h.change_type,
                 h.pr_number, h.pr_title, h.pr_author, h.pr_url,
                 h.summary, h.description, h.moved_from, h.moved_to,
                 n.doc_no, n.title, n.type
          FROM node_history h
          LEFT JOIN docs n ON n.id = h.doc_id
          JOIN tree t ON t.id = h.doc_id
          ${entityJoin}
          WHERE ${where.join(" AND ")}
          ORDER BY h.commit_seq, n.doc_no
          LIMIT ?
        `;
        const { results: r2 } = await db.prepare(sql).bind(...orderedParams).all<{
          doc_id: string; date: string; commit_hash: string; commit_seq: number; change_type: string;
          pr_number: number | null; pr_title: string | null; pr_author: string | null; pr_url: string | null;
          summary: string | null; description: string | null;
          moved_from: string | null; moved_to: string | null;
          doc_no: string | null; title: string | null; type: string | null;
        }>();
        const byDoc2 = new Map<string, { doc_no: string | null; title: string | null; type: string | null; events: unknown[] }>();
        for (const r of r2) {
          if (!byDoc2.has(r.doc_id)) byDoc2.set(r.doc_id, { doc_no: r.doc_no, title: r.title, type: r.type, events: [] });
          byDoc2.get(r.doc_id)!.events.push({
            date: r.date, commit_hash: r.commit_hash, commit_seq: r.commit_seq, change_type: r.change_type,
            pr_number: r.pr_number, pr_title: r.pr_title, pr_author: r.pr_author, pr_url: r.pr_url,
            summary: r.summary, description: r.description, moved_from: r.moved_from, moved_to: r.moved_to,
          });
        }
        const docs2 = Array.from(byDoc2.entries()).map(([id, d]) => ({ id, ...d }));
        return { content: [{ type: "text", text: JSON.stringify({ commit_a: sha_a, commit_b: sha_b, seq_lo, seq_hi, doc_count: docs2.length, docs: docs2 }) }] };
      }

      // No rootUuid: param order: [entityId], seq_lo, seq_hi, [change_type], limit
      const orderedParams: unknown[] = [];
      if (entityId) orderedParams.push(entityId);
      orderedParams.push(...params, limit);

      const flatSql = `
        SELECT h.doc_id, h.date, h.commit_hash, h.commit_seq, h.change_type,
               h.pr_number, h.pr_title, h.pr_author, h.pr_url,
               h.summary, h.description, h.moved_from, h.moved_to,
               n.doc_no, n.title, n.type
        FROM node_history h
        LEFT JOIN docs n ON n.id = h.doc_id
        ${entityJoin}
        WHERE ${where.join(" AND ")}
        ORDER BY h.commit_seq, n.doc_no
        LIMIT ?
      `;

      const { results } = await db.prepare(flatSql).bind(...orderedParams).all<{
        doc_id: string; date: string; commit_hash: string; commit_seq: number; change_type: string;
        pr_number: number | null; pr_title: string | null; pr_author: string | null; pr_url: string | null;
        summary: string | null; description: string | null;
        moved_from: string | null; moved_to: string | null;
        doc_no: string | null; title: string | null; type: string | null;
      }>();

      const byDoc = new Map<string, { doc_no: string | null; title: string | null; type: string | null; events: unknown[] }>();
      for (const r of results) {
        if (!byDoc.has(r.doc_id)) {
          byDoc.set(r.doc_id, { doc_no: r.doc_no, title: r.title, type: r.type, events: [] });
        }
        byDoc.get(r.doc_id)!.events.push({
          date: r.date, commit_hash: r.commit_hash, commit_seq: r.commit_seq, change_type: r.change_type,
          pr_number: r.pr_number, pr_title: r.pr_title, pr_author: r.pr_author, pr_url: r.pr_url,
          summary: r.summary, description: r.description,
          moved_from: r.moved_from, moved_to: r.moved_to,
        });
      }

      const docs = Array.from(byDoc.entries()).map(([id, d]) => ({ id, ...d }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ commit_a: sha_a, commit_b: sha_b, seq_lo, seq_hi, doc_count: docs.length, docs }),
        }],
      };
    },
  );

  return server;
}

function safeJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// Map entity slug to Atlas artifact root UUID for subtree fallback queries.
// UUIDs are stable; doc_nos change on atlas renumbering.
function agentRootUuid(name: string): string {
  const map: Record<string, string> = {
    spark:           "dee2f5a4-279a-488c-9a9d-9583e3216fbf", // A.6.1.1.1
    grove:           "727b0de6-095b-485e-bf9c-02108a364480", // A.6.1.1.2
    keel:            "bc6aed17-2969-4d04-9af6-c7bf3e4497e6", // A.6.1.1.3
    skybase:         "c88439b5-f456-4e51-8825-42e0ba83546f", // A.6.1.1.4
    obex:            "f558e673-cbab-4696-8ca1-3af9b90fe5d4", // A.6.1.1.5
    pattern:         "dc083d10-74bc-43b6-ab2f-c91efce76e84", // A.6.1.1.6
    "launch-agent-6": "eba0dcc7-e135-496f-b866-342deeb91dc4", // A.6.1.1.7
    "launch-agent-7": "d0d77316-0b08-447c-b75a-ae7926b07019", // A.6.1.1.8
  };
  return map[name.toLowerCase()] ?? "";
}

// ---------------------------------------------------------------------------
// Hono app — MCP + REST
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// Landing page
app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RedLens Atlas MCP</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #555; margin-bottom: 32px; }
    .subtitle a { color: #a63228; }
    h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 28px 0 8px; }
    pre { background: #f4f1ec; border-radius: 6px; padding: 16px; overflow-x: auto; font-size: 0.85rem; }
    code { font-family: "Source Code Pro", monospace; }
    .endpoint { font-size: 0.9rem; color: #444; }
    .endpoint code { background: #f4f1ec; padding: 2px 6px; border-radius: 3px; }
    footer { margin-top: 48px; font-size: 0.8rem; color: #aaa; }
    footer a { color: #aaa; }
  </style>
</head>
<body>
  <h1>RedLens Atlas MCP Server</h1>
  <p class="subtitle">
    Query the <a href="https://github.com/sky-ecosystem/next-gen-atlas" target="_blank">Sky Atlas</a> —
    the governance &amp; operational constitution of the
    <a href="https://sky.money" target="_blank">Sky protocol</a> —
    using natural-language and structured search directly from your AI assistant.
  </p>

  <h2>What is this?</h2>
  <p>
    An <a href="https://modelcontextprotocol.io" target="_blank">MCP (Model Context Protocol)</a> server
    that gives AI tools (Claude, Cursor, etc.) full-text and graph search over the
    9,825-node Sky Atlas document. Ask your assistant things like
    <em>"What does the Sky Atlas say about USDS stability fees?"</em> or
    <em>"Show me the Active Data sections controlled by Spark."</em>
  </p>

  <h2>Ask the Atlas (Claude Code agent)</h2>
  <p>
    Install the <code>ask-atlas</code> subagent into your project — a Sky Atlas governance specialist
    that retrieves and cites atlas documents to answer questions about rules, roles, primitives, and entities.
  </p>
  <pre><code>mkdir -p .claude/agents && curl -fsSL https://redlens-mcp.anscharo.workers.dev/install/ask-atlas -o .claude/agents/ask-atlas.md</code></pre>
  <p>Then connect the MCP server (see below), reload Claude Code, and invoke with <code>@ask-atlas</code>:</p>
  <pre><code>@ask-atlas What does the Atlas say about USDS stability fees?
@ask-atlas Show me the Active Data sections controlled by Spark
@ask-atlas learn: [paste content] (source: forum post by X)</code></pre>

  <h2>Add to Claude Code</h2>
  <p>Add the following to your project's <code>.mcp.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens": {
      "type": "http",
      "url": "https://redlens-mcp.anscharo.workers.dev/mcp"
    }
  }
}</code></pre>

  <h2>Add to Claude Desktop</h2>
  <p>Add the following to your <code>claude_desktop_config.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://redlens-mcp.anscharo.workers.dev/mcp"
      ]
    }
  }
}</code></pre>

  <h2>Add to Cursor / other MCP clients</h2>
  <p>Point your client at the streamable HTTP endpoint:</p>
  <pre><code>https://redlens-mcp.anscharo.workers.dev/mcp</code></pre>

  <h2>Run locally (development)</h2>
  <p>Clone the repo, then in <code>redlens-mcp/</code>:</p>
  <pre><code>pnpm dev   # starts wrangler dev on http://localhost:8787</code></pre>
  <p>Then add to <code>.mcp.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "redlens-local": {
      "type": "http",
      "url": "http://localhost:8787/mcp"
    }
  }
}</code></pre>

  <h2>REST API (no client needed)</h2>
  <p class="endpoint">
    <code>GET /api/search?q=…&amp;k=10</code> — full-text search<br/>
    <code>GET /api/node/:id</code> — fetch node by UUID or doc number (e.g. <code>A.1.2.3</code>)<br/>
    <code>GET /api/entity/:name</code> — all sections for a named entity<br/>
    <code>GET /api/address/:addr</code> — address lookup with linked entity + edges<br/>
    <code>GET /api/traverse/:id?hops=2</code> — graph traversal from a node<br/>
    <code>GET /api/meta</code> — current atlas/redlens commit + generation timestamp
  </p>

  <h2>Available MCP tools</h2>
  <p class="endpoint">
    <code>atlas_describe</code> — live schema: doc types, edge types, entity slugs, type specs, atlas/vectors pins<br/>
    <code>atlas_search</code> — FTS5 full-text search; quoted phrases match as exact substrings<br/>
    <code>atlas_get</code> — single or bulk fetch (array of ids); each result includes ancestor chain<br/>
    <code>atlas_neighbors</code> — parent / siblings / children of a node<br/>
    <code>atlas_traverse</code> — multi-hop typed-edge traversal<br/>
    <code>atlas_entity</code> — aggregate view of a named entity (agent, role, actor)<br/>
    <code>atlas_filter</code> — structural filter: type / entity / ancestor / doc_no_pattern / depth<br/>
    <code>atlas_get_address</code> — on-chain address lookup with merged atlas + chain metadata<br/>
    <code>atlas_entity_params</code> — child-Core "params" of an instance doc (Reward, Primitive Instance, …)<br/>
    <code>atlas_history</code> — change log for one doc, with PR rationale; filter by date range, PR, or change type<br/>
    <code>atlas_recent_changes</code> — global feed of recent changes across the atlas, type-filterable<br/>
    <code>atlas_pr</code> — every doc touched by a single GitHub PR<br/>
    <code>atlas_changed_between</code> — all docs changed between two atlas commits (exact topological order via commit_seq)
  </p>
  <p>Every tool response is wrapped with <code>_meta: { atlasCommit, redlensCommit, generatedAt }</code> so callers can verify which atlas snapshot produced the answer.</p>

  <footer>
    <a href="https://github.com/anscharo/redlens" target="_blank">github.com/anscharo/redlens</a>
  </footer>
</body>
</html>`;
  return c.html(html);
});

// Install: serve the ask-atlas agent definition
app.get("/install/ask-atlas", (c) =>
  c.text(askAtlasAgent, 200, { "Content-Type": "text/plain; charset=utf-8" }),
);

// MCP endpoint (streamable HTTP transport — POST only; SSE not supported in stateless workers)
app.get("/mcp", (c) => c.text("Method Not Allowed", 405));
app.post("/mcp", async (c) => {
  const server = createMcpServer(c.env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

// REST: meta
app.get("/api/meta", async (c) => c.json(await getMeta(c.env.DB)));

// REST: search — hybrid (FTS5 + semantic RRF) with optional enrichment.
// ?enrich=true adds ancestors (breadcrumb) and full content to each result,
// so callers can answer without a follow-up atlas_get round-trip.
// ?mode=lexical|semantic|hybrid (default: hybrid)
app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const k = Math.min(parseInt(c.req.query("k") ?? "10"), 50);
  const type = c.req.query("type") ?? undefined;
  const mode = (c.req.query("mode") ?? "hybrid") as "lexical" | "semantic" | "hybrid";
  const enrich = c.req.query("enrich") === "true";
  if (!q) return c.json({ error: "q required" }, 400);

  const fetchK = Math.min(k * 4, 200);
  const [lex, sem] = await Promise.all([
    mode === "semantic" ? Promise.resolve<LexicalRow[]>([]) : runLexical(c.env.DB, q, type, fetchK),
    mode === "lexical"
      ? Promise.resolve<SemanticRow[]>([])
      : runSemantic(c.env, c.env.DB, q, type, fetchK).catch((err) => {
          console.error("REST semantic search failed:", err);
          return [] as SemanticRow[];
        }),
  ]);

  let merged: SearchRow[];
  if (mode === "lexical") merged = lex;
  else if (mode === "semantic") merged = sem;
  else merged = rrfMerge(lex, sem);

  const trimmed = merged.slice(0, k);

  if (enrich) {
    const ids = trimmed.map((r) => r.id);
    const ancestors = await getAncestorChains(c.env.DB, ids);
    const results = trimmed.map((r) => ({
      id: r.id,
      doc_no: r.doc_no,
      title: r.title,
      type: r.type,
      depth: r.depth,
      snippet: r.snippet ?? "",
      score: r.rrf_score ?? r.score,
      content: r.content,
      ancestors: ancestors.get(r.id) ?? [],
    }));
    return c.json({ count: results.length, mode, results });
  }

  const results = trimmed.map(({ content: _c, ...rest }) => ({
    ...rest,
    snippet: rest.snippet ?? "",
    score: rest.rrf_score ?? rest.score,
  }));
  return c.json({ count: results.length, mode, results });
});

// REST: get node
app.get("/api/node/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT n.*,p.doc_no AS parent_doc_no,p.title AS parent_title
     FROM docs n LEFT JOIN docs p ON n.parent_id=p.id
     WHERE ${isUuid(id) ? "n.id" : "n.doc_no"}=? LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// REST: entity view
app.get("/api/entity/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const entity = await c.env.DB.prepare(
    `SELECT id,slug,name,entity_type,subtype,defining_doc_id FROM entities WHERE slug=? LIMIT 1`,
  )
    .bind(name)
    .first<{ id: string; slug: string; name: string; entity_type: string; subtype: string; defining_doc_id: string | null }>();
  const entityId = entity?.id ?? null;
  const rootUuid = entity?.defining_doc_id ?? agentRootUuid(name);

  const [byEdge, byDocNo, responsibilities, activeData] = await Promise.all([
    entityId
      ? c.env.DB.prepare(`SELECT DISTINCT n.id,n.doc_no,n.title,n.type,n.depth
                          FROM edges e JOIN docs n ON e.to_id=n.id WHERE e.from_id=? LIMIT 100`)
          .bind(entityId)
          .all()
      : Promise.resolve({ results: [] }),
    rootUuid
      ? c.env.DB.prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT ? UNION ALL
             SELECT d.id FROM docs d JOIN tree t ON d.parent_id = t.id
           )
           SELECT d.id,d.doc_no,d.title,d.type,d.depth
           FROM docs d JOIN tree t ON d.id = t.id
           ORDER BY d.doc_no LIMIT 200`,
        )
          .bind(rootUuid)
          .all()
      : Promise.resolve({ results: [] }),
    entityId
      ? c.env.DB.prepare(`SELECT n.id,n.doc_no,n.title,n.type FROM edges e
                          JOIN docs n ON e.to_id=n.id
                          WHERE e.from_id=? AND e.edge_type='responsible_for' ORDER BY n.doc_no`)
          .bind(entityId)
          .all()
      : Promise.resolve({ results: [] }),
    entityId
      ? c.env.DB.prepare(`SELECT n.id,n.doc_no,n.title,e.edge_type FROM edges e
                          JOIN docs n ON e.to_id=n.id
                          WHERE e.from_id=? AND n.type IN ('Active Data Controller','Active Data') ORDER BY n.doc_no`)
          .bind(entityId)
          .all()
      : Promise.resolve({ results: [] }),
  ]);

  return c.json({
    entity: { slug: name, ...entity },
    nodes: [...byEdge.results, ...byDocNo.results],
    responsibilities: responsibilities.results,
    activeData: activeData.results,
  });
});

// REST: address lookup
app.get("/api/address/:addr", async (c) => {
  const addr = c.req.param("addr").toLowerCase();
  const chain = c.req.query("chain");
  const { results: addrRows } = await c.env.DB
    .prepare(`
      SELECT a.address, a.chain, a.label, a.chainlog_id, a.etherscan_name,
             a.is_contract, a.is_proxy, a.implementation,
             a.roles AS roles_json, a.aliases AS aliases_json,
             a.expected_tokens AS expected_tokens_json,
             a.chain_state AS chain_state_json, a.state_block, a.entity_id,
             e.slug AS entity_slug, e.name AS entity_name,
             e.entity_type AS entity_type, e.subtype AS entity_subtype
      FROM addresses a LEFT JOIN entities e ON a.entity_id = e.id
      WHERE a.address = ? ${chain ? "AND a.chain = ?" : ""}
    `)
    .bind(...(chain ? [addr, chain] : [addr]))
    .all();
  if (addrRows.length === 0) return c.json({ error: "Not found", address: addr }, 404);

  const { results: edges } = await c.env.DB
    .prepare(`SELECT e.edge_type, e.source_doc_nos, n.id AS doc_id, n.doc_no, n.title, n.type
              FROM edges e LEFT JOIN docs n ON e.from_id = n.id AND e.from_type='doc'
              WHERE e.to_id = ? AND e.to_type = 'address' ORDER BY n.doc_no LIMIT 200`)
    .bind(addr)
    .all();

  const records = (addrRows as any[]).map((r) => {
    const { roles_json, aliases_json, expected_tokens_json, chain_state_json, ...rest } = r;
    return {
      ...rest,
      roles: safeJson(roles_json, []),
      aliases: safeJson(aliases_json, []),
      expected_tokens: safeJson(expected_tokens_json, []),
      chain_state: safeJson(chain_state_json, null),
    };
  });
  return c.json({ address: addr, records, edges });
});

// REST: graph traverse
app.get("/api/traverse/:id", async (c) => {
  const id = c.req.param("id");
  const hops = Math.min(parseInt(c.req.query("hops") ?? "2"), 4);
  const edgeType = c.req.query("type");

  const start = await c.env.DB.prepare(
    `SELECT id FROM docs WHERE ${isUuid(id) ? "id" : "doc_no"}=? LIMIT 1`,
  )
    .bind(id)
    .first<{ id: string }>();
  if (!start) return c.json({ error: "Not found" }, 404);

  const typeFilter = edgeType ? "AND e.edge_type=?" : "";
  const params: unknown[] = [start.id, hops, ...(edgeType ? [edgeType] : [])];

  const { results } = await c.env.DB.prepare(`
    WITH RECURSIVE reachable(id,depth) AS (
      SELECT ?,0
      UNION
      SELECT e.to_id,r.depth+1 FROM edges e JOIN reachable r ON e.from_id=r.id ${typeFilter}
      WHERE r.depth<?
    )
    SELECT DISTINCT n.id,n.doc_no,n.title,n.type,r.depth
    FROM reachable r JOIN docs n ON r.id=n.id WHERE n.id!=?
    ORDER BY r.depth,n.doc_no
  `)
    .bind(...params, start.id)
    .all();

  return c.json({ count: results.length, results });
});

// REST: entities — all active entity slugs for system-prompt injection
app.get("/api/entities", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT slug, name, entity_type, subtype FROM entities WHERE is_active = 1 ORDER BY entity_type, slug`,
  ).all<{ slug: string; name: string; entity_type: string; subtype: string | null }>();
  return c.json({ count: results.length, entities: results });
});

// REST: query — unified search + graph traversal with multi-dimension intersection.
//
// Core dimensions (any combination):
//   q              → hybrid FTS5+semantic search
//   entity         → entity slug → connected docs
//   edge_types     → filter which edges to follow from entity
//   target_type    → filter by Atlas doc type
//   via_entity_type → entity-chain traversal: entity → entities of this type → their docs
//
// Filter dimensions (applied as AND intersections on top of any mode):
//   since / until  → restrict to docs changed in this window (ISO date or "30d")
//   change_type    → added|modified|removed|moved
//   status         → Active|Suspended|Completed|Inactive (content match)
//   ancestor_id    → restrict to descendants of this node
//
// Enrichment:
//   enrich=true    → add content + ancestors to each result
//   include_params → inline immediate child docs as "params" (for instance docs)
app.get("/api/query", async (c) => {
  const q               = c.req.query("q") ?? undefined;
  const entity          = c.req.query("entity")?.toLowerCase();
  const edgeTypes       = c.req.query("edge_types")?.split(",").map((s) => s.trim()).filter(Boolean);
  const targetType      = c.req.query("target_type") ?? undefined;
  const direction       = (c.req.query("direction") ?? "out") as "out" | "in" | "both";
  const hops            = Math.min(parseInt(c.req.query("hops") ?? "2"), 4);
  const enrich          = c.req.query("enrich") === "true";
  const k               = Math.min(parseInt(c.req.query("k") ?? "10"), 50);
  const sinceRaw        = c.req.query("since") ?? undefined;
  const untilRaw        = c.req.query("until") ?? undefined;
  const changeType      = c.req.query("change_type") ?? undefined;
  const status          = c.req.query("status") ?? undefined;
  const ancestorIdRaw   = c.req.query("ancestor_id") ?? undefined;
  const viaEntityType   = c.req.query("via_entity_type") ?? undefined;
  const includeParams   = c.req.query("include_params") === "true";
  const recentCommits   = c.req.query("recent_commits") ? parseInt(c.req.query("recent_commits")!) : undefined;

  const since = sinceRaw ? resolveSince(sinceRaw) : undefined;
  const until = untilRaw ? resolveSince(untilRaw) : undefined;

  if (!q && !entity && !targetType) {
    return c.json({ error: "at least one of q, entity, or target_type is required" }, 400);
  }

  // ── Resolve entity slug → id ──────────────────────────────────────────────
  let entityId: string | null = null;
  if (entity) {
    const rec = await c.env.DB
      .prepare(`SELECT id FROM entities WHERE slug = ? LIMIT 1`)
      .bind(entity)
      .first<{ id: string }>();
    if (!rec) return c.json({ error: `Entity '${entity}' not found` }, 404);
    entityId = rec.id;
  }

  // ── Build constraint sets (run in parallel) ───────────────────────────────
  const [historySet, ancestorSet, statusSet] = await Promise.all([
    getHistorySet(c.env.DB, since, until, changeType, recentCommits),
    ancestorIdRaw ? getAncestorSet(c.env.DB, ancestorIdRaw) : Promise.resolve(null),
    status ? getStatusSet(c.env.DB, status) : Promise.resolve(null),
  ]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const constrain = (ids: string[]) => applyConstraints(ids, historySet, ancestorSet, statusSet);

  const enrichRows = async (rows: BaseRow[]) => {
    if (rows.length === 0) return rows as (BaseRow & Record<string, unknown>)[];
    const ids = rows.map((r) => r.id);
    const [anc, paramsMap] = await Promise.all([
      enrich ? getAncestorChains(c.env.DB, ids) : Promise.resolve(new Map<string, Ancestor[]>()),
      includeParams ? fetchDocParams(c.env.DB, ids) : Promise.resolve(new Map<string, CoreParam[]>()),
    ]);
    return rows.map((r) => ({
      ...r,
      ...(enrich ? { ancestors: anc.get(r.id) ?? [] } : {}),
      ...(includeParams ? { params: paramsMap.get(r.id) ?? [] } : {}),
    }));
  };

  // ── Mode: entity chain (via_entity_type set) ──────────────────────────────
  // entity → entities of via_entity_type → their docs
  if (entityId && viaEntityType) {
    const edgeFilter = edgeTypes?.length
      ? `AND ed.edge_type IN (${edgeTypes.map(() => "?").join(",")})`
      : "";
    const { results: chainEntities } = await c.env.DB
      .prepare(`
        SELECT e2.id FROM edges ed
        JOIN entities e2 ON e2.id = ed.to_id
        WHERE ed.from_id = ? AND ed.from_type = 'entity' AND ed.to_type = 'entity'
        ${edgeFilter}
        AND e2.entity_type = ?
      `)
      .bind(...[entityId, ...(edgeTypes ?? []), viaEntityType])
      .all<{ id: string }>();

    const chainIds = chainEntities.map((e) => e.id);
    if (chainIds.length === 0) {
      return c.json({ entity, via_entity_type: viaEntityType, mode: "entity_chain", count: 0, results: [] });
    }

    const ph = chainIds.map(() => "?").join(",");
    const { results: docRows } = await c.env.DB
      .prepare(`
        SELECT DISTINCT n.id, n.doc_no, n.title, n.type, n.depth, n.parent_id
          ${enrich ? ", n.content" : ""}
        FROM edges ed JOIN docs n ON n.id = ed.to_id
        WHERE ed.from_id IN (${ph}) AND ed.from_type = 'entity' AND ed.to_type = 'doc'
        ${targetType ? "AND n.type = ?" : ""}
        ORDER BY n.doc_no LIMIT ?
      `)
      .bind(...[...chainIds, ...(targetType ? [targetType] : []), k * 4])
      .all<BaseRow>();

    const constrained = constrain(docRows.map((r) => r.id));
    const kept = docRows.filter((r) => constrained.includes(r.id)).slice(0, k);
    const enriched = await enrichRows(kept);

    // Also apply q filter if present
    let final = enriched;
    if (q && kept.length > 0) {
      const qLower = q.toLowerCase();
      final = enriched.filter((r) =>
        r.title.toLowerCase().includes(qLower) || (r as any).content?.toLowerCase().includes(qLower)
      );
    }

    return c.json({ entity, via_entity_type: viaEntityType, mode: "entity_chain", count: final.length, results: final });
  }

  // ── Mode: entity broad (no edge_types, no q) ──────────────────────────────
  if (entityId && !edgeTypes?.length && !q) {
    const { results } = await c.env.DB
      .prepare(`
        SELECT e.edge_type, n.id, n.doc_no, n.title, n.type, n.depth, n.parent_id
               ${enrich ? ", n.content" : ""}
        FROM edges e JOIN docs n ON e.to_id = n.id
        WHERE e.from_id = ?
        ${targetType ? "AND n.type = ?" : ""}
        ORDER BY e.edge_type, n.doc_no
        LIMIT 200
      `)
      .bind(...(targetType ? [entityId, targetType] : [entityId]))
      .all<BaseRow & { edge_type: string }>();

    const grouped: Record<string, unknown[]> = {};
    for (const { edge_type, ...doc } of results) {
      (grouped[edge_type] ??= []).push(doc);
    }

    // Apply constraints and enrich within each group
    for (const rel of Object.keys(grouped)) {
      const docs = grouped[rel] as BaseRow[];
      const constrainedIds = constrain(docs.map((d) => d.id));
      const kept = docs.filter((d) => constrainedIds.includes(d.id));
      grouped[rel] = await enrichRows(kept);
      if ((grouped[rel] as unknown[]).length === 0) delete grouped[rel];
    }

    return c.json({ entity, mode: "entity_broad", by_relationship: grouped });
  }

  // ── Mode: target_type only ────────────────────────────────────────────────
  if (!entity && !q && targetType) {
    const { results: typeRows } = await c.env.DB
      .prepare(`SELECT id, doc_no, title, type, depth, parent_id${enrich ? ", content" : ""} FROM docs WHERE type = ? ORDER BY doc_no LIMIT ?`)
      .bind(targetType, k * 4)
      .all<BaseRow>();
    const constrainedIds = constrain(typeRows.map((r) => r.id));
    const kept = typeRows.filter((r) => constrainedIds.includes(r.id)).slice(0, k);
    const enriched = await enrichRows(kept);
    return c.json({ mode: "type_list", type: targetType, count: enriched.length, results: enriched });
  }

  // ── Build entity doc set (for narrow or intersection) ─────────────────────
  let entityDocIds: Set<string> | null = null;
  if (entityId) {
    const typeFilter = edgeTypes?.length
      ? `AND e.edge_type IN (${edgeTypes.map(() => "?").join(",")})`
      : "";
    const { results: edgeRows } = await c.env.DB
      .prepare(`
        SELECT DISTINCT n.id FROM edges e JOIN docs n ON e.to_id = n.id
        WHERE e.from_id = ? ${typeFilter}
        ${targetType ? "AND n.type = ?" : ""}
        LIMIT 500
      `)
      .bind(...[entityId, ...(edgeTypes ?? []), ...(targetType ? [targetType] : [])])
      .all<{ id: string }>();
    entityDocIds = new Set(constrain(edgeRows.map((r) => r.id)));
  }

  // ── Search ────────────────────────────────────────────────────────────────
  let searchRows: SearchRow[] = [];
  if (q) {
    const fetchK = Math.min(k * 4, 200);
    const [lex, sem] = await Promise.all([
      runLexical(c.env.DB, q, targetType, fetchK),
      runSemantic(c.env, c.env.DB, q, targetType, fetchK).catch(() => [] as SemanticRow[]),
    ]);
    searchRows = rrfMerge(lex, sem);
  }

  // ── Intersect ─────────────────────────────────────────────────────────────
  let resultRows: SearchRow[];
  if (q && entityDocIds) {
    resultRows = searchRows.filter((r) => entityDocIds!.has(r.id));
  } else if (q) {
    resultRows = searchRows;
  } else {
    // entity narrow only
    const ids = [...(entityDocIds ?? [])].slice(0, k);
    if (ids.length === 0) return c.json({ entity, mode: "entity_narrow", count: 0, results: [] });
    const ph = ids.map(() => "?").join(",");
    const { results: docRows } = await c.env.DB
      .prepare(`SELECT id, doc_no, title, type, depth, parent_id${enrich ? ", content" : ""} FROM docs WHERE id IN (${ph}) ORDER BY doc_no`)
      .bind(...ids)
      .all<BaseRow>();
    const enriched = await enrichRows(docRows);
    return c.json({ entity, mode: "entity_narrow", count: enriched.length, results: enriched });
  }

  // Apply remaining constraints to search results, then slice
  const constrainedIds = new Set(constrain(resultRows.map((r) => r.id)));
  const trimmed = resultRows.filter((r) => constrainedIds.has(r.id)).slice(0, k);

  // ── Final enrich ──────────────────────────────────────────────────────────
  const mode = q && entityDocIds ? "hybrid_graph" : "search";
  const baseRows: BaseRow[] = trimmed.map((r) => ({
    id: r.id, doc_no: r.doc_no, title: r.title, type: r.type,
    depth: r.depth, parent_id: r.parent_id, content: r.content,
  }));
  const enriched = await enrichRows(baseRows);
  const out = enriched.map((r, i) => ({
    ...r,
    snippet: trimmed[i]?.snippet ?? "",
    score: trimmed[i]?.rrf_score ?? trimmed[i]?.score ?? 0,
  }));
  return c.json({ mode, count: out.length, results: out });
});


export default app;
