# Placement-aware document briefings as a second retrieval signal

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
briefing vectors supply exactly that. Not a promise — an arm to measure once the briefings exist.

## Status — 2026-09-30

**Part 1 is built and the pilot is written. No neural number exists yet:** OpenRouter returned
`402 Insufficient credits` on every embed, so `pnpm eval:leaf-attribution` (Part 0.3) is still not
reproduced and every arm below has only been scored on the `tfidf` backend.

- `pnpm briefings:status | plan | merge` — one driver, `scripts/aux/doc-briefings.mjs`, not the two
  files this plan named, mirroring `mistakes-sweep.mjs`. Logic in `scripts/lib/doc-briefings.mjs`,
  tests in `scripts_tests/doc-briefings.test.ts`.
- Corpus: 11,584 documents in 3,917 sibling sets → **178 chunks** (40 KB and 80 owed rows per chunk).
- Pilot (`--eval-targets`): the 179 eval queries compete over **2,332 documents** → 31 chunks.
  Sonnet and Opus each wrote all of them: **2,332 valid rows of 2,332** per model, in
  `.cache/atlas-briefings/pilot-{sonnet,opus}.json`. About 95,000 subagent tokens per chunk.
  Two Sonnet agents wrote one question per row on the first pass (131 rows rejected, as designed);
  the instructions now say so explicitly and the rerun lost nothing.
- The Sonnet rows are adopted into the committed `public/doc-briefings.json` (1.0 MB, 2,332 rows)
  and `.github/briefings-state.json`, so they survive the work directory. Nothing reads the
  artifact yet. `pnpm briefings:status` now reports 9,252 documents left. The Opus rows exist only
  in the gitignored `.cache/atlas-briefings/pilot-opus.json`.
- Eval rig: `scripts/eval/eval-bootstrap.ts` (paired bootstrap, shared with
  `eval-leaf-attribution.ts`), `eval-vector-cache.ts` (`.cache/eval-vectors.bin`, `--offline`),
  `eval-briefing-coverage.ts` (`competingSets`, imported by both the plan and the eval), and
  `--briefings none,s1,s2,s2docs --briefing-text briefing,questions,both --pool all|covered` in
  `eval-retrieval.ts`.

**Three deviations from the plan below.**

1. **Citations are derived in-process from the UUID links**, not read from `relations.json` — the
   same 2,255 `cites` edges, and the plan behaves the same on a fresh checkout. The other ~3,900
   entity-typed edges in `relations.json` are not used.
2. **The coverage guard is a restricted pool, not only a skip rule.** Under `--pool covered` every
   arm, the baseline included, retrieves only from units whose anchor and members all have a
   briefing, and scores only queries whose whole competing set is covered. Skipping partly covered
   queries alone would still leave S2 biased: a covered document appears in both fused rankings and
   an uncovered one in only one. Absolute numbers under this pool are higher than full-corpus
   numbers (684 of 6,810 units compete).
3. **A third layout, `s2docs`**: one briefing vector per DOCUMENT, folded members included, ranked
   directly and fused with the attributed leaf list. S2 as written below puts the briefing vector on
   the anchor row, so a folded leaf is still reached only through leaf attribution (43.9% accurate).
   `s2docs` lets a thin leaf be retrieved as itself. In production it is the same migration as S2
   with the partial index over all rows that hold a briefing vector, not only `NOT attribution_only`.

**tfidf proxy, 179 queries, pool covered (exact-leaf recall@10, paired bootstrap vs no briefings):**

| arm | Sonnet | Opus |
|---|---|---|
| `s1` both | +1.1 [0.0, 2.8] | +0.6 [−1.1, 2.8] |
| `s2` both | +0.6 [−1.7, 3.4] | +0.6 [−1.1, 2.8] |
| `s2docs` briefing | +9.5 [5.6, 14.5] | +8.4 [4.5, 12.8] |
| `s2docs` questions | +15.1 [10.1, 20.7] | +10.6 [6.1, 15.1] |
| `s2docs` both | +11.7 [6.7, 16.8] | +11.2 [6.7, 16.2] |

Baseline exact 0.603, icd-disambiguation 0.300 → 0.600 (Sonnet, `s2docs` questions). **This is word
matching, not the embedding model**, and the eval's queries are template-generated, so questions
written by a model may match them more closely than a reader's would. It is a reason to run the
neural arms, not a result. Sonnet is not worse than Opus on any arm here.

**ternlight (local, 384 dims), same 179 queries and pool, exact-leaf recall@10 vs no briefings.**
`--backend ternlight` embeds everything on this machine, each member document included, so the
baseline attributes leaves semantically as production does (baseline exact 0.620, control slice
0.950):

| arm | Sonnet | Opus |
|---|---|---|
| `s1` both | +0.6 [−3.4, 4.5] | −1.1 [−4.5, 2.2] |
| `s2` both | −1.1 [−2.8, 0.0] | −1.7 [−3.9, 0.0] |
| `s2docs` briefing | +10.6 [6.1, 15.1] | +6.7 [3.4, 10.6] |
| `s2docs` questions | +8.9 [5.0, 13.4] | +8.9 [5.0, 13.4] |
| `s2docs` both | +10.1 [5.6, 14.5] | +7.3 [3.4, 11.2] |

Sonnet `s2docs` briefing by slice: icd-disambiguation +27.5 [15.0, 42.5], icd-param +7.5 [0.0, 15.0],
kv-record +8.3 [0.0, 20.8], control +5.0 [0.0, 12.5], hub 0. Two proxies with nothing in common
(word matching and a small sentence embedder) agree on the shape: **only the per-document layout
moves, and both published layouts are flat.** Still not the production model. ternlight reads 128
tokens, so a grouped unit's text is cut, and `s1` there partly measures what the prepended block
pushes out of the window. A local nomic-embed-text run through Ollama 0.20.4 was discarded: it
found 0 of 40 control queries, which means the vectors were unusable, not that the arms lost.

**Production model, `qwen/qwen3-embedding-8b` (2026-09-30).** `pnpm eval:leaf-attribution` first:
it reproduces the Part 0 table exactly (lexical 29.6%, `lexResid` 39.8%, `rrfU0.25` 43.9%, `demoteA`
44.9%, `semResid` 48.0%, same bootstrap intervals), so the port is right. Then the Sonnet pilot,
`--backend openrouter --reuse-db`, 179 queries, pool covered, semantic leaf attribution on in every
arm. Baseline: recall@10 0.743, exact 0.698, icd-disambiguation 0.525, mrr 0.707.

| arm | exact | vs none, exact | vs none, any hit |
|---|---|---|---|
| `s1` briefing | 0.670 | −2.8 [−6.7, 0.6] | |
| `s1` questions | 0.709 | +1.1 [−3.4, 5.6] | |
| `s1` both | 0.693 | −0.6 [−4.5, 2.8] | |
| `s2` briefing | 0.687 | −1.1 [−3.4, 1.1] | |
| `s2` questions | 0.704 | +0.6 [−1.7, 2.8] | |
| `s2` both | 0.693 | −0.6 [−2.8, 1.7] | |
| `s2docs` briefing | 0.799 | +10.1 [5.6, 15.1] | +11.2 [6.7, 16.2] |
| `s2docs` questions | 0.804 | +10.6 [6.1, 15.6] | +15.6 [10.1, 21.2] |
| **`s2docs` both** | **0.821** | **+12.3 [7.8, 17.3]** | **+14.5 [9.5, 20.1]** |

- **Only the per-document layout separates from the baseline, and it separates from both published
  layouts too**: `s2docs` both − `s2` both = +12.8 [7.8, 18.4]; − `s1` both = +12.8 [7.3, 19.0].
  Three embedders (tfidf, ternlight, Qwen3-8b) agree on this.
- `s2docs` both gained 22 of 179 queries on exact and **lost none**.
- By slice (exact): icd-disambiguation +20.0 [7.5, 32.5], icd-param +20.0 [7.5, 32.5], kv-record
  +20.8 [8.3, 37.5], control +2.5 [0.0, 7.5], directory 0, hub 0. The gain is where the targets are
  thin leaves, which is what the briefings were written for.
- **The three text variants are not separable from each other**: both − briefing +2.2 [−0.6, 5.6],
  both − questions +1.7 [−1.7, 5.6]. `both` has the best point estimate and costs one vector, same
  as the others.
- **MRR does not move** (0.707 → 0.702). The layout brings the right document into the top 10; it
  does not bring it to rank 1. A reranker over the fused list is the separate, later question.
- Still a pilot: 684 of 6,810 units compete. The full-corpus number needs the remaining 9,252
  briefings.

**Decision (per "ship the winner only if the bootstrap separates it"): build `s2docs` with the
`both` text.** `s1` and `s2` are dropped; their arms stay in the eval so the comparison can be
rerun. Opus was not run on the production model: on both proxies it was never ahead of Sonnet.

**Half corpus, production model (2026-09-30).** 3,749 more briefings, Sonnet subagents, 62 chunks
chosen with `pnpm briefings:plan --spread=4000` (runs of 250 documents taken evenly from the whole
queue, so the pool is a fair sample: 66% in the Agent scope, its share of what remained).
`public/doc-briefings.json` now holds **6,081 of 11,584**. Same eval, `--reuse-db`, pool covered:
**3,049 of 6,810 units compete**, 4.5 times the pilot's 684, and all 179 queries are scored.
Baseline: recall@10 0.732, exact 0.665, icd-disambiguation 0.500, mrr 0.636.

| arm | exact | vs none, exact | vs none, any hit |
|---|---|---|---|
| `s1` both | 0.659 | −0.6 [−3.9, 2.8] | +1.7 [−2.2, 5.6] |
| `s2` both | 0.693 | +2.8 [−0.6, 6.1] | +5.6 [2.2, 9.5] |
| `s2docs` briefing | 0.749 | +8.4 [4.5, 12.8] | +8.4 [4.5, 12.8] |
| `s2docs` questions | 0.771 | +10.6 [6.1, 15.6] | +14.0 [8.9, 19.0] |
| **`s2docs` both** | **0.771** | **+10.6 [5.6, 15.6]** | **+12.3 [7.3, 17.3]** |

- **The gain held as the pool grew 4.5 times**: +12.3 on 684 units, +10.6 on 3,049. The baseline
  fell (0.698 → 0.665) and the winning arm fell with it (0.821 → 0.771), as a harder pool should
  make them.
- `s2docs` both gained 20 queries on exact and lost 1. It still beats both published layouts:
  − `s2` both = +7.8 [3.4, 12.8], − `s1` both = +11.2 [6.7, 16.2].
- `s2` moved for the first time: +5.6 on any-hit, interval clear of zero, and +2.8 [−0.6, 6.1] on
  exact. It is a smaller effect than `s2docs` and is contained in it (the anchor blocks are a
  subset of the document blocks).
- By slice (exact, `s2docs` both): icd-param +22.5 [10.0, 35.0], icd-disambiguation +20.0
  [7.5, 32.5], hub +6.7 [0.0, 20.0], kv-record +4.2 [−8.3, 16.7], control 0, directory 0. The
  kv-record gain of the pilot (+20.8) did not hold; the two ICD slices did.
- Text variants: both − briefing +2.2 [−1.1, 5.6] on exact but +3.9 [1.1, 6.7] on any-hit; both −
  questions 0.0 [−2.8, 2.8]. **The questions carry the gain; the briefing alone is the weakest
  variant.** `both` and `questions` are not separable, so `both` stays the choice: it keeps the
  briefing for any later use (leaf attribution, a reranker's input) at no extra vector.
- MRR is now slightly up, 0.636 → 0.652, not flat.

**Keyword-shaped queries (2026-10-01).** The generated queries are questions: 128 of the 139
non-control ones start with a question word and run 8-13 words. The search box's own log (PostHog
`atlas_search`, 180 days, ~400 distinct strings) is one to three content words — "subsidy", "USDS
Facet", "freezer multisig" — plus doc numbers, UUIDs, addresses and `in:`/`type:` syntax that never
reach the meaning lane; about six are questions. So `--query-style keywords` rewrites every query
to that shape (question words, function words and template verbs dropped, content words kept in
order, lowercased: "chain ethereum mainnet - sparklend usds") and the half-corpus run was repeated.
Baseline falls to exact 0.615, recall@10 0.682.

| arm | exact | vs none, exact | vs none, any hit |
|---|---|---|---|
| `s1` both | 0.615 | 0.0 [−3.9, 4.5] | |
| `s2` both | 0.637 | +2.2 [−1.1, 5.6] | |
| `s2docs` briefing | 0.670 | +5.6 [2.8, 8.9] | |
| `s2docs` questions | 0.670 | +5.6 [2.2, 9.5] | |
| **`s2docs` both** | **0.698** | **+8.4 [4.5, 12.3]** | **+12.3 [7.8, 17.3]** |

- **The gain survives the query shape**: +8.4 against +10.6 on question-shaped queries, 15 queries
  gained and 0 lost, and `s2docs` both still beats `s2` both by +6.1 [1.7, 11.2].
- **The questions' edge was an artefact of question-shaped queries.** Under keywords, briefing-only
  and questions-only tie exactly (0.0 [−3.9, 4.5]), where questions led by +2.2 before. The two
  texts now gain different queries (8 each, against each other) and the combined vector takes both:
  +2.8 over either alone, P=0.92. **Keep `both` in the one vector**: it is the only variant that is
  not the worse choice under one of the two query shapes.
- Slices (exact, `s2docs` both): icd-disambiguation +17.5 [7.5, 30.0], icd-param +15.0 [5.0,
  27.5], kv-record +8.3 [0.0, 20.8], hub/directory/control 0.
- Caveat: readers typed those log entries into a word-matching box before the meaning lane existed,
  so the shape may drift toward questions once it ships. The two runs bracket that.

**Next, in order:** write the remaining 5,503 briefings with Sonnet subagents (`pnpm briefings:plan
--force` replaces the pilot work directory; copy `pilot-opus.json` out first if it still matters);
rerun this eval on the full corpus (`--pool all`, which is unbiased once coverage is complete); then
the production change — a `briefing_embedding` column on every `atlas_doc_embeddings` row that has a
briefing, its own HNSW index over ALL such rows (not `WHERE NOT attribution_only`: the point is that
folded leaves are searchable), `briefing_hash` as the staleness key in `sync-embeddings.ts`,
briefings reaching the embedder through Postgres, and in `runSemantic` a second ranking by the same
query vector fused with the attributed leaf list by the shared `rrfFuse`; Part 4.

## Branch

Stacked on PR #425: branch `claude/atlas-doc-briefings` off `claude/ecstatic-shannon-aju925`, PR
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

## Part 1 — write the briefings with subagents

Mirror the existing `mistakes:plan` / `mistakes:merge` fan-out exactly — it is the repo's proven
subagent-writing pipeline, including the invariants that matter here.

**New files**
- `scripts/lib/doc-briefings.mjs` — pure: digest, chunk packing, prompt body, validation, merge.
- `scripts/aux/briefings-plan.mjs` → `pnpm briefings:plan`
- `scripts/aux/briefings-merge.mjs` → `pnpm briefings:merge`
- `scripts_tests/doc-briefings.test.ts`

**Reuse, do not copy** (`scripts/lib/mistakes-sweep.mjs`):
- `docDigest(node)` (:28-40) — `sha256(title \0 type \0 contentHash)`, **`doc_no` deliberately
  excluded**. Same reasoning applies here and is load-bearing: upstream renumbers wholesale, and a
  relabel must not re-queue the corpus.
- `buildBacklinks` (:69-80) and the **one-hop** cross-reference expansion (:92-99, :126-137) — a
  briefing cites its neighbours, so a changed neighbour makes a briefing stale. Export these from
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

**Output**, one JSON object per line to `.cache/atlas-briefings/out/NNN.jsonl`:
```json
{ "uuid": "…", "briefing": "…", "questions": ["…", "…"] }
```

**Validation in `briefings:merge`** — reject the row, keep the chunk's other rows:
- uuid resolves in `docs.json`;
- `briefing` 40-400 chars, and **not** a near-copy of the body (guard: the model echoing a 124-char
  document back adds no signal — reject if normalised briefing is a substring of normalised content);
- `questions` 2-3 entries, each ending `?`;
- **no doc_no anywhere** (`/\b[A-Z]\.\d/`) and no bare UUID. This is a hard rule, not style: a
  doc_no in the text means every upstream renumbering invalidates the corpus, and it contradicts
  CLAUDE.md's "never hardcode doc_nos".
- stamp `digest` (from `docDigest`) and `model` at merge time.

**Artifact**: `public/doc-briefings.json`, **committed** — precedent `public/oea-assessment.json`
(299 KB) and `public/risk-assessment.json` (3.5 MB) are both committed, for the same reason: it
cannot be derived at build time. Expect ~4-5 MB. State advances in
`.github/briefings-state.json`, versioned, with an incompatible version degrading **loudly** to a
full pass (`mistakes-sweep.mjs:23-50`).

**Model**: subagents at `model: "opus"` and `model: "sonnet"` on a shared pilot chunk set, compared
in Part 3. Record which model wrote each row so a mixed corpus is never silently compared.

---

## Part 2 — embed and score

### Arm S1 — one vector (the published recipe), no schema change

Compose the briefing into the unit text in `src/server/retrieval/embed-units.ts`. Because
`unitHash` (:227-229) hashes that text, `sync-embeddings.ts`'s existing `toEmbed` diff (:324-332)
re-embeds exactly the changed units **with no new invalidation machinery**. Gate it behind
`config.embedBriefings` (a code constant like `embedGroupPolicy`, not env) so the policy is
comparable in the eval.

### Arm S2 — two vectors, two cosines, one round trip

- **Migration** `src/server/migrations/0NN_briefing_embeddings.sql`:
  `briefing_embedding vector(1024)` (nullable) and `briefing_hash TEXT` on
  `atlas_doc_embeddings`, plus a partial HNSW whose predicate is **byte-identical** to migration
  024's (`WHERE NOT attribution_only`) — 024's comment warns that any divergence silently drops
  Postgres to a seq scan.
- **`sync-embeddings.ts`**: `briefing_hash` is a third staleness dimension beside `content_hash` and
  the grouping metadata. Without it, a briefing rewrite over unchanged body text produces a matching
  `content_hash` and the row never re-embeds. Briefings are read from Postgres, not disk: add
  `atlas_doc_briefings (doc_id PK, briefing TEXT, questions TEXT[], digest TEXT, model TEXT)` written
  by the existing `sync.ts` pass from the committed JSON. The sync deliberately reads
  `atlas_doc_meta` rather than disk artifacts (:249-258, the 2026-09-01 ENOENT bug in a fresh worker
  container) and this must not reintroduce a disk dependency.
- **`src/server/retrieval/search.ts`** `runSemantic` (:156-159): add the second cosine to the
  existing statement. **The same query vector scores both columns** — both come from the same model,
  so this costs no extra embed and no extra round trip, exactly like `buildLeafScorer`'s three
  cosines (:347-363). Fuse the two rankings with the shared `rrfFuse`. `NULL briefing_embedding` must
  degrade to text-only scoring, never drop the row.

A third sub-arm, free once the briefings exist: which text gets embedded — briefing only, questions
only, or both concatenated.

---

## Part 3 — measure

**Commit the measurement rig first.** Port the scratchpad's `attrib3.ts` paired bootstrap (4,000
resamples over per-query hit vectors) into `scripts/eval/eval-bootstrap.ts` and call it from
`eval-retrieval.ts`. Today `ArmResult` (:753-767) stores only aggregates, so either the bootstrap
runs inside the arm loop or per-query hit vectors join `ArmResult`. Also make the vector cache a
gitignored `.cache/eval-vectors.json` written by the eval, so re-scoring an arm is offline —
`--reuse-db` today needs a live `DATABASE_URL` and still pays 179-358 query embeds per arm.

**New global arm flag** `--briefings none|s1|s2|s1+questions|…` in `eval-retrieval.ts` (the
Case-A pattern: flag near :398-442, field on `ArmResult`, value in the `results.push` at :985-999).

**The pilot's one real hazard — coverage bias.** The eval's 179 queries are generated at runtime
(`scripts/eval/eval-retrieval-queries.ts`), targets are UUIDs, slices are
`icd-disambiguation` 40 / `icd-param` 40 / `directory` 20 / `hub` 15 / `kv-record` 24 /
`control` 40. If only a query's *target* has a briefing and its competing siblings don't, the briefing
column hands the target an unearned signal and the arm looks better than it is. So:

- the pilot briefs **complete groups** — every member of any group containing a target, and
  every sibling group under the same parent;
- `briefings:plan --eval-targets` selects exactly those chunks;
- the eval **reports per-slice briefing coverage** and **skips any query whose competing set is only
  partly covered**, rather than scoring it.

Note `--subset N` is a head-slice, not stratified (`eval-retrieval.ts:705`): `--subset 40` gives 40
`icd-disambiguation` queries and nothing else.

**Decision procedure**: paired bootstrap against the shipped arm, reported as a point estimate with
a 95% CI, same as yesterday's table. The header essay (:1-373) is the project's result ledger —
append this arm's numbers to it.

**Ship the winner only if the bootstrap separates it from the shipped arm.** If it doesn't, say so
and keep the briefings artifact for leaf attribution (the `demoteA` arm above) rather than shipping
a second index that buys nothing.

---

## Part 4 — docs and surfaces

- **`CLAUDE.md`**: a paragraph in the semantic-lane note — what a briefing is, the no-doc_no rule and
  why, the measured arm table, and which arm shipped. Add `briefings:plan`/`briefings:merge` to the
  Commands block with the "hand-run, off the build chain, costs real spend / subagent time" framing
  the `mistakes:*` and `*:assess` entries use.
- **`docs/chat-system.md`**: chat retrieval reads the same `atlas_doc_embeddings`, so it inherits
  this for free — say so, and say what it does to the hybrid lane's numbers.
- **`patch-notes.md`**: one user-facing bullet under a `## 2026-…` heading for the day it merges.
- **Features guide**: no new capability (the meaning lane already exists), so no entry — unless the
  arm ships a visible control, which it should not.
- **CI**: follow the established split — CI detects staleness and files a ticket, a human spends the
  budget. Add a `briefings:status`-style drift line to the atlas-update warnings baseline, exiting 0
  always (`check-risk-census.mjs:22-23`).

---

## Verification

1. `pnpm exec tsc -b` and `pnpm exec tsc -p tsconfig.server.json --noEmit` clean — and confirm the
   new tsconfig coverage *does* flag the TS2448 before Part 0 fixes it.
2. `bun test` (server) and `pnpm test` (frontend) green; new tests in
   `scripts_tests/doc-briefings.test.ts` cover: digest excludes doc_no, one-hop expansion stops at
   one hop, a chunk never splits a sibling set, a missing output file leaves the chunk queued, a
   truncated JSONL line is treated as unprocessed, and every validation rejection (doc_no present,
   briefing echoes body, wrong question count).
3. `pnpm briefings:plan --dry-run` prints chunk count, doc count and a sample prompt with **zero**
   model calls (the `--dry-run`-before-the-key-guard convention from `assess-oea.ts:101-104`).
4. Run the pilot chunks through subagents, `pnpm briefings:merge --dry-run`, then for real; confirm
   the state file advances only for chunks that came back.
5. Apply the migration against the local Postgres (`pnpm dev` brings it up), `pnpm sync:embeddings`,
   then confirm in `psql` that `briefing_embedding` is populated for the pilot docs and NULL
   elsewhere, and that `EXPLAIN ANALYZE` on the scoring query uses `atlas_emb_hnsw_searchable`.
6. `bun scripts/eval/eval-retrieval.ts --backend openrouter --reuse-db --policies kv_records_breadcrumbs --briefings none`
   then `--briefings s1` and `s2`; compare with the committed bootstrap. Check the coverage line
   before trusting any delta.
7. End-to-end in the browser: `pnpm dev`, search a thin-document question on the meaning pill,
   confirm the row appears and that the count-line timing has not regressed (one query embed, not
   two).
8. `pnpm check:patch-notes`, `pnpm cite:check` if any report prose is touched, `oxlint`, `knip`.
