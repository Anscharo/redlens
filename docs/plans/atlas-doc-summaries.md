# Placement-aware document summaries as a second retrieval signal

## Context

The reader's meaning lane embeds each atlas document's own text. Measured from `public/docs.json`
(11,584 nodes): **median body 124 characters**, p90 464, and 7,932 documents under 200 chars. A
typical atlas document is one line whose meaning lives in its *placement* — which ICD it configures,
which scope it sits under, who cites it — none of which is in the text being embedded.

`src/server/config.ts:176-186` already records the symptom: the shipped query prefix pushed thin
(<120 char) documents from 48% to 13% of top-10 hits. The grouping policy
(`kv_records_breadcrumbs`) is a workaround for the same problem — it folds 939 anchors' worth of
thin leaves into composite vectors because "a 30-character parameter leaf cannot be retrieved as its
own vector".

This plan writes one short **placement-aware description** per document with a strong model — facts
knowable only from the document's position and from other documents that mention it — embeds those,
and scores queries against both signals. The published precedent is Anthropic's **Contextual
Retrieval** (Sept 2024): LLM-written per-chunk context, reported as a 35% reduction in retrieval
failures (49% with BM25 + reranking). Its recipe prepends the context and keeps *one* vector; the
two-vector variant is the other arm. Both are measured here rather than assumed.

**Cost is not the constraint.** Full corpus through the Batch API on Sonnet 5.5 is ~$11 (~$23
standard; ~$15 batched under pessimistic token assumptions). Per the user's instruction, the
**initial pass is written by this session's own subagents, not OpenRouter**, so the pilot spends no
API budget at all.

**A secondary payoff:** the best leaf-attribution arm measured yesterday was
`rrf(lexResid, demoteA0.5)` at 44.9% vs the 43.9% shipped, and it was unshippable only because it
needs an anchor's own one-to-one vector, which no row in `atlas_doc_embeddings` holds. Per-document
summary vectors supply exactly that. Not a promise — an arm to measure once the summaries exist.

## Branch

Stacked on PR #425: branch `claude/atlas-doc-summaries` off `claude/ecstatic-shannon-aju925`, PR
base set to that branch. (#425 stays reviewable on its own.)

---

## Part 0 — DONE (911abcc, b142df3)

Landed in #425 because they were defects in #425's own commit.

1. ~~**Fix the TDZ crash.**~~ Done in 911abcc. `queryVec` hoisted above the backend branch; verified
   statically (`tsc` no longer reports TS2448, and declaration now precedes assignment precedes
   read). **Not executed** — the neural arm needs a database this container did not have. `scripts/eval/eval-retrieval.ts`: hoist
   `let queryVec: number[] | null = null;` above the `if (BACKEND === "tfidf")` at :870 and delete
   the declaration at :912. Without this, every `--backend openrouter` run throws
   `ReferenceError` on the first query, and with only the hoist the residual-attribution block
   (917-956) is dead — so verify the block actually executes, don't just make it compile.
2. ~~**Put `scripts/eval/` under a tsconfig**~~ Done in 911abcc — `scripts/eval` and
   `scripts/assess` joined `tsconfig.server.json`'s include (a separate project resolved a different
   module graph). Surfaced 14 errors in 7 files, two behavioural: `eval-bakeoff`'s catch-path `refs`
   literal missing `usesBeforeBlock` (NaN sums on a thrown run), and `eval-refute-screen-report`
   calling `needsGemma` with one argument against a two-argument signature. Original note: so `tsc` sees it. Extend `tsconfig.test.json`'s
   `include` (or add a `tsconfig.scripts.json` referenced from the root) and confirm
   `pnpm exec tsc -b` reports TS2448 on the unfixed file before fixing it. This bug class is
   invisible to CI today.
3. ~~**Commit the measurement rig.**~~ Done in b142df3, ahead of schedule: the scratchpad was about
   to be discarded with the container. `pnpm eval:leaf-attribution` now reproduces the arm table,
   seeding vectors from `DATABASE_URL` read-only and embedding only the misses. `--dry-run` selects
   the same 98 grouped-target cases the original measured. **The scoring pass has never been run
   from the repo copy** — that is the first thing to do locally.

---

## Part 1 — write the summaries with subagents

Mirror the existing `mistakes:plan` / `mistakes:merge` fan-out exactly — it is the repo's proven
subagent-writing pipeline, including the invariants that matter here.

**New files**
- `scripts/lib/doc-summaries.mjs` — pure: digest, chunk packing, prompt body, validation, merge.
- `scripts/aux/summaries-plan.mjs` → `pnpm summaries:plan`
- `scripts/aux/summaries-merge.mjs` → `pnpm summaries:merge`
- `scripts_tests/doc-summaries.test.ts`

**Reuse, do not copy** (`scripts/lib/mistakes-sweep.mjs`):
- `docDigest(node)` (:28-40) — `sha256(title \0 type \0 contentHash)`, **`doc_no` deliberately
  excluded**. Same reasoning applies here and is load-bearing: upstream renumbers wholesale, and a
  relabel must not re-queue the corpus.
- `buildBacklinks` (:69-80) and the **one-hop** cross-reference expansion (:92-99, :126-137) — a
  summary cites its neighbours, so a changed neighbour makes a summary stale. Export these from
  `mistakes-sweep.mjs` rather than reimplementing; `UUID_LINK_RE` comes from `graph-patterns.mjs` so
  the expansion can never disagree with the `cites` edge.
- The chunk-packing rule (:145-168, `maxBytes` 40,000) and its invariant: **never split a unit**.
  Here the unit is a whole sibling set under one doc_no parent — a model asked to describe half a
  parameter block cannot see what distinguishes the members.
- `validateFinding`'s shape (:184-226): identity fields **stamped from the atlas**, never taken from
  the model.
- `mergeFindings`'s `evaluated` semantics (:259-266) and the merge driver's missing/truncated-file
  handling (`scripts/aux/mistakes-sweep.mjs:257-286`): **a chunk with no output file, or a truncated
  last JSONL line, stays queued.** A killed agent's silence must never be recorded as "described it".

**Chunk content** — per doc_no parent, packed to 40 KB:
- the ancestor breadcrumb chain (titles + types, **no doc_nos**),
- the parent's own title + body,
- every child's uuid, title, type, body,
- for each child with inbound edges, the citing document's title and the citing sentence — from
  `public/relations.json` (6,194 edges, 2,241 documents have ≥1 inbound; `e` is the edge-type field).
  This is the half that carries "known only from mention in other docs".

Whole corpus ≈ 6.2M chars of context → **~155 chunks at 40 KB**, each yielding ~75 records. Pilot is
a subset of chunks (see Part 3).

**Output**, one JSON object per line to `.cache/atlas-summaries/out/NNN.jsonl`:
```json
{ "uuid": "…", "summary": "…", "questions": ["…", "…"] }
```

**Validation in `summaries:merge`** — reject the row, keep the chunk's other rows:
- uuid resolves in `docs.json`;
- `summary` 40-400 chars, and **not** a near-copy of the body (guard: the model echoing a 124-char
  document back adds no signal — reject if normalised summary is a substring of normalised content);
- `questions` 2-3 entries, each ending `?`;
- **no doc_no anywhere** (`/\b[A-Z]\.\d/`) and no bare UUID. This is a hard rule, not style: a
  doc_no in the text means every upstream renumbering invalidates the corpus, and it contradicts
  CLAUDE.md's "never hardcode doc_nos".
- stamp `digest` (from `docDigest`) and `model` at merge time.

**Artifact**: `public/doc-summaries.json`, **committed** — precedent `public/oea-assessment.json`
(299 KB) and `public/risk-assessment.json` (3.5 MB) are both committed, for the same reason: it
cannot be derived at build time. Expect ~4-5 MB. State advances in
`.github/summaries-state.json`, versioned, with an incompatible version degrading **loudly** to a
full pass (`mistakes-sweep.mjs:23-50`).

**Model**: subagents at `model: "opus"` and `model: "sonnet"` on a shared pilot chunk set, compared
in Part 3. Record which model wrote each row so a mixed corpus is never silently compared.

---

## Part 2 — embed and score

### Arm S1 — one vector (the published recipe), no schema change

Compose the summary into the unit text in `src/server/retrieval/embed-units.ts`. Because
`unitHash` (:227-229) hashes that text, `sync-embeddings.ts`'s existing `toEmbed` diff (:324-332)
re-embeds exactly the changed units **with no new invalidation machinery**. Gate it behind
`config.embedSummaries` (a code constant like `embedGroupPolicy`, not env) so the policy is
comparable in the eval.

### Arm S2 — two vectors, two cosines, one round trip

- **Migration** `src/server/migrations/0NN_summary_embeddings.sql`:
  `summary_embedding vector(1024)` (nullable) and `summary_hash TEXT` on
  `atlas_doc_embeddings`, plus a partial HNSW whose predicate is **byte-identical** to migration
  024's (`WHERE NOT attribution_only`) — 024's comment warns that any divergence silently drops
  Postgres to a seq scan.
- **`sync-embeddings.ts`**: `summary_hash` is a third staleness dimension beside `content_hash` and
  the grouping metadata. Without it, a summary rewrite over unchanged body text produces a matching
  `content_hash` and the row never re-embeds. Summaries are read from Postgres, not disk: add
  `atlas_doc_summaries (doc_id PK, summary TEXT, questions TEXT[], digest TEXT, model TEXT)` written
  by the existing `sync.ts` pass from the committed JSON. The sync deliberately reads
  `atlas_doc_meta` rather than disk artifacts (:249-258, the 2026-09-01 ENOENT bug in a fresh worker
  container) and this must not reintroduce a disk dependency.
- **`src/server/retrieval/search.ts`** `runSemantic` (:156-159): add the second cosine to the
  existing statement. **The same query vector scores both columns** — both come from the same model,
  so this costs no extra embed and no extra round trip, exactly like `buildLeafScorer`'s three
  cosines (:347-363). Fuse the two rankings with the shared `rrfFuse`. `NULL summary_embedding` must
  degrade to text-only scoring, never drop the row.

A third sub-arm, free once the summaries exist: which text gets embedded — summary only, questions
only, or both concatenated.

---

## Part 3 — measure

**Commit the measurement rig first.** Port the scratchpad's `attrib3.ts` paired bootstrap (4,000
resamples over per-query hit vectors) into `scripts/eval/eval-bootstrap.ts` and call it from
`eval-retrieval.ts`. Today `ArmResult` (:753-767) stores only aggregates, so either the bootstrap
runs inside the arm loop or per-query hit vectors join `ArmResult`. Also make the vector cache a
gitignored `.cache/eval-vectors.json` written by the eval, so re-scoring an arm is offline —
`--reuse-db` today needs a live `DATABASE_URL` and still pays 179-358 query embeds per arm.

**New global arm flag** `--summaries none|s1|s2|s1+questions|…` in `eval-retrieval.ts` (the
Case-A pattern: flag near :398-442, field on `ArmResult`, value in the `results.push` at :985-999).

**The pilot's one real hazard — coverage bias.** The eval's 179 queries are generated at runtime
(`scripts/eval/eval-retrieval-queries.ts`), targets are UUIDs, slices are
`icd-disambiguation` 40 / `icd-param` 40 / `directory` 20 / `hub` 15 / `kv-record` 24 /
`control` 40. If only a query's *target* has a summary and its competing siblings don't, the summary
column hands the target an unearned signal and the arm looks better than it is. So:

- the pilot summarises **complete groups** — every member of any group containing a target, and
  every sibling group under the same parent;
- `summaries:plan --eval-targets` selects exactly those chunks;
- the eval **reports per-slice summary coverage** and **skips any query whose competing set is only
  partly covered**, rather than scoring it.

Note `--subset N` is a head-slice, not stratified (`eval-retrieval.ts:705`): `--subset 40` gives 40
`icd-disambiguation` queries and nothing else.

**Decision procedure**: paired bootstrap against the shipped arm, reported as a point estimate with
a 95% CI, same as yesterday's table. The header essay (:1-373) is the project's result ledger —
append this arm's numbers to it.

**Ship the winner only if the bootstrap separates it from the shipped arm.** If it doesn't, say so
and keep the summaries artifact for leaf attribution (the `demoteA` arm above) rather than shipping
a second index that buys nothing.

---

## Part 4 — docs and surfaces

- **`CLAUDE.md`**: a paragraph in the semantic-lane note — what a summary is, the no-doc_no rule and
  why, the measured arm table, and which arm shipped. Add `summaries:plan`/`summaries:merge` to the
  Commands block with the "hand-run, off the build chain, costs real spend / subagent time" framing
  the `mistakes:*` and `*:assess` entries use.
- **`docs/chat-system.md`**: chat retrieval reads the same `atlas_doc_embeddings`, so it inherits
  this for free — say so, and say what it does to the hybrid lane's numbers.
- **`patch-notes.md`**: one user-facing bullet under a `## 2026-…` heading for the day it merges.
- **Features guide**: no new capability (the meaning lane already exists), so no entry — unless the
  arm ships a visible control, which it should not.
- **CI**: follow the established split — CI detects staleness and files a ticket, a human spends the
  budget. Add a `summaries:status`-style drift line to the atlas-update warnings baseline, exiting 0
  always (`check-risk-census.mjs:22-23`).

---

## Verification

1. `pnpm exec tsc -b` and `pnpm exec tsc -p tsconfig.server.json --noEmit` clean — and confirm the
   new tsconfig coverage *does* flag the TS2448 before Part 0 fixes it.
2. `bun test` (server) and `pnpm test` (frontend) green; new tests in
   `scripts_tests/doc-summaries.test.ts` cover: digest excludes doc_no, one-hop expansion stops at
   one hop, a chunk never splits a sibling set, a missing output file leaves the chunk queued, a
   truncated JSONL line is treated as unprocessed, and every validation rejection (doc_no present,
   summary echoes body, wrong question count).
3. `pnpm summaries:plan --dry-run` prints chunk count, doc count and a sample prompt with **zero**
   model calls (the `--dry-run`-before-the-key-guard convention from `assess-oea.ts:101-104`).
4. Run the pilot chunks through subagents, `pnpm summaries:merge --dry-run`, then for real; confirm
   the state file advances only for chunks that came back.
5. Apply the migration against the local Postgres (`pnpm dev` brings it up), `pnpm sync:embeddings`,
   then confirm in `psql` that `summary_embedding` is populated for the pilot docs and NULL
   elsewhere, and that `EXPLAIN ANALYZE` on the scoring query uses `atlas_emb_hnsw_searchable`.
6. `bun scripts/eval/eval-retrieval.ts --backend openrouter --reuse-db --policies kv_records_breadcrumbs --summaries none`
   then `--summaries s1` and `s2`; compare with the committed bootstrap. Check the coverage line
   before trusting any delta.
7. End-to-end in the browser: `pnpm dev`, search a thin-document question on the meaning pill,
   confirm the row appears and that the count-line timing has not regressed (one query embed, not
   two).
8. `pnpm check:patch-notes`, `pnpm cite:check` if any report prose is touched, `oxlint`, `knip`.
