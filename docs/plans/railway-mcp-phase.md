# Railway MCP Phase — Implementation Plan

Scope of *this* phase (decided 2026-05-29). The numbered chatbot-plan.md is the
north star; this is the slice we build now.

## In scope
1. **Postgres + schema** for the atlas tables (Docker local first, Railway after).
2. **minisearch** (in-memory, from `docs.json`) wired into `atlas_query` lexical path.
3. **graphology** (in-memory, from `graph.json`) wired into `atlas_query` graph modes.
4. **Vectors syncing into Postgres** (pgvector) — Qwen3 1024d via OpenRouter.
5. **MCP server on Railway** (HTTP streamable, no auth) — the test harness.
6. Core tool set only: `atlas_query`, `atlas_search`, `atlas_get`, `atlas_describe`,
   `atlas_get_address`.

## Out of scope
- Deleting the CF worker (`redlens-mcp/` stays as the live MCP bridge — untouched).
- Auth, the chatbot, any frontend, the `/api/chat` agentic loop.
- Porting the CF worker's `/api/query` REST routes.
- The long-tail tools (history/recent_changes/neighbors/traverse/entity/filter/entity_params).

## Decisions
- **Embeddings**: OpenRouter `qwen/qwen3-embedding-8b`. Native 4096d → slice first
  1024 dims → L2-renormalize. (Pass `dimensions:1024` too; harmless if ignored.)
- **PG client**: `pg` (node-postgres), runs under Bun. Vectors via `$n::vector` casts
  with a `[a,b,c]` bracket string — no extra pgvector npm dep.
- **Code home**: new `src/server/` tree. Entry `src/server/index.ts`. `redlens-mcp/`
  is not touched.
- **MCP transport**: `@modelcontextprotocol/sdk` `McpServer` +
  `WebStandardStreamableHTTPServerTransport`, stateless, mounted at `/mcp` inside
  `Bun.serve`. Indexes + pg pool are process-global; tools close over them.
- **Sync split** (mirrors the "separate lane" rule):
  - `pnpm sync:atlas`   → structural tables, fast, transactional, sha-gated.
  - `pnpm sync:embeddings` → reconcile vectors, incremental by `content_hash`, best-effort.

## Module layout
```
src/server/
  index.ts        # Bun.serve: static SPA + /health + /mcp ; boot-loads indexes + pg
  config.ts       # env (PORT, DATABASE_URL, OPENROUTER_API_KEY, EMBED_MODEL, MCP_PATH)
  db.ts           # pg Pool
  migrate.ts      # numbered-migration runner + schema_migrations
  migrations/001_init_atlas.sql
  indexes.ts      # boot: minisearch + graphology + docMap + childrenIndex (from artifacts)
  embed.ts        # OpenRouter embeddings: embedBatch(), slice1024+L2norm
  search.ts       # runLexical(minisearch) + runSemantic(pg) + rrfMerge
  ancestors.ts    # ancestor chain (parent_id walk) + descendant set (childrenIndex)
  tools.ts        # pure: atlasSearch/atlasGet/atlasDescribe/atlasGetAddress/atlasQuery
  mcp.ts          # createMcpServer() — registers the 5 tools, wraps tools.ts
  sync.ts         # `sync:atlas` entry — structural tables from artifacts
  sync-embeddings.ts # `sync:embeddings` entry — vector reconcile
```

## Postgres schema (migration 001)
- `CREATE EXTENSION IF NOT EXISTS vector`
- `atlas_doc_meta(id pk, doc_no, title, type, depth, parent_id, content_hash, atlas_sha)`
- `atlas_doc_embeddings(doc_id pk → meta, embedding vector(1024), content_hash, atlas_sha)`
  + HNSW cosine index
- `atlas_addresses(address pk, chain, label, chainlog_id, etherscan_name, is_contract,
  is_proxy, implementation, roles jsonb, aliases jsonb, expected_tokens jsonb,
  chain_state jsonb, state_block, entity_id, content_hash, atlas_sha)`
- `atlas_history(doc_id, commit_sha, committed_at, pr_number, summary, change_type,
  content_hash, pk(doc_id,commit_sha))` — best-effort populate from `public/history/*.json`
- `sync_state(id=1, atlas_sha, synced_at)`
- `sync_log(id bigserial, atlas_sha, prev_sha, inserted, updated, deleted, started_at, finished_at)`

Note: `content_hash = sha256(title + "\n" + content)` — excludes doc_no/parent/depth so a
pure renumber doesn't churn embeddings (matches build-rag + chatbot-plan).

## Backend routing per tool
- `atlas_search` — lexical(minisearch) ∪ semantic(pg vector) → rrfMerge; phrase post-filter.
- `atlas_get` — docMap + ancestor walk.
- `atlas_describe` — doc-type counts (docMap), edge/entity counts + entity_type_graph
  (graph), type specs (docMap), atlas_sha (sync_state/manifest).
- `atlas_get_address` — atlas_addresses (pg) + entity join + address in-edges (graph).
- `atlas_query` — search (lex+sem) ∩ entity graph (graph) ∩ target_type (docMap) ∩
  ancestor scope (childrenIndex) ∩ include_params (childrenIndex). History/status dims:
  history left as a no-op unless atlas_history populated; status via minisearch.

## Verification (how the user tests)
1. `pnpm db:up` (docker Postgres+pgvector) → `pnpm sync:atlas` → `pnpm sync:embeddings`.
2. `pnpm start` (or `bun src/server/index.ts`) → `GET /health` green.
3. Point an MCP client at `http://localhost:PORT/mcp`; exercise the 5 tools.

## Status (2026-05-29)
DONE + verified live (no key needed): MCP transport under Bun (stateless streamable
HTTP at /mcp), Postgres schema + migration runner, `sync:atlas` (10319 doc_meta,
320 addresses, 25723 history events), and tools `atlas_describe` / `atlas_get` /
`atlas_search` (lexical) / `atlas_get_address` / `atlas_query` (all graph modes:
entity_broad / entity_chain / type_list / entity_narrow / search). Entity traversal
verified faithful to the live production MCP.

PENDING (needs `OPENROUTER_API_KEY` in `.env.local`): `pnpm sync:embeddings` to
populate pgvector, then semantic + hybrid search verification. Code is written +
typechecks; the semantic leg is a no-op until vectors exist.

### Schema corrections applied to migration 001 (2026-05-29)
- `atlas_doc_meta.ord INT` — sibling order from docs.json `.order` (NR-X docs aren't
  orderable by doc_no). Synced + verified.
- `atlas_addresses` PK is composite `(address, chain)`.
- `atlas_history` carries full PR + move metadata: `commit_seq`, `pr_title`, `pr_url`,
  `pr_author`, `description`, `moved_from`, `moved_to`. `change_type` is mapped to the
  chatbot-plan vocabulary (modified→content, moved→structural; added/removed kept).
- `atlas_addresses` has no `state_block` column — the snapshot block is merged into the
  `chain_state` JSONB and read via `chain_state->>'block'`.

### Deviations from the chatbot-plan (deliberate, scoped)
- **`direction` param on `atlas_query`** defaults to `both` (CF was out-only, which
  hides an entity's responsibilities since active_data_for/responsible_party_for are
  doc→entity). More useful for testing; documented in the tool description.
- **`recent_commits`** on `atlas_query` works via `commit_seq`, but only ~169 history
  events carry a `commit_seq` in the current artifacts, so it covers recent commits only.
- **Structural `sync:atlas` is not yet a single transaction** (sha-gate is the main
  safety). Wrapping the upserts in one `sql.begin` is a follow-up.
- **Entity nodes share their defining doc's UUID** in graph.json, so doc+entity
  collapse to one graphology node; traversal disambiguates via edge `from_type`/
  `to_type` attrs, so this is correct (not a bug).
```
