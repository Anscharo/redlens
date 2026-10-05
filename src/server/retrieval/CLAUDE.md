# Retrieval: meaning search, embeddings and briefings

This directory holds the pgvector side of search: the embedding calls, the vector queries, leaf attribution and the briefing ranking. The reader's meaning lane and chat retrieval both read it. The route that serves the reader lane is `src/server/search-semantic.ts` (budgets in `src/server/search-semantic-limit.ts`, the re-embed gate in `src/server/vectors-current.ts`). Briefings are written and stored by `src/server/sync-briefings.ts`, `src/server/briefings-passes.ts`, `src/server/briefings-store.ts` and `src/server/briefings-write.ts`. The lane pills, `?lane=`, the worker leg, spelling correction, query-syntax stripping and the held-words rule are client behaviour. They live in `src/lib/searchSemantic.ts` and `apps/web/src/workers/searchSemanticLeg.ts`, and the client notes are in `apps/web/CLAUDE.md`.

## The route: `GET /api/search/semantic`

`GET /api/search/semantic` (`src/server/search-semantic.ts`) returns ids and cosine scores only. It is open without a login, behind the two budgets below. It answers `available: false` rather than 404 on a deployment with no embedding key, or while stored vectors from another model remain.

One query costs one OpenRouter embedding call. The query and leaf attribution's residual ride in that call together (see Leaf attribution). A scoped query also pays the exact vector pass described under `in:` scope.

## `in:` scope in SQL

`in:` is a doc_no subtree. `atlas_doc_meta.doc_no` is a column the semantic query already joins. The client splits `in:` out of the embedded text, because otherwise the model scores documents against the literal string `in:A.6.1`. The server pushes it into the pgvector `WHERE`. Post-filtering a k-sized nearest-neighbour list returns whatever of it happens to land in the subtree, which for a narrow scope is usually nothing.

- **The SQL clause is deliberately permissive in one direction: it keeps anchors ABOVE the scope.** A grouped anchor is an ancestor of its members, so it carries the leaves inside it. The exact test (`inScope`, in `src/lib/searchSemantic.ts`) then runs after attribution, where the leaf is known.
- **Both sides of every comparison are `upper()`-ed**, like `inScope`. Three doc numbers in the current atlas end in a lowercase `.var1` (Scenario Variations). Comparing an upper-cased scope against a raw `m.doc_no` made `in:…​.var1` match nothing, and the lane answered empty with no reason given. The same rule holds in `briefings.ts`.
- **A scoped statement runs under `SET LOCAL enable_indexscan = off` in its own transaction** (`SCOPED_SCAN_SETTING`, in `search.ts`). An HNSW scan finds `hnsw.ef_search` (40) global neighbours and Postgres filters THOSE. So `in:A.6` with LIMIT 40 returned 3 rows through the index (measured 2026-09-29 by EXPLAIN ANALYZE). The wider the scope, the more it looked like it worked.
- The exact pass over 6,810 anchors costs 50 ms, and only scoped queries pay it.

## Embed failures

**A reported embed failure carries the PROVIDER's words, not just the stopwatch's** (`embedFailureReason` in `search.ts` and `EmbedDiag` in `embed.ts`).

- `embedBatch`'s retry backoff sleeps 1+2+4+8 = 15s. That outlives the 10s `semanticEmbedTimeoutMs`.
- So a 401/429/500 fails on the first attempt and vanishes into the backoff. The caller's `Promise.race` then settles on "embed timed out after 10000ms". For a year, the one message the UI could show was the one least likely to be true.
- The cause is recorded into a per-call `EmbedDiag` before every give-up check, so it survives the abandoned promise.
- The budgets still do not line up. Attempts 4 and 5 can never run inside a 10s timeout. Raise `SEMANTIC_EMBED_TIMEOUT_MS` or shorten the backoff if you want the full retry schedule.

## Embedding model

**The embedding model is `google/gemini-embedding-2` for every semantic caller, and three settings follow it** (`EMBED_MODEL`; `docs/research/embedding-model-comparison.md`).

- It replaced `qwen/qwen3-embedding-8b`. Qwen's hosts took 7 to 36 s for one call in ten, at every host OpenRouter routes to. That is too slow for a search box, so the pill is offered only on a model in `PILL_MODELS` (`semanticLaneShown`, in `search-semantic.ts`, read into the page at serve time).
- On the whole corpus Gemini measured −1.7 [−7.3, 4.5] on questions and +1.1 [−4.5, 6.7] on keywords against Qwen (exact 0.760 / 0.676 vs 0.777 / 0.665, with briefings), at about 0.4 s median and 0.55 s p90.
- Every stored vector records the model that made it (`embed_model`, migration 038). Changing `EMBED_MODEL` re-embeds the corpus on the next sync, resumably.
- Search queries do not filter on `embed_model`, because the partial-index predicates must match their WHERE word for word.
- **The reader lane stays off until every stored vector matches the running model** (`src/server/vectors-current.ts`). The pill is hidden and the route answers `available: false`. The check reruns once a minute and latches once true.
- Chat and MCP do not read that gate, so they search through the re-embed.

### The three settings that follow the model

- **The query prefix** (`queryPrefixFor` in `src/server/config.ts`) is Qwen's instruction for a Qwen model and nothing otherwise. Documents never get one.
- **The cosine floor** (`semanticMinScore`) is 0.55 for Gemini and 0.30 for Qwen, each fitted by the same rule.
- **The leaf rule** (`leafRuleFor`, in `leaf-scores.ts`) is the residual ranking alone for Gemini and both rankings fused for Qwen.

Each has an env override (`EMBED_QUERY_PREFIX`, `SEMANTIC_MIN_SCORE`). A model with no fitted value gets no prefix, no floor and the fused leaf rule. The preview identity check's cosine bar (`REPLACE_MAX_COSINE`) was also measured per model. See `src/server/preview/identity-body.ts`.

### The Qwen query prefix

**Queries carry an instruction prefix only for Qwen** (`config.embedQueryPrefix`, applied in `embedQuery` and nowhere else).

- Qwen3-Embedding is asymmetric and instruct-tuned. Its model card specifies `Instruct: …\nQuery: …` on the query side with documents raw. Omitting it costs a documented 1–5% of retrieval.
- The prefix is query-side only, so changing it re-embeds nothing.
- The prefix is part of the query-embed cache key, so flipping it cannot serve a vector embedded under the other setting.
- The text is Qwen's GENERIC retrieval instruction on purpose. A domain-worded one ("a question about the Sky Atlas governance documents") measured 2026-09-29 lifted prose recall but pushed icd-disambiguation recall 0.850 → 0.700. The generic wording lifted every slice (semantic-only exact 0.575 → 0.670, disambig 0.450 → 0.650; numbers in `config.ts`).
- `pnpm eval:retrieval --prefix "…"` (or `--no-prefix`) is the arm that measures it. The flag overrides `EMBED_QUERY_PREFIX` rather than stacking on it.

## Route budgets

**The route carries two budgets** (`src/server/search-semantic-limit.ts`; 0 disables either).

- A signed-in reader spends their own hourly allowance (`SEARCH_SEMANTIC_USER_PER_HOUR`, default 600, one search every 6 s for a whole hour). It never touches the shared one, in either direction. The session is read only when `config.usersEnabled`.
- Everyone else shares a GLOBAL per-minute budget (`SEARCH_SEMANTIC_RPM`, default 30 ≈ 7 readers searching at once).
- The 429 body names the `scope` that ran out. A spent shared budget shows a centred "Log in for more meaning search" heading with the sign-in buttons (`SemanticLoginPrompt`, only where logins work). A spent own allowance shows a note with the wait.
- The route is public, and every answered query spends an OpenRouter embedding call (one) plus, when scoped, the exact vector pass above.
- The shared budget is global rather than per-IP, because what is being protected is a shared external budget that address rotation would walk straight around.
- It is a token bucket rather than a fixed window, so a burst costs other readers seconds rather than the rest of the minute.
- It is in-process, so N instances allow N times this. That is the right order of magnitude for a spend cap, and it avoids putting a Postgres round-trip in front of a search meant to feel instant.
- A query too short to score, or a deployment with no key, is never charged. `wouldSpendEmbed` is the one rule both the search and the gate read.

## Leaf attribution

**Leaf attribution costs no round trip of its own** (2026-09-30).

- It needs a second query vector: the question minus the words the retrieved group already explains, since inside a group the instance name discriminates nothing. That used to be a second `embedQuery`, i.e. a second ~2.3s. An embed costs the ROUND TRIP, not the payload: two texts in one call measured the same p50 as one.
- The residual is now built from the **lexical** leg's titles (`lexicalResidual`), which `runLexical` holds in memory before the embed. It rides in the query's own call via `embedQueries`.
- `runSemantic` hands both vectors back on `SemanticResult.vecs`, and `buildLeafScorer` embeds nothing at all.

Members are scored by `fuseLeafScores`, in `src/server/retrieval/leaf-scores.ts`. That file imports no DB or network module, so the eval imports the shipped rule rather than copying it. The stage around it (the residual, the three-cosine query, the rewrite) is `src/server/retrieval/leaf-attribution.ts`.

- For Qwen, the rule is an RRF fusion of cosine-to-residual with cosine-to-query minus `GROUP_ECHO_PENALTY` × the member's similarity to its own anchor.
- Gemini takes the residual ranking alone (`leafRuleFor`). Over half the corpus it scored +2.2 on both query styles against the fusion.

The numbers below are Qwen's.

- **Do NOT "simplify" this to scoring members against the plain query vector.** Measured 2026-09-30 over 98 folded-target queries, that collapses ICD disambiguation 62.5% → 2.5%, worse than no semantic attribution at all. Subtracting a per-group constant cannot reorder that group's members.
- The fusion measures 43.9% against the old two-round-trip rule's 48.0%. That is −4.1 points, 95% CI [−14.3, +6.1] over 4,000 paired resamples, so not distinguishable. It is +14.3 [+4.1, +24.5] over the lexical fallback.
- The residual ranking alone is 39.8%, which the bootstrap DOES separate from the old rule, so the second ranking is load-bearing.
- ternlight was measured for this and is not usable: 30.6%, because 384 dims cannot separate near-identical ICD siblings even though 95.9% of member docs fit its 128-token window.

## Briefings

**Briefings add a second ranking to the meaning lane** (2026-10-01, `docs/plans/atlas-doc-briefings.md`).

A briefing is one to three sentences, written by a model for one document, saying what it is in its place in the tree and who cites it. It comes with two or three questions the document answers. Most atlas documents are one line, and what they mean sits in their placement, which the embedded text lacks. Each briefing and its questions are embedded together as one extra vector per document (`briefingEmbedText`, in `scripts/lib/doc-briefings.mjs`, shared by the worker and the eval).

### Rules

- **A briefing never holds a doc number or a UUID**, and `validateBriefing` (`scripts/lib/doc-briefings-validate.mjs`) rejects one that does. Upstream renumbers wholesale, so one doc number in the text would make the whole corpus stale on every renumbering. For the same reason the digest leaves `doc_no` out and the file is keyed by UUID.
- **The vectors live in their own table, `atlas_doc_briefings` (migration 037), not in columns on `atlas_doc_embeddings`.** Migration 024's partial HNSW index there has the predicate `WHERE NOT attribution_only`. That predicate must match the unit query's WHERE word for word, or Postgres drops to a sequential scan with no error. A briefing row is one per document and is never grouped or folded, so it gets its own index and leaves that coupling alone.
- The briefing query carries the same duty: its WHERE stays `embedding IS NOT NULL`, the predicate of `atlas_doc_briefings_hnsw`.
- **There is one fusion stage.** The measured arm is `rrfFuse([attributedLeaves, briefings])`, run once, after leaf attribution, by `fuseBriefings` in `src/server/retrieval/search.ts`. Do not fuse briefings earlier or twice.

### Measurements

- Measured on gemini-embedding-2 over the whole corpus: questions 0.570 → 0.760, keywords 0.575 → 0.676.
- Measured first (`pnpm eval:retrieval --briefings none,s2docs --briefing-text both`, qwen3-embedding-8b, exact recall@10, paired bootstrap): +12.3 [7.8, 17.3] on the pilot pool, +10.6 [5.6, 15.6] on half the corpus, and on the whole corpus +12.8 [7.8, 17.9] on questions (0.631 → 0.760) and +11.2 [6.7, 15.6] on keyword-shaped queries (0.564 → 0.676). Between 15 and 23 queries gained and 0 or 1 was lost in each run.
- Prepending the briefing to the document's own vector gained nothing.
- A second vector for each embedding unit instead of each document gained +2.8 [−0.6, 6.1], which a zero gain cannot be ruled out of.
- So production adds a second vector per document and does not enlarge the first.

### Chat's three-way fusion

The chat's hybrid lane fuses three lists in one RRF stage: lexical, attributed semantic, briefings.

- That three-way form was measured 2026-10-01 on the whole corpus (`--hybrid --briefings none,s2docs --pool all`, every document briefed): +4.5 [1.7, 7.8] on questions and +3.4 [0.6, 6.7] on keywords. The semantic lane alone gained +12.8 and +11.2. The gap is there because the lexical list already finds most of what the briefings add.
- It costs rank inside the top 10: MRR falls 0.626 → 0.582 on questions and 0.607 → 0.572 on keywords.
- The briefing hits are cut at the same `semanticMinScore` floor (`briefingHits`). Fitted on the briefing vectors by the unit rule, it comes out at 0.57 for Gemini and 0.31 for Qwen, within 0.02 of the unit floors.

### Seed, worker and pull

- The committed file is a seed, loaded when its hash changes. The database is the live record. At equal digests the database wins, so editing the file does not change a row that already matches.
- The atlas worker writes briefings for new and changed documents, at most 186 documents per cycle and so at most three model requests.
- The history numbers set that cap. Per commit the median is 8 to 9 documents, the 90th percentile is about 250 and the 99th is about 1,200. The maximum is 7,681. 21 of 172 commits are over 186. A 7,681-document restructuring clears in about two days at under $11 a day.
- The bulk pass stays with Sonnet subagents through `briefings:plan` and `briefings:merge`.
- `briefings:pull` copies the database back into the file, so a fresh environment seeds from current rows.

### Failures

- **A document whose briefing fails validation three times at the same context is left alone until its context changes.**
- The count is kept against `failed_context` and not against the row's own `context_digest`. The `context_digest` describes the stored text, so it differs from the live one for every stale row, and a count keyed on it would never accumulate.
- A reply that was cut off or is not JSON Lines is a failure of the chunk and counts against no document.

### Writing model

**The worker writes with Gemini 3.8 Flash by default. Sonnet subagents wrote the first 8,958 rows, and those stay.**

- On the same 2,331 pilot documents Gemini measured −0.6 [−5.1, 3.9] against Sonnet on questions and +4.5 [0.6, 8.4] on keywords, at about a quarter of the cost.
- Its replies fail more often (4 of 31 pilot chunks needed a retry), which the chunk-failure rule absorbs.
- `BRIEFING_MODEL=""` turns the write pass off. Seed and embed still run, so search over the committed rows works with no model configured.

## `pnpm sync:briefings`

This is the atlas worker's fourth post-sync tail (`src/server/sync-briefings.ts`, beside embeddings, history and doc versions). `dev-preflight` also runs it after the worker step. It runs three passes under an advisory lock, each writing as it goes.

- **Seed** loads `public/doc-briefings.json` when its sha256 differs from `sync_state.briefings_seed_hash`. It never writes over a row the worker wrote for a newer version of the document.
- **Write** asks `BRIEFING_MODEL` (default `google/gemini-3.8-flash`) for briefings for new and changed documents, at most `BRIEFINGS_PER_CYCLE` (186) per cycle. It is off when the model is set to an empty string, when there is no OpenRouter key, or under `ATLAS_WORKER_NO_FETCH=1`.
- **Embed** stores a vector for every row whose text changed.

A hand run is safe at any time.
