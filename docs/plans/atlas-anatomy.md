# Atlas Anatomy — Plan

## Motivation

The Atlas is consumed today in two bad modes: as a monolith document (scroll and pray), or as
a collection of atoms whose relationships must be "discovered" by digging or by asking people
with tenure. Neither supports scholarship. We want a third mode: a curated, generated,
navigable **anatomy** — an educational/wiki/analysis layer inside RedLens that lets someone:

1. See the **shape** of the whole (what chunks exist, how they group, how big each is).
2. **Digest one chunk closely** as a coherent whole (its rules, members, entities, processes)
   while still seeing how it relates to neighboring chunks.
3. Look up **terms** without hunting (glossary as a first-class artifact).
4. Tell **live from stale** — which parts are operationally active, which are scaffolding,
   which are probably dead — via explicit heuristics instead of tribal knowledge.

The chunk taxonomy that drives all of this lives in `docs/atlas-map.md` (the companion
research doc). This plan is about turning that taxonomy into artifacts, data, and UI.

## Product vision

A new app section, `/anatomy`, with four faces:

| Page | Purpose |
|---|---|
| **Shape** (`/anatomy`) | Visual weight map — treemap/sunburst of chunks, grouped by taxonomy, sized by doc mass (and later by activity). The "you are here" overview. |
| **Contents** (`/anatomy/contents`) | The distilled table of contents: chunk-level, not raw-tree-level. Each entry links to a chunk page and into the reader. |
| **Chunk pages** (`/anatomy/chunk/<slug>`) | One page per chunk: digest (curated prose), key rules, member docs, entities involved, edges to other chunks, weight stats, staleness badges. |
| **Glossary** (`/anatomy/glossary`) | All defined terms (we already build `glossary.json` — 100+ terms with aliases), each with definition, source pointer, and usage locations. |

Design stance: **generated skeleton, curated flesh.** Structure, weights, memberships, edges,
and staleness signals are computed by build passes (reproducible, drift-proof). Digest prose
is authored markdown checked into the repo (with Claude as co-author), keyed by chunk id, so
scholarship accumulates in git.

## Data pipeline (new artifacts)

### `public/anatomy.json` — the chunk registry (P1)

> **Update 2026-07-24:** the artifact was folded away. The shipped shape data
> (chunk trees, weights, totals) measured 2 MB as an artifact while being a pure
> projection of `docs.json`, so it is now computed client-side per data-source
> base (`src/lib/anatomyShape.ts`, called from `loadAnatomy`) — the Stale Dates
> pattern. The registry design below still describes the P1+ *chunk* model
> (slugs, relations, staleness); if/when that lands it should stay a computed
> module or a trimmed server-side section, not a shipped multi-MB artifact.

Built by a new pass `scripts/required/build-anatomy.mjs` (prototype starts life as
`scripts/aux/atlas-shape.mjs`). For each chunk:

```jsonc
{
  "id": "primitive-spec-anatomy",        // stable slug, curated
  "group": "spec",                        // taxonomy group (see atlas-map.md §2)
  "title": "Sky Primitives (spec anatomy)",
  "roots": ["fcde2604-..."],             // UUID root(s); doc_no NEVER used as key
  "weights": { "docs": 400, "bytes": 123456, "entities": 15, "activeInstances": 0 },
  "relations": [{ "chunk": "agent-artifacts", "kind": "spec_of", "via": "instance_of" }],
  "staleness": { "lastContentChange": "2026-05-02", "signals": ["..."] }
}
```

Chunk membership = subtree of the root UUIDs, minus overlaps claimed by more specific chunks
(e.g. a prime artifact chunk owns its subtree; the "agent artifacts" group chunk aggregates).
Overlay chunks (Active Data, Annotations, Needed Research) are doc-type-defined, not
subtree-defined — the registry supports both membership rules.

### Curated digest content — `docs/anatomy/chunks/<slug>.md` (P2+)

Front-matter: `chunk: <slug>`, `status: draft|reviewed`, `updated: YYYY-MM-DD`. Body is the
scholarly digest. The app loads these (build step copies into an artifact or imports at build
time). Until the UI exists they are readable in the repo/GitHub.

### Seed resources (P0 — this branch)

- `docs/anatomy/toc.md` — generated chunk-aware table of contents with weights + pointers.
- `docs/anatomy/shape.md` — generated weight tables/diagrams (the "shape of the Atlas").
- `.cache/atlas-shape.json` — raw computed stats backing both (regenerable, not committed).

(Removed post-P2 along with `scripts/aux/atlas-shape.mjs`: nothing read the generated
markdown once `/anatomy` shipped against `anatomy.json`/`glossary.json` directly, and it
wasn't wired into any build script, so it went stale. See `docs/atlas-map.md`.)

## Staleness / liveness heuristics

The signals we can compute **today** (roughly in order of reliability):

1. **Git history age** — last content change per subtree (`atlas_history` DB / MCP
   `atlas_history_stats`). A rule chunk untouched for a year ≠ stale; an *instance* untouched
   since creation while siblings churn probably is. So: age **relative to chunk-type cohort**.
2. **Explicit status fields** — instance status (Active/Suspended/Completed/Inactive), and
   primitive `Global Activation Status`. A primitive copy that was never globally activated
   and has zero instances is **scaffolding, not content** — huge for de-noising the artifact
   chunks (this is most of the small primes' doc mass).
3. **Empty directory scaffolding** — hub directories (Active/Completed/In-Progress) with no
   children. Cheap structural test, catches "template only" subtrees.
4. **Dated obligations** — the existing Stale Dates report already finds past-due dates in
   text; attribute each hit to its owning chunk.
5. **Transitional content** — docs titled "Short-Term Transitionary Measures" (they appear
   throughout artifacts) and `pending_transition` edges; both imply an expiry review.
6. **Reference rot** — `cites`/`mentions` edges pointing at removed docs (history knows
   removals), or at chunks marked inactive.
7. **Entity liveness** — derecognized actors, multisigs with no recent on-chain activity
   (we already snapshot chain state), accords whose parties are gone.

Each signal becomes a badge + a score component on chunk pages. **None of them delete or
hide content** — the anatomy's job is to *flag* for human judgment, not to prune.

## Phases

- **P0 — Research & seed artifacts** (now): plan doc, `atlas-shape.mjs` prototype,
  `docs/anatomy/{toc,shape}.md` generated, glossary census. No UI.
- **P1 — Chunk registry**: curated slug/taxonomy seed + `build-anatomy.mjs` emitting
  `public/anatomy.json`; snapshot test; census guard for new-structure drift (mirror the
  existing census pattern).
- **P2 — Anatomy UI, read-only**: `/anatomy` Shape (treemap), Contents, Glossary pages
  consuming `anatomy.json` + existing `glossary.json`. Follow app conventions (URL-synced
  state, analytics, semantic HTML). Not a "report" — it gets its own nav entry.
- **P3 — Chunk pages + staleness**: digest markdown pipeline, staleness signal computation
  (needs history DB access in the build, or a server endpoint), badges.
- **P4 — Scholarship**: cross-chunk analyses (e.g. "the multisig network", "instance
  footprint per prime"), reading paths ("start here" curricula), glossary usage maps.

## Decisions & open questions

- **Where does staleness compute run?** Signals 1/6 need history (Postgres). Options: build
  pass under Bun with DB (like `census:risk`), or server endpoint like history. Decide in P3.
- **Treemap anatomy**: nothing heavy — either hand-rolled SVG (chunk count is small, ~40
  leaves) or a tiny dependency. Decide in P2 with a look at bundle impact.
- **Chunk slugs are a new curated surface** — like `processes.json`, they'll need drift
  triage when the Atlas restructures. Reuse the census/baseline pattern.
- **Out of scope for now**: editing/annotation from the UI, multi-version diffing of chunks
  (history views exist elsewhere in the app), report search/export integration (deferred
  pending evaluation of the other dev's report-search branches).

## Progress log

- **2026-07-20** — Plan written. P0 executed: `scripts/aux/atlas-shape.mjs` prototype,
  generated `docs/anatomy/toc.md` + `docs/anatomy/shape.md`, glossary census. Taxonomy
  source: `docs/atlas-map.md`.
