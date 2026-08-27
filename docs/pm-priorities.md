# PM Priorities

A product-led priority list for SAbR — ordered by user value and strategic
leverage, not by infra-first reflex. Grounded in the current state of the codebase as of
2026-06-17.

**Recently shipped (context):** Preview feature (view any atlas PR/branch/fork as a live
redline atlas), the in-process atlas self-updater + resilience hardening (PR #70), the
Railway-hosted MCP server, agentic chat (backend + floating widget), Radar,
five Reports, and one-command `pnpm dev`. The product is live; these priorities are about
deepening value and shoring up the core promise.

| # | Priority | Why it matters (user value) | Status today | Next step |
|---|----------|------------------------------|--------------|-----------|
| 1 | **Atlas freshness & data correctness** | The whole promise is *live, trustworthy* atlas data. A stale or internally-skewed view silently misleads governance readers. | In-process updater + resilience (advisory-locked migrations, `/api/freshness`, bounded retry, stale/stuck alarms) shipped. Gap: artifacts publish non-atomically → browser can catch cross-file skew. | Implement live-as-bundle atomic publish (the deferred item in `atlas-freshness-resilience.md`); add an alert on `/api/freshness` 503s. |
| 2 | **Search & reader quality** | "Search-first" is the core value prop — if search misses or mis-ranks, the product fails at its one job. | MiniSearch full-content + phrase/address/field filters live. No relevance eval, no shared search core (FE and MCP server duplicate logic). | Stand up a search-quality eval (extend `scripts/eval/eval-golden-questions.ts`); land `src/lib/search/` shared core (`shared-search-core.md`) so reader + MCP rank identically. |
| 3 | **Graph extraction coverage** | The graph (Radar, Reports, MCP traversal) is only as good as its coverage; atlas renumbering/new conventions silently drop edges. | 23 extraction patterns; coverage census (`census:check`) + graph snapshot tests guard drift. New atlas PRs regularly surface uncovered clusters. | Triage census `[drift]` warnings each atlas bump; convert recurring uncovered clusters into new patterns; migrate remaining fragile `doc_no` prefix matches to UUID/parent-link traversal. |
| 4 | **Chat & MCP as distribution** | Chat + MCP turn the atlas into an answer engine and let external agents consume governance data — reach beyond the reader UI. | Backend chat + 5-tool MCP shipped; floating widget MVP shipped. Pending: pgvector embeddings are a no-op until an API key populates vectors; conversation history/resume; MCP discoverability. | Populate embeddings (set the OpenRouter key) to switch on semantic/hybrid search; add conversation history; write a real MCP landing/install page for the Railway endpoint. |
| 5 | **Entity surfaces (Radar / Reports)** | These turn raw docs into the views people actually come for (who is accountable, what's active, reward flows). Differentiated value over reading the raw atlas. | Radar actor pages and 5 reports live and actively iterated. | Prioritise the next report/actor enrichment by usage; keep report modules pure + tested as they grow. |
| 6 | **Tech-debt & audit follow-ups** | Keeps the above shippable; left unattended these become reliability bugs (hung UI, unmaintainable files). | Tracked in CLAUDE.md "Pending work". | Opportunistic: graph-worker pending-callback timeout (`src/lib/graph.ts`); split the 18 over-150-line components when touched; remove `build-graph` redundant re-merge; history metrics backfill (`pnpm build:history --full`). |
| 7 | **Developer experience & docs** | Lowers contribution friction; keeps the build reproducible. | Largely done: `pnpm dev` is one-command (preflight → Docker → Postgres → atlas sync → artifacts); `REPRO=1` enforces byte-identical builds; `manifest.json` checksums every artifact. | Keep `docs/DEPLOYMENT.md` + `railway-env-vars.md` current; finish the manual browser-verification checklist for the audit fixes. |

---

These priorities lead with the product's core promise — fresh, correct, searchable
governance data — then its differentiated surfaces (graph/entities, chat/MCP), and keep
tech-debt and DX as supporting concerns rather than headline items. Detailed designs live in
`docs/plans/`; superseded and spent plans are in `docs/plans/archive/`.
