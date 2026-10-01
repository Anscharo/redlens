#!/usr/bin/env bun
/**
 * Retrieval eval for embedding-unit grouping, embed models, and rerankers.
 *
 *   pnpm eval:retrieval -- --backend tfidf
 *   pnpm eval:retrieval -- --backend tfidf --policies one_to_one,icd_params,breadcrumbs,directory_direct,hub_stubs
 *   pnpm eval:retrieval -- --backend tfidf --policies icd_params --caps 26,33
 *   pnpm eval:retrieval -- --backend tfidf --hybrid --collapse
 *   pnpm eval:retrieval -- --backend openrouter --models qwen/qwen3-embedding-8b,openai/text-embedding-3-large --subset 40
 *   pnpm eval:retrieval -- --backend openrouter --reuse-db --models qwen/qwen3-embedding-8b --policies one_to_one,breadcrumbs --subset 40
 *     ^ reuse a prod/staging DATABASE_URL's embeddings by content_hash (read-only); only cache-miss units are embedded
 *   pnpm eval:retrieval -- --rerank bm25
 *   pnpm eval:retrieval -- --reuse-db --rerank jev --rerank-pool 30            (Jev noul per (query, leaf) pair)
 *   pnpm eval:retrieval -- --reuse-db --rerank qwen3 --rerank-pool 30 --hybrid  (Qwen3-Reranker-4B via local Ollama, see eval-rerankers.ts)
 *   pnpm eval:retrieval -- --prefix "Instruct: Given a web search query, retrieve relevant passages that answer the query\\nQuery: "
 *   pnpm eval:retrieval -- --no-prefix     (bare queries; the default arm embeds with config.embedQueryPrefix)
 *   pnpm eval:retrieval -- --backend tfidf --briefings none,s1,s2,s2docs --briefing-text briefing,questions,both --briefing-file .cache/atlas-briefings/pilot-sonnet.json
 *     ^ LLM-written per-document briefings (pnpm briefings:*). One arm per --briefings value, each run once per
 *       --briefing-text value (`none` runs once). s1 prepends the anchor's block to its unit text (one vector); s2 adds a
 *       second ranking over the blocks alone and fuses by RRF; s2docs ranks every covered document by its own block and
 *       fuses that list with the attributed leaf list. Block = briefing | questions | briefing + questions.
 *       MEASURED 2026-09-30, qwen3-embedding-8b, --reuse-db, Sonnet-written pilot briefings, pool covered (684 of
 *       6,810 units; 179 queries), exact recall@10 against none (0.698), paired bootstrap:
 *         s1 both −0.6 [−4.5, 2.8]   s2 both −0.6 [−2.8, 1.7]   s2docs both +12.3 [7.8, 17.3] (22 queries gained, 0 lost)
 *       Only s2docs separates, and it separates from s1 and s2 as well (+12.8 each). tfidf and ternlight agree.
 *       Text variants inside s2docs do not separate (briefing +10.1, questions +10.6, both +12.3). MRR is flat
 *       (0.707 → 0.702): the layout gets the leaf into the top 10, not to rank 1. Full table and slices:
 *       docs/plans/atlas-doc-briefings.md.
 *       HALF CORPUS, same day: 6,081 of 11,584 documents briefed, 3,049 of 6,810 units in the pool, baseline exact
 *       0.665: s1 both −0.6 [−3.9, 2.8]   s2 both +2.8 [−0.6, 6.1]   s2docs both +10.6 [5.6, 15.6] (20 gained, 1 lost).
 *       The gain held as the pool grew 4.5 times. Questions carry it (questions +10.6, briefing +8.4).
 *       KEYWORD-SHAPED queries (--query-style keywords, the search log's shape), same pool: baseline exact 0.615,
 *       s2docs both +8.4 [4.5, 12.3] (15 gained, 0 lost); briefing-only and questions-only tie at +5.6, so the
 *       questions' edge above was the question-shaped queries, and the combined text is the safe choice.
 *   pnpm eval:retrieval -- --backend tfidf --briefings none,s1 --pool covered
 *     ^ --pool covered keeps only units whose anchor AND members have a briefing, for EVERY arm including `none`, and scores
 *       only queries whose whole competing set (eval-briefing-coverage.ts) is covered. It is the default whenever the
 *       briefings cover part of the atlas: a covered document would otherwise win for having an extra signal its
 *       uncovered competitor lacks. --pool all with partial coverage warns loudly. Each non-none arm is bootstrapped
 *       against the `none` arm of the same run (exact and hit, overall and per slice of >= 15 queries).
 *   pnpm eval:retrieval -- --backend openrouter --offline --briefings none,s1 --briefing-file public/doc-briefings.json
 *     ^ every embed goes through .cache/eval-vectors.bin (+ .idx.json), keyed model + sha256(text sent); --offline reads
 *       only that cache and exits 1 with a count when a vector is missing. --reuse-db also copies the DB vectors it
 *       uses into the cache, so a later --offline run needs no database. Briefing arms do not combine with --rerank;
 *       --hybrid works with s2docs only (the chat's three-way fusion: whole corpus, exact +4.5 [1.7, 7.8] on
 *       questions and +3.4 [0.6, 6.7] on keywords, 2026-10-01).
 *   pnpm eval:retrieval -- --backend ternlight --briefings none,s1,s2,s2docs --briefing-file .cache/atlas-briefings/pilot-sonnet.json
 *   pnpm eval:retrieval -- --backend ollama --models qwen3-embedding:8b --briefings none,s2docs     (--doc-prefix for models that want one)
 *     ^ LOCAL embedders, for when there is no API credit: ternlight (the 384-dim WASM model the chat facts use, 128-token
 *       window, no query prefix) or any embedding model served by a local Ollama. Every vector is embedded locally,
 *       including each member document's own, so leaf attribution runs semantically as it does in production. They
 *       measure the ARMS against each other inside one embedding space; they are not the production model, and a
 *       number from them is not a number for qwen3-embedding-8b. Vectors cache under .cache/eval-local/<backend>-<model>/.
 *       Check the embedder before trusting it: the run warns when the `none` arm finds under 30% of the lexical-control
 *       queries, which a working model cannot do. nomic-embed-text through Ollama 0.20.4 did exactly that (2026-09-30:
 *       recall@10 0.039; a query that was a document's own title ranked that document 241st of 308), batched or single,
 *       with or without its task prefixes — so --models is required for ollama rather than defaulting to it.
 *
 * Default backend is OpenRouter when OPENROUTER_API_KEY is set, else TF-IDF
 * (offline proxy for grouping architecture — not a substitute for the neural
 * bakeoff). Writes .cache/eval-retrieval.json.
 *
 * ══ RERANKERS (2026-09-29) — one Jev CHOICE over the whole list wins; pairwise scoring loses ══
 * --reuse-db, generic prefix, --rerank-pool 30: the reranker reorders the final
 * 30-leaf list the shipped path returns and the top 10 is scored. `control` is that
 * list's own top 10; the exact ceiling@30 (a relevant leaf anywhere in the 30) is
 * 0.659 semantic-only / 0.709 hybrid. Jev = one Noul or Score per (query, leaf) pair
 * against path + title + 1,200-char body, 12 concurrent; Qwen3-Reranker-4B Q8 via
 * local Ollama, P(yes) from next-token logprobs, sequential.
 *
 *   semantic-only          recall  exact  disambig   mrr   per query    cost/arm
 *   control (no rerank)     0.816  0.648    0.625   0.629
 *   jev noul (strict)       0.782  0.615    0.550   0.451   1.0 s        $0.12
 *   jev noul (neutral)      0.810  0.609    0.550   0.543   1.4 s        $0.12
 *   jev score (4 levels)    0.782  0.615    0.500   0.463   1.4 s        $0.13
 *   qwen3-reranker-4b       0.721  0.564    0.375   0.511   9.1 s local  $0
 *   jev CHOICE (1 call)     0.832  0.659    0.625   0.634   0.5 s        $0.05
 *   jev CHOICE, pool 60     0.883  0.682    0.625   0.656   0.5 s        $0.09   (exact ceiling@60 0.687)
 *   --hybrid
 *   control (no rerank)     0.933  0.670    0.575   0.599
 *   jev noul (strict)       0.855  0.648    0.525   0.495
 *   jev noul (neutral)      0.944  0.637    0.400   0.787
 *   jev score (4 levels)    0.916  0.642    0.400   0.587
 *   qwen3-reranker-4b       0.933  0.615    0.400   0.708   8.8 s local  $0
 *   jev CHOICE (1 call)     0.944  0.698    0.625   0.815   0.5 s        $0.05
 *   jev CHOICE, pool 60     0.955  0.721    0.650   0.802   0.5 s        $0.08   (exact ceiling@60 0.721; list avg 55 — see below)
 *
 * The shape that works is COMPARATIVE: one request per query, every candidate in
 * the state, a Choice whose options are the candidates, ranked by the option
 * probabilities (rerankJevChoice). Every pairwise arm — a Noul or Score per
 * (query, candidate) that never sees the other candidates — lost exact and
 * disambiguation. The Choice arm reaches the exact ceiling of its list in three of
 * four runs (semantic 0.659 = ceiling@30; hybrid 0.721 = ceiling@60), 30-60x fewer
 * requests, 0.5 s p50 per query (p95 0.7 s), ~$0.0003-0.0005 a query.
 *
 * Read the two lanes apart. HYBRID (chat) moves a lot: exact_mrr — mrr counted only
 * on exact leaves, from the JSON — 0.387 -> 0.645 at pool 30, so the rank-1
 * promotions land on the exact leaf, not an ancestor. SEMANTIC-ONLY (the reader
 * lane) at pool 30 is flat: exact +2 queries, exact_mrr 0.524 -> 0.521, and icd-param
 * / hub / directory mrr each dip a little — the list was already at its ceiling.
 * At pool 60 the reader lane moves (recall 0.816 -> 0.883, exact +6 queries,
 * exact_mrr 0.542) because the ceiling rose 0.659 -> 0.687: the reader's limit is
 * candidates that never reach the list, and the wider pool is what buys them.
 *
 * What the Choice IS: with p50 option probability 0.00 and p90 0.01-0.03 it puts
 * nearly all mass on one or two candidates; below the pick the order is retrieval
 * order. A best-answer picker on top of retrieval, not a re-sort — which is why it
 * cannot lose much and why a reader list below rank 1 looks unchanged.
 *
 * Run-to-run noise: the hybrid pool-30 Choice arm rerun end to end gave recall 0.944 /
 * exact 0.698 / disambig 0.625 / mrr 0.814 / exact_mrr 0.651 against 0.944 / 0.698 /
 * 0.625 / 0.815 / 0.645 — the deltas above are not noise.
 *
 * Hybrid "pool 60" is NOT a 60-anchor pool: poolK keeps RERANK_POOL (50) anchors
 * under --hybrid and the lexical leg adds K=10, so the fused list averaged 55 ids
 * (9,761 scores / 179 queries). The semantic-only 60 is a true 60.
 *
 * The headline for the pairwise arms: there was almost no exact gain available. Control exact 0.648 against
 * an exact ceiling of 0.659 (semantic-only) and 0.670 against 0.709 (hybrid) means
 * retrieval already puts the exact leaf in the top 10 for 94-98% of the queries where
 * it made the top 30 at all; the 29-34% of queries with no exact leaf in the 30 are a
 * RECALL problem no reranker over 30 can touch. Widening the pool (60, 100) is the
 * untested follow-up; Jev cost scales linearly with it.
 *
 * What moves: every Jev arm puts the PROSE answer first (control-slice mrr 0.70 ->
 * 0.96 hybrid) and every reranker loses ICD disambiguation (exact 0.575 -> 0.400):
 * near-identical parameter templates for different products cannot be told apart
 * from 1,200 characters of one candidate. The strict Noul's false-criteria named
 * "a parent, sibling or index of the answer", which IS the answer for the hub and
 * directory slices (hub mrr 1.0 -> 0.27); the neutral wording repairs that, and the
 * two wordings differed by more than Noul-vs-Score did. Jev scores are low-mass
 * (p50 0.13-0.27), so much of the order is the tiebreak on retrieval rank. The one
 * arm with an upside is neutral Noul + hybrid: mrr 0.599 -> 0.787 (mrr credits an
 * ancestor, so part of that is a parent promoted over the exact leaf) for exact
 * -0.033 and disambiguation -0.175. Qwen3-Reranker-4B semantic-only was below control
 * on every headline metric (directory mrr was the one slice it won, 0.850 vs 0.804).
 *
 * ══ QUERY PREFIX (2026-09-29) — generic Qwen instruction, config.embedQueryPrefix ══
 * --reuse-db on a local DB holding production's Qwen vectors, 179 queries, one policy.
 *
 *   semantic-only           recall  exact  disambig   mrr   control
 *   --no-prefix              0.771  0.575    0.450   0.547   0.725
 *   "Sky Atlas governance"   0.777  0.559    0.425   0.607   0.875
 *   generic (shipped)        0.844  0.670    0.650   0.648   0.925
 *   --hybrid
 *   --no-prefix              0.899  0.615    0.500   0.700   0.875
 *   "Sky Atlas governance"   0.922  0.592    0.375   0.634   0.975
 *   generic (shipped)        0.922  0.659    0.575   0.642   0.975
 *
 * The domain wording trades configuration slices for prose; the generic wording
 * improves every slice on recall/exact. Hybrid mrr is the one number no prefix
 * wins: icd-disambiguation mrr 0.854 -> 0.611 (n=40; its exact 0.500 -> 0.575, so
 * the right doc is in the top 10 more often but ranks first less often) and hub
 * 0.956 -> 0.813 (n=15). Chat consumes top-k tool results, not rank 1.
 *
 * ══ DECISION (2026-08-18) — kv_records_breadcrumbs, hardcoded, no env var ══
 * First comparison made on BOTH the paraphrased query set AND production's semantic
 * leaf attribution. Every earlier policy number was measured with at least one of
 * those wrong. Neural, hybrid, --reuse-db, 179 queries:
 *
 *                        recall  exact  disambig   mrr
 *   one_to_one            0.877  0.447    0.150   0.676
 *   icd_params_bc         0.899  0.620    0.475   0.702
 *   kv_records_bc         0.905  0.642    0.550   0.738   <- WINNER
 *
 *   icd-disambiguation exact   6/40  ->  19/40  ->  22/40
 *   icd-param exact            3/40  ->  17/40  ->  18/40
 *   control                    0.800 ->  0.875  ->  0.875   (no regression; better)
 *   directory / hub / kv-record  flat or better on every arm
 *
 * Monotone on every headline metric, nothing regresses, and `control` — ordinary
 * prose queries, the overfitting guard — IMPROVES. icd-param exact rising 3/40 ->
 * 18/40 is the thin-doc problem this work exists to fix: with 1:1 vectors a
 * 30-character param leaf cannot be retrieved; folded into a compact anchor it is
 * found, and attribution then recovers the leaf.
 *
 * EMBED_GROUP_POLICY is gone with this decision. Bakeoff arms live on the eval's
 * --policies flag, which is where experiments belong; a deployment env var that
 * nobody sets is a bug source, not flexibility. Adopting re-embeds ~920 anchors and
 * writes ~4,630 attribution_only rows on the next sync:embeddings.
 *
 * ══ CURRENT RESULT (2026-08-18, rewritten paraphrased query set, 179 queries) ══
 * Neural, hybrid, --reuse-db, policy=icd_params_breadcrumbs. Breadcrumb strategy has
 * NO MEASURABLE EFFECT:
 *
 *   strategy         recall  exact  disambig   mrr
 *   full              0.899  0.564    0.275   0.698
 *   nearest:2         0.899  0.564    0.275   0.704
 *   raw:distinct:3    0.899  0.570    0.300   0.698
 *
 * full and nearest:2 are IDENTICAL on recall/exact/disambig; raw:distinct:3 leads by
 * ONE query of 40. On the old query set the same comparison showed full beating
 * nearest:2 by 11 of 40 (0.825 vs 0.550) — that effect was entirely an artifact of
 * lexical leakage plus a disambiguation slice that was 36/40 one product family.
 * RETRACTED: "EMBED_CRUMB_DEPTH=2 is harmful" does not reproduce. The setting does
 * not measurably matter; unset remains the default only because it is what the code
 * does with no config.
 *
 * POLICY COMPARISON on the same rewritten set (2026-08-18, neural+hybrid):
 *
 *                        recall  exact  disambig   mrr
 *   icd_params_bc         0.899  0.564    0.275   0.697
 *   kv_records_bc         0.911  0.564    0.275   0.693
 *   kv-record slice       0.542 -> 0.625 recall,  0.333 -> 0.333 exact
 *   icd-disambiguation / icd-param / directory / hub / control:  IDENTICAL
 *
 * The earlier "trade" verdict does NOT reproduce: the -2-queries-each ICD cost is
 * gone, both slices tie exactly. kv_records_breadcrumbs is now neutral-to-slightly
 * positive — no measured downside anywhere, +2 of 24 recall on its target slice.
 * That is a weak positive, not a win: at n=24 it is two queries.
 *
 * THE INFORMATIVE PART: kv-record recall rose (+0.083) while kv-record EXACT did not
 * move at all (0.333 both). Folding gets retrieval to the right RECORD; it does not
 * convert that into landing on the right LEAF. Measured directly
 * (scripts/aux/leaf-attribution-experiment.ts): pickLeaf is ~34% accurate, which
 * matches icd-param exact (0.375) almost exactly. Retrieval reaches the right group
 * for essentially EVERY ICD query (recall 1.000) and attribution then discards ~2/3
 * of them. LEAF ATTRIBUTION, NOT GROUPING, IS THE DOMINANT BOTTLENECK.
 *
 * Attribution methods measured on the 98 queries whose target is folded
 * (scripts/aux/leaf-attribution-experiment.ts re-runs this for ~100 embeddings):
 *
 *                            overall  icd-disambig  icd-param  kv-record   cost
 *   lexical (current)          34%        30%          43%       22%      free
 *   cosine (query·leaf)        31%        33%          15%       61%      free
 *   RRF fusion of the two      20%        10%          13%       61%      free
 *   projection, query-side     35%        38%          48%        0%      free
 *   RESIDUAL query             53%        58%          50%       50%      +1 embed
 *
 * WINNER: residual — strip the anchor's own title from the query, then take cosine
 * against the members. +19 points over the current lexical scorer.
 *
 * SHIPPABLE FORM: one SHARED residual per query instead of one per grouped hit. Strip
 * the union of the top-K retrieved anchor titles (ranked by cosine to the query, i.e.
 * what the semantic leg returns) and reuse that single residual for every group:
 *
 *   top-1  40%    top-10 50%    top-50 46%
 *   top-5  45%    top-20 51%  <- peak
 *
 * 51% vs the 53% per-hit oracle, at ONE extra embed per query regardless of how many
 * groups were hit. Accuracy RISES with K up to ~20 because the top anchors are
 * similar instances whose titles jointly cover the instance-name vocabulary better
 * than any single title does; it falls again by K=50 as genuine question words start
 * being stripped. RERANK_POOL is already 50 and K is 10, so the anchors are on hand.
 *
 * Two free variants are dead ends for structural reasons, not tuning reasons:
 * query-side projection removes the anchor DIRECTION from the query vector, which
 * makes the anchor mathematically unselectable — hence kv-record 0%, where the target
 * often IS the anchor. (A member-side projection variant was also tried; it
 * degenerates to always picking the anchor, so its numbers are an artifact of the
 * experiment and are not reported.)
 *
 * They fail on OPPOSITE slices. Cosine fixes precisely the semantic misses lexical
 * cannot ("which chain …" picking "Off-chain Operational Parameters" over "Network";
 * "what asset …" picking "transferAsset Rate Limits" over "Token").
 *
 * WHY cosine collapses on icd-param — two plausible explanations were MEASURED AND
 * REJECTED before the real one was found. It is not that those leaves are thinner
 * (median member text is ~80 chars in all three slices) and not that their siblings
 * are more alike (mean pairwise sibling cosine ~0.57 in all three). The actual cause,
 * from dumping the ranked members: THE QUERY NAMES ITS INSTANCE, and that long name
 * dominates the embedding. For "which chain does Ethereum Mainnet - Fluid sUSDS
 * ERC4626 Vault run on", the top member is the anchor itself (0.851) and "Target
 * Protocol: Fluid Finance" (0.820) outranks the correct "Network: Ethereum Mainnet"
 * (0.808) — members win by echoing the instance name, not by answering the question.
 * Inside a group the instance name discriminates NOTHING; only the rest of the
 * question does. Hence the residual-query variant measured below.
 *
 * RRF fusion of lexical+cosine was also measured and is much WORSE (10-13% on the ICD
 * slices): rank fusion assumes both inputs are informative, but lexical scores here
 * are frequently all-zero or tied, so its ranking is noise given equal weight.
 *
 * Do NOT simply swap lexical for cosine — it is worse overall. Purely lexical tuning
 * is also a dead end: word-boundary matching, stopword removal and within-group IDF
 * all measured WORSE than the current code (19-24% vs 34%) in an identical harness.
 *
 * The rewritten set also proves it measures the right thing. * The rewritten set also proves it measures the right thing. Same policy, same arms:
 *   OLD set:  tfidf 0.804/0.721/0.825   vs neural 0.771/0.648/0.825  -> TF-IDF WON
 *   NEW set:  tfidf 0.866/0.480/0.175   vs neural 0.899/0.564/0.275  -> neural wins
 * A set that a bag-of-words ranker beats a 4096-dim embedding model on was measuring
 * string matching. The new one separates them, which is the whole point.
 *
 * Honest absolute baseline on paraphrased questions: instance disambiguation sits at
 * 0.275-0.300 (11-12 of 40), and kv-record at 0.542 recall / 0.333 exact. THAT is
 * where the headroom is — not in breadcrumb tuning, which is now measured flat.
 *
 * ⚠⚠ ALL RESULTS BELOW PREDATE THE 2026-08-18 QUERY-SET REWRITE AND ARE PROVISIONAL.
 * Every number recorded here was produced by a query set with two defects found on
 * 2026-08-18:
 *   1. LEXICAL LEAKAGE — queries were built as `${instance} ${field} ${value}`, so 39
 *      of 40 icd-param queries contained the answer verbatim (mean overlap ~1.00).
 *      The set largely measured string matching, which BM25 already wins.
 *   2. NO BREADTH — `slice(0, 4)` gave 36 of 40 disambiguation queries to ONE family
 *      (SparkLend x 4 tokens, 8 distinct instances total), and 39 of 40 icd-param
 *      queries to a single field name. n=40 bought far less evidence than it looked.
 *   3. The hub slice was 15 copies of one unanswerable question ("which documents
 *      exist under Primitive Hub Document" — every hub shares that title), which is
 *      why it sat at exactly 0.400 in every arm ever run.
 * The set is now paraphrased (eval-retrieval-paraphrase.ts), strided across families,
 * deduplicated, and reports per-slice lexical overlap on every run. TREAT EVERY
 * CONCLUSION BELOW AS OPEN until re-measured: the crumb-depth verdict, the raw-chain
 * verdict, the kv_records trade, and the policy winner alike.
 *
 * NEURAL result (2026-08-14, qwen/qwen3-embedding-8b, 155 queries, HYBRID
 * lex+semantic; baseline reused from a staging DB via --reuse-db). WINNER and
 * eval-backed candidate default (EMBED_GROUP_POLICY=icd_params_breadcrumbs +
 * EMBED_CRUMB_DEPTH=2); code default stays one_to_one so no deploy auto-re-embeds:
 *
 *   icd_params_breadcrumbs       recall@10 0.819  exact 0.677  disambig 0.700  mrr 0.578  — WINNER (only ~206 anchors re-embed)
 *   icd_params                   recall@10 0.813  exact 0.587  disambig 0.400  mrr 0.553  — grouping helps recall, not disambig
 *   one_to_one                   recall@10 0.742  exact 0.529  disambig 0.375  mrr 0.541  — current production
 *   breadcrumbs (depth2)         recall@10 0.652  exact 0.568  disambig 0.625            — disambig up, recall regresses
 *   icd_full_params_breadcrumbs  recall@10 0.781  exact 0.548  disambig 0.350  mrr 0.554  — full member prose+kv DILUTES the
 *                                distinctive param values (disambig/icd-param slices fall back to ~baseline); WORSE than the
 *                                kv-only fused. Lexical already indexes full prose, so keep the semantic anchor compact. Do not ship.
 *
 * ⚠ SETTLED 2026-08-18: LEAVE EMBED_CRUMB_DEPTH UNSET (full chain).
 * Seven-strategy sweep, icd_params_breadcrumbs, identical 179-query stratified set,
 * neural+hybrid, --reuse-db. Only the crumb strategy differs:
 *
 *   strategy           recall  exact  disambig   mrr    units re-embedded
 *   full               0.771   0.648   0.825    0.563        230
 *   nearest:4          0.771   0.648   0.825    0.563          5
 *   root:2+nearest:3   0.771   0.648   0.825    0.563          0   (identical text to full)
 *   nearest:3          0.771   0.648   0.825    0.562         38
 *   root:1+nearest:2   0.771   0.648   0.825    0.562         38
 *   distinct:3         0.771   0.648   0.825    0.562         31
 *   nearest:2          0.765   0.581   0.550    0.561        143   <- the ONLY loser
 *
 * WHY they tie: ICD anchors have only 2-5 non-generic ancestors (87 have 2, 105
 * have 3, 33 have 4, 5 have 5). "Keep 3+" therefore truncates almost nothing and
 * reduces to the full chain; root:2+nearest:3 re-embedded ZERO units because its
 * text was byte-identical to full. Only nearest:2 cuts deeply enough to matter, and
 * it loses 11 of 40 disambiguation queries.
 *
 * So the swept variable turned out to be HOW MUCH you truncate, not WHICH ancestors
 * you keep — the rarity-based distinct:N never got a real test here for lack of
 * ancestors to choose among. It would be exercised by a breadcrumbs-on-every-doc
 * policy: corpus-wide 3,849 docs have >=5 ancestors (max 8+), unlike ICD anchors.
 *
 * NOISE FLOOR (revised): with cross-arm vector reuse (identical text embedded once
 * per run), the six tying arms agree to 0.001-0.002 mrr. Before that fix, two runs of
 * the SAME config disagreed by 0.011 because each re-embedded the same strings and
 * the provider is not bit-deterministic. Treat sub-0.005 deltas as noise.
 *
 * kv_records_breadcrumbs run (2026-08-17, 179 queries, neural+hybrid). NOT
 * COMPARABLE to the 2026-08-14 numbers above — the query set grew 155→179 (the new
 * kv-record slice), buildEmbedText now strips markdown links so every embed text
 * changed, and the atlas advanced (c077dc3f→8cba8156). Only the within-run arm
 * comparison is valid. It also ran WITHOUT `--crumb-depth 2`, so both arms used
 * full-chain crumbs — i.e. it did not evaluate the shipping configuration:
 *
 *   kv_records_breadcrumbs  recall@10 0.765  exact 0.682  disambig 0.825  mrr 0.549
 *   icd_params_breadcrumbs  recall@10 0.754  exact 0.648  disambig 0.825  mrr 0.542
 *
 * kv dominates or ties every slice (kv-record 0.500 vs 0.417, icd-param exact 0.500
 * vs 0.400, control/hub/directory/disambig identical) — but **the slice did not test
 * the policy**: only 3 of the 24 kv-record queries target a doc whose treatment
 * DIFFERS between the arms. The rest are either scaffolding the generic pass
 * deliberately rejects, or already folded by the ICD pass, which runs in BOTH arms.
 * So +0.011 overall is unattributable at this power, and the icd-param delta is the
 * generic pass's diffuse index effect (2,323 fewer competing vectors) or noise at
 * n=40 — NOT the ICD sibling-container widening, which is common to both arms.
 * WINNER DESIGNATION UNCHANGED; adoption of kv_records_breadcrumbs is DEFERRED
 * pending a discriminating slice (stratify ~half the queries onto folded targets)
 * re-run with `--crumb-depth 2`.
 *
 * RE-RUN with the stratified slice (12/24 arm-differential) + `--crumb-depth 2`
 * (2026-08-17). This one IS interpretable, and the verdict is a TRADE, not a win:
 *
 *   icd_params_breadcrumbs  recall 0.765  exact 0.581  disambig 0.550  mrr 0.559
 *   kv_records_breadcrumbs  recall 0.760  exact 0.581  disambig 0.500  mrr 0.546
 *
 *   kv-record          0.542→0.667 recall, 0.250→0.417 exact   ← the designed win
 *   icd-disambiguation 0.950→0.900 recall, 0.550→0.500 exact
 *   icd-param          0.625→0.575 recall, 0.375→0.325 exact
 *   directory/hub/control  identical
 *
 * The generic pass buys kv-record retrieval (+3 recall / +4 exact of 24) and pays for
 * it on the ICD slices (−2 of 40 each), netting FLAT overall (recall −0.005, exact
 * tie, mrr −0.013). So: adopt only if kv-record traffic matters more than ICD
 * disambiguation; on these numbers it is not a general improvement. DO NOT ADOPT as a
 * default yet.
 *
 * Next experiment for the ICD regression: only 39 of the 696 generic units (144 docs,
 * ~6%) are anchored INSIDE an ICD subtree — mostly `Routine Protocol` and
 * `Instance-specific Operational Processes`. Excluding ICD-descendant roots from the
 * generic pass tests whether the ICD cost is caused by encroachment or is just the
 * diffuse index effect of removing 2,875 vectors. At n=40 a 2-query move is also
 * plainly within noise, so treat the ICD deltas as weak evidence either way.
 *
 * The hub slice (0.400 in both arms) did not test the "hub_stubs lost on its text
 * builder" hypothesis either: hubs have one real value among ~5 placeholder leaves,
 * so KV_MIN_VALUES=2 + the 60% value-share gate exclude them structurally (4 of 141
 * hubs fold). That hypothesis remains UNTESTED — it needs a hub-specific rule that
 * folds the lone status value, as its own arm.
 *
 * Directional TF-IDF result (2026-08-14, 155 queries, distinctive-instance
 * disambiguation; offline proxy — it ranked breadcrumbs top, which the neural
 * run above overturned, so do NOT ship on the TF-IDF proxy alone):
 *
 *   breadcrumbs           recall@10 0.858  exact 0.858  disambig 1.000  — best first-stage
 *   icd_params            recall@10 0.845  exact 0.806  disambig 0.825  — beats 1:1; control 0.800 (no regression)
 *   directory_descendants recall@10 0.819  exact 0.794  disambig 0.900  — hub slice collapses (0.067)
 *   one_to_one            recall@10 0.684  exact 0.516  disambig 0.325  — current production
 *   hub_stubs             recall@10 0.671  — no win vs 1:1
 *   directory_direct      recall@10 0.632  — hurts ICD slices
 *   icd_params cap=26/33  identical to no-cap (ICD param trees sit under p95)
 *   hybrid (lex 1:1 + units)  no lift vs ANN-only on this proxy
 *   bm25 rerank@50→10     icd_params 0.916 / disambig 1.000 — TF-IDF+BM25 artifact; do not ship
 *
 * Model bakeoff: `--backend openrouter --models … --subset 40`. Do not flip
 * EMBED_MODEL (grouping policy, not the model, is the win above).
 */
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types.ts";
import { config } from "../../src/server/config.ts";
import { embedBatch, embedQuery } from "../../src/server/retrieval/embed.ts";
import {
  buildUnits,
  unitHash,
  GROUP_POLICIES,
  rewriteSemanticHit,
  isDocNoDescendant,
  type GroupPolicy,
  type EmbedUnit,
  fuseLeafScores,
  type LeafRow,
} from "../../src/server/retrieval/embed-units.ts";
import { briefingEmbedText } from "../lib/doc-briefings.mjs";
import { generateRetrievalQueries, type RetrievalQuery } from "./eval-retrieval-queries.ts";
import { lexicalOverlap } from "./eval-retrieval-paraphrase.ts";
import { buildEmbedText, contentHash as oneToOneHash } from "../../src/server/retrieval/embed-text.ts";
import { rerank, type Reranker } from "./eval-rerankers.ts";
import { competingSets, fullyCovered } from "./eval-briefing-coverage.ts";
import { formatBootstrap, pairedBootstrap, type BootstrapResult } from "./eval-bootstrap.ts";
import { openVectorCache, type VectorCache } from "./eval-vector-cache.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));

const POLICIES = (flag("policies")[0]?.split(",") ?? ["one_to_one", "icd_params", "breadcrumbs", "directory_direct", "hub_stubs"]) as GroupPolicy[];
const CAP = flag("cap")[0] ? Number(flag("cap")[0]) : undefined;
const CAPS = (flag("caps")[0]?.split(",") ?? []).map(Number).filter((n) => Number.isFinite(n));
const BACKEND = (flag("backend")[0] ?? (config.openrouterApiKey ? "openrouter" : "tfidf")) as "tfidf" | "openrouter" | "ternlight" | "ollama";
if (!["tfidf", "openrouter", "ternlight", "ollama"].includes(BACKEND)) {
  console.error(`unknown --backend "${BACKEND}"; expected tfidf, openrouter, ternlight or ollama`);
  process.exit(1);
}
// Embedders that run on this machine. See the header: they compare arms, they do
// not stand in for the production model.
const LOCAL = BACKEND === "ternlight" || BACKEND === "ollama";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODELS =
  flag("models")[0]?.split(",") ?? (BACKEND === "ternlight" ? ["ternlight"] : BACKEND === "ollama" ? [] : [config.embedModel]);
if (MODELS.length === 0) {
  console.error("--backend ollama needs --models <name>, an embedding model that `ollama list` shows.");
  process.exit(1);
}
// Some local models want a prefix on the DOCUMENT side too (nomic: "search_document: ").
// Qwen3 and ternlight take documents raw.
const DOC_PREFIX = flag("doc-prefix")[0] ?? "";
const RERANK = (flag("rerank")[0] ?? "none") as Reranker;
// jev / qwen3 rerank the FINAL leaf list (what the shipped path returns for k = N),
// not the anchor pool bm25 works on. N is the reranker's ceiling: recall@N of the
// list is printed beside every arm.
const LEAF_RERANK = RERANK !== "none" && RERANK !== "bm25";
const RERANK_N = Number(flag("rerank-pool")[0] ?? 30);
const COLLAPSE = argv.includes("--collapse");
const HYBRID = argv.includes("--hybrid");
const REUSE_DB = argv.includes("--reuse-db");
const CRUMB_DEPTH = flag("crumb-depth")[0] ? Number(flag("crumb-depth")[0]) : undefined;
// Sweep breadcrumb selection strategies (comma-separated, see CRUMB_STRATEGIES in
// embed-units.ts). Cheap to sweep: only ~143 units' text depends on the crumb, so
// every extra strategy costs ~143 embeddings and the rest reuse cached vectors.
// No offline proxy predicts the winner — full vs nearest:2 are structurally
// identical (same duplicate count, same same-title separation) yet differ by 11 of
// 40 disambiguation queries — so this has to be run neurally.
const CRUMB_STRATS = flag("crumb-strategies")[0]?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
// Query instruction prefix. `embedQuery` applies config.embedQueryPrefix itself
// (EMBED_QUERY_PREFIX), so the flag OVERRIDES that value rather than stacking a
// second prefix on top of it. flag() drops an empty argument, so the bare-query
// arm is `--no-prefix`. PREFIX is what the run actually embedded with, for the report.
const PREFIX_FLAG = flag("prefix")[0];
if (argv.includes("--no-prefix")) config.embedQueryPrefix = "";
else if (PREFIX_FLAG !== undefined) config.embedQueryPrefix = PREFIX_FLAG;
// The configured prefix is Qwen3's instruction. ternlight is symmetric, so it is noise there.
else if (BACKEND === "ternlight") config.embedQueryPrefix = "";
const PREFIX = config.embedQueryPrefix;
const SUBSET = flag("subset")[0] ? Number(flag("subset")[0]) : undefined;
// --query-style keywords rewrites every generated query to the shape readers
// actually type. 128 of the 139 non-control queries the generator writes start
// with a question word and run 8-13 words; the search box's own log (PostHog
// `atlas_search`, 180 days to 2026-10-01) is one to three content words with
// almost no question in it — "subsidy", "USDS Facet", "freezer multisig",
// "operational facilitator authority". The rewrite drops question and function
// words and the template verbs, keeps the content words in order, and lowercases,
// so "which chain does Ethereum Mainnet - SparkLend USDS run on" becomes
// "ethereum mainnet - sparklend usds chain". Every arm sees the same rewrite.
const QUERY_STYLE = (flag("query-style")[0] ?? "natural") as "natural" | "keywords";
if (QUERY_STYLE !== "natural" && QUERY_STYLE !== "keywords") {
  console.error(`unknown --query-style "${QUERY_STYLE}"; expected natural or keywords`);
  process.exit(1);
}
const KEYWORD_STOP = new Set([
  "what", "which", "who", "whom", "whose", "how", "where", "when", "why", "does", "do", "did", "is", "are", "was",
  "were", "be", "can", "could", "should", "would", "will", "the", "a", "an", "of", "on", "in", "into", "under", "with",
  "for", "to", "from", "by", "at", "its", "it", "this", "that", "these", "those", "there", "and", "or", "much", "many",
  "quickly", "run", "keep", "track", "covered", "specify", "specifies", "put", "integrate", "integrates", "integrated",
]);
function keywordQuery(q: string): string {
  const kept = q.split(/\s+/).filter((w) => !KEYWORD_STOP.has(w.toLowerCase().replace(/[?,.]+$/, "")));
  return (kept.length ? kept : q.split(/\s+/)).join(" ").toLowerCase();
}
const K = Number(flag("k")[0] ?? 10);
const RERANK_POOL = 50;

// Briefing arms. See the header. `none` is today's behaviour; every other value is
// one arm, and each runs once per --briefing-text value.
const BRIEFING_ARM_NAMES = ["none", "s1", "s2", "s2docs"] as const;
const BRIEFING_TEXT_NAMES = ["briefing", "questions", "both"] as const;
type BriefingArmName = (typeof BRIEFING_ARM_NAMES)[number];
type BriefingText = (typeof BRIEFING_TEXT_NAMES)[number];
const listFlag = (name: string, dflt: string[]) => flag(name)[0]?.split(",").map((x) => x.trim()).filter(Boolean) ?? dflt;
const BRIEFING_ARMS = listFlag("briefings", ["none"]);
const BRIEFING_TEXTS = listFlag("briefing-text", ["both"]);
const BRIEFING_FILE = path.resolve(ROOT, flag("briefing-file")[0] ?? "public/doc-briefings.json");
const POOL_FLAG = flag("pool")[0];
const OFFLINE = argv.includes("--offline");
for (const a of BRIEFING_ARMS) {
  if (!(BRIEFING_ARM_NAMES as readonly string[]).includes(a)) {
    console.error(`unknown --briefings value "${a}"; expected ${BRIEFING_ARM_NAMES.join(", ")}`);
    process.exit(1);
  }
}
for (const t of BRIEFING_TEXTS) {
  if (!(BRIEFING_TEXT_NAMES as readonly string[]).includes(t)) {
    console.error(`unknown --briefing-text value "${t}"; expected ${BRIEFING_TEXT_NAMES.join(", ")}`);
    process.exit(1);
  }
}
if (POOL_FLAG !== undefined && POOL_FLAG !== "all" && POOL_FLAG !== "covered") {
  console.error(`unknown --pool value "${POOL_FLAG}"; expected all or covered`);
  process.exit(1);
}
const NEEDS_BRIEFINGS = BRIEFING_ARMS.some((a) => a !== "none");
// --hybrid is allowed with the per-document arm only: that is the chat's hybrid
// lane — lexical, attributed semantic and briefing lists fused in ONE RRF stage
// (search.ts `rrfMerge`) — and the reason the arm is measured here at all. The
// eval's lexical leg is TF-IDF, not MiniSearch, so the number is a proxy for
// the shape of the effect, not production's exact figure.
if (NEEDS_BRIEFINGS && (RERANK !== "none" || (HYBRID && BRIEFING_ARMS.some((a) => a !== "none" && a !== "s2docs")))) {
  console.error("briefing arms do not support --rerank; --hybrid is supported for s2docs only (the chat's three-way fusion).");
  process.exit(1);
}
if (OFFLINE && BACKEND === "tfidf") {
  console.error("--offline reads a vector cache; pass --backend openrouter, ternlight or ollama.");
  process.exit(1);
}
if (OFFLINE && REUSE_DB) {
  console.error("--offline and --reuse-db conflict: run --reuse-db once to fill the cache, then --offline.");
  process.exit(1);
}
// Matches search.ts's RESIDUAL_ANCHOR_K — the measured peak (51% at top-20).
const RESIDUAL_ANCHOR_K = 20;

// Local copy of search.ts's residualQuery (importing search.ts would drag in Bun's
// SQL and the whole server DB layer for a pure string helper).
function residualQueryText(query: string, anchorTitles: string[]): string {
  const strip = new Set<string>();
  for (const t of anchorTitles) for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) strip.add(w);
  const kept = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !strip.has(w));
  return kept.length ? kept.join(" ") : query;
}
const OUT = flag("out")[0] ?? path.join(ROOT, ".cache", "eval-retrieval.json");

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

function idfMap(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const toks of docs) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 1)) + 1);
  return idf;
}

function tfidfVec(toks: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v = new Map<string, number>();
  let n = 0;
  for (const [t, c] of tf) {
    const w = (c / toks.length) * (idf.get(t) ?? 0);
    v.set(t, w);
    n += w * w;
  }
  const norm = Math.sqrt(n) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) s += w * (large.get(t) ?? 0);
  return s;
}

function bm25Rerank(query: string, pool: { id: string; text: string; score: number }[]): { id: string; text: string; score: number }[] {
  const q = tokenize(query);
  return [...pool]
    .map((p) => {
      const toks = tokenize(p.text);
      let s = 0;
      for (const t of q) s += toks.includes(t) ? 1 : 0;
      return { ...p, score: s + p.score * 0.01 };
    })
    .sort((a, b) => b.score - a.score);
}

function metrics(ranked: string[][], queries: RetrievalQuery[], docMap: Map<string, AtlasNode>) {
  let rec = 0;
  let mrr = 0;
  let exactRec = 0;
  let exactMrr = 0;
  let disN = 0;
  let disExact = 0;
  const bySlice: Record<string, { n: number; recall: number; mrr: number; exact: number; exactMrr: number }> = {};
  const perQuery: { id: string; slice: string; hit: 0 | 1; exact: 0 | 1 }[] = [];
  const hitAt = (hits: string[], rel: Set<string>, ancestors: boolean) => {
    for (let i = 0; i < hits.length; i++) {
      const id = hits[i]!;
      if (rel.has(id)) return i;
      if (!ancestors) continue;
      const n = docMap.get(id);
      if (!n) continue;
      for (const r of rel) {
        const leaf = docMap.get(r);
        if (leaf && isDocNoDescendant(leaf.doc_no, n.doc_no)) return i;
      }
    }
    return -1;
  };
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const rel = new Set(q.relevant);
    const hits = ranked[i]!;
    const found = hitAt(hits, rel, true);
    const exact = hitAt(hits, rel, false);
    const hit = found >= 0;
    perQuery.push({ id: q.id, slice: q.slice, hit: hit ? 1 : 0, exact: exact >= 0 ? 1 : 0 });
    if (hit) rec++;
    if (hit) mrr += 1 / (found + 1);
    if (exact >= 0) {
      exactRec++;
      exactMrr += 1 / (exact + 1);
    }
    if (q.slice === "icd-disambiguation") {
      disN++;
      if (exact >= 0) disExact++;
    }
    const sl = q.slice;
    const b = bySlice[sl] ?? { n: 0, recall: 0, mrr: 0, exact: 0, exactMrr: 0 };
    b.n++;
    if (hit) b.recall++;
    if (hit) b.mrr += 1 / (found + 1);
    if (exact >= 0) {
      b.exact++;
      b.exactMrr += 1 / (exact + 1);
    }
    bySlice[sl] = b;
  }
  const n = queries.length || 1;
  const slices: Record<string, { n: number; recall_at_k: number; mrr: number; exact_recall_at_k: number; exact_mrr: number }> = {};
  for (const [sl, b] of Object.entries(bySlice)) {
    slices[sl] = {
      n: b.n,
      recall_at_k: b.recall / b.n,
      mrr: b.mrr / b.n,
      exact_recall_at_k: b.exact / b.n,
      exact_mrr: b.exactMrr / b.n,
    };
  }
  return {
    n: queries.length,
    recall_at_k: rec / n,
    mrr: mrr / n,
    exact_recall_at_k: exactRec / n,
    exact_mrr: exactMrr / n,
    disambiguation_accuracy: disN ? disExact / disN : null,
    slices,
    per_query: perQuery,
  };
}

function parseVecLiteral(s: string): number[] {
  return s.replace(/^\[|\]$/g, "").split(",").map(Number);
}

// Read-only: pull embeddings from DATABASE_URL keyed by content_hash. A unit
// whose embed TEXT is byte-identical to an already-embedded doc (same
// content_hash) reuses that vector instead of paying to re-embed it — e.g. the
// one_to_one baseline is ~fully covered by a prod/staging DB, and only the docs
// a grouping/breadcrumb policy actually rewrites are cache misses.
// NOTE: any change to buildEmbedText's definition invalidates the cache for the
// docs it actually alters — measured 2026-08-17, adding link-stripping took the
// baseline hit rate from 99.4% to 84.2% (1,730 one-time misses) against a DB
// embedded beforehand. Unchanged text still hits, so re-baseline once and it
// returns to ~99%. content_hash
// keys the text, NOT the model, so the DB must have been embedded with the SAME
// model as `--models` (mixing embedding spaces silently wrecks rankings) —
// hence --reuse-db is single-model and never writes to the DB.
async function loadCachedVectors(): Promise<Map<string, number[]>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("--reuse-db requires DATABASE_URL (a read-only embedding cache)");
  const { SQL } = await import("bun");
  const sql = new SQL({ url, max: 2 });
  const out = new Map<string, number[]>();
  try {
    const rows = (await sql`SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding FROM atlas_doc_embeddings`) as {
      content_hash: string;
      embedding: string;
    }[];
    for (const r of rows) out.set(r.content_hash, parseVecLiteral(r.embedding));
  } finally {
    await sql.end();
  }
  return out;
}

// ── Vector cache layer ────────────────────────────────────────────────────────
// Every neural embed goes through .cache/eval-vectors.{bin,idx.json}, keyed
// `${model}\0${sha256 of the exact text sent}`. Lookup order: the persistent
// cache, then --reuse-db's DB rows (copied into the cache on use, so a later
// --offline run needs no database), then the network. The in-memory cache also
// does what `freshByModel` did: an unchanged text is embedded once per run.
let vecCache: VectorCache | null = null;
let cachedVectors: Map<string, number[]> | null = null;
let offlineMissing = 0;
// The document prefix is part of the key: the same model embeds the same text to a
// different vector under a different prefix.
const vecKey = (model: string, hash: string) => `${model}${DOC_PREFIX ? `\u0001${DOC_PREFIX}` : ""}\u0000${hash}`;

const normalized = (v: ArrayLike<number>): number[] => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  const norm = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / norm);
};

// Embed on this machine. `texts` arrive with whatever prefix they need already on.
async function embedLocal(texts: string[], model: string): Promise<number[][]> {
  if (BACKEND === "ternlight") {
    const tl = await import("@ternlight/base");
    return texts.map((t) => normalized(tl.embed(t)));
  }
  const res = await fetch(`${OLLAMA_HOST}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: texts, truncate: true }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)} — is \`ollama serve\` running and \`${model}\` pulled?`);
  const json = (await res.json()) as { embeddings: number[][] };
  return json.embeddings.map(normalized);
}

function lookupVector(model: string, hash: string): number[] | undefined {
  const key = vecKey(model, hash);
  const hit = vecCache?.get(key);
  if (hit) return hit;
  const db = cachedVectors?.get(hash);
  if (db) {
    vecCache?.set(key, db);
    return db;
  }
  return undefined;
}

async function withModel<T>(model: string, fn: () => Promise<T>): Promise<T> {
  const prev = config.embedModel;
  config.embedModel = model;
  try {
    return await fn();
  } finally {
    config.embedModel = prev;
  }
}

// hash → text in, hash → vector out. Documents carry NO query prefix. Progress logs
// every batch since a big miss set is otherwise silent for minutes.
async function resolveVectors(entries: Map<string, string>, model: string, what: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const miss: [string, string][] = [];
  for (const [hash, text] of entries) {
    const v = lookupVector(model, hash);
    if (v) out.set(hash, v);
    else miss.push([hash, text]);
  }
  if (OFFLINE) {
    offlineMissing += miss.length;
  } else {
    for (let i = 0; i < miss.length; i += 50) {
      const slice = miss.slice(i, i + 50);
      const vecs = LOCAL
        ? await embedLocal(slice.map(([, text]) => DOC_PREFIX + text), model)
        : await withModel(model, () => embedBatch(slice.map(([, text]) => text)));
      slice.forEach(([hash], j) => {
        out.set(hash, vecs[j]!);
        vecCache?.set(vecKey(model, hash), vecs[j]!);
      });
      console.log(`    embedded ${Math.min(i + 50, miss.length)}/${miss.length} distinct misses (${what})`);
    }
  }
  console.log(`  ${what}: reused ${entries.size - miss.length}/${entries.size}, ${OFFLINE ? "missing" : "embedded"} ${miss.length} with ${model}`);
  return out;
}

// One query vector, the prefix included in the cache key. null only when --offline
// and the vector is not cached (counted, and the run stops at the end of the arm).
async function getQueryVector(text: string, model: string, timings: number[]): Promise<number[] | null> {
  const hash = unitHash(config.embedQueryPrefix + text);
  const hit = lookupVector(model, hash);
  if (hit) return hit;
  if (OFFLINE) {
    offlineMissing++;
    return null;
  }
  const t0 = performance.now();
  const v = LOCAL ? (await embedLocal([config.embedQueryPrefix + text], model))[0]! : await withModel(model, () => embedQuery(text));
  timings.push(performance.now() - t0);
  vecCache?.set(vecKey(model, hash), v);
  return v;
}

// Embed many query texts in batched requests, into the cache. getQueryVector costs
// one round trip per text (2-4 s each on OpenRouter), and an arm needs up to two
// per query: the first briefing run spent 21 minutes on one arm that way. A query
// is embedded exactly as embedQuery does it — the prefix, then embedBatch — so
// these are the same vectors, 50 to a request.
async function prefetchQueryVectors(texts: string[], model: string, what: string): Promise<void> {
  if (OFFLINE) return;
  const miss = [...new Set(texts)].filter((t) => !lookupVector(model, unitHash(config.embedQueryPrefix + t)));
  for (let i = 0; i < miss.length; i += 50) {
    const slice = miss.slice(i, i + 50).map((t) => config.embedQueryPrefix + t);
    const vecs = LOCAL ? await embedLocal(slice, model) : await withModel(model, () => embedBatch(slice));
    slice.forEach((t, j) => vecCache?.set(vecKey(model, unitHash(t)), vecs[j]!));
  }
  if (miss.length) console.log(`  ${what}: embedded ${miss.length} in ${Math.ceil(miss.length / 50)} batched request(s)`);
}

function failIfOfflineMissing(): void {
  if (offlineMissing === 0) return;
  console.error(`--offline: ${offlineMissing} vector(s) needed by this run are not in the vector cache. Run once without --offline (with an API key, or --reuse-db) to fill it.`);
  process.exit(1);
}

const dot = (a: number[], b: number[]) => {
  let d = 0;
  for (let j = 0; j < a.length; j++) d += a[j]! * b[j]!;
  return d;
};

// A second, independent index over a list of texts (the briefing blocks): rank(query)
// returns the ids best-first. TF-IDF builds its own idf over these texts; neural
// resolves one vector per distinct text through the cache.
interface BlockIndex {
  ids: string[];
  rank(query: string, queryVec: number[] | null, k: number): string[];
}
async function buildBlockIndex(ids: string[], texts: string[], model: string, what: string): Promise<BlockIndex> {
  if (BACKEND === "tfidf") {
    const toks = texts.map(tokenize);
    const idf = idfMap(toks);
    const vecs = toks.map((t) => tfidfVec(t, idf));
    return {
      ids,
      rank(query, _qv, k) {
        const qv = tfidfVec(tokenize(query), idf);
        return ids
          .map((id, i) => ({ id, score: cosine(qv, vecs[i]!) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map((r) => r.id);
      },
    };
  }
  const byHash = new Map(texts.map((t) => [unitHash(t), t]));
  const got = await resolveVectors(byHash, model, what);
  const vecs = texts.map((t) => got.get(unitHash(t)) ?? []);
  return {
    ids,
    rank(_query, qv, k) {
      if (!qv) return [];
      return ids
        .map((id, i) => ({ id, score: vecs[i]!.length ? dot(qv, vecs[i]!) : -Infinity }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((r) => r.id);
    },
  };
}

function rankTfidf(query: string, units: EmbedUnit[], vecs: Map<string, number>[], idf: Map<string, number>, k: number): { id: string; text: string; score: number }[] {
  const qv = tfidfVec(tokenize(query), idf);
  return units
    .map((u, i) => ({ id: u.anchorId, text: u.text, score: cosine(qv, vecs[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function attributeRank(
  query: string,
  ranked: { id: string; text: string; score: number }[],
  units: EmbedUnit[],
  docMap: Map<string, AtlasNode>,
  k: number,
  lexHits: { id: string; doc_no: string }[] = [],
  // Semantic leaf scorer, mirroring what search.ts builds in production. WITHOUT it
  // this harness measured lexical attribution (~34% accurate) while production runs
  // the residual-embedding one (~51%) — so a policy comparison run here would have
  // been decided by the wrong attribution, and attribution is the larger effect.
  semantic?: (id: string) => number | undefined,
): string[] {
  const byAnchor = new Map(units.map((u) => [u.anchorId, u]));
  const lex =
    lexHits.length > 0
      ? lexHits
      : COLLAPSE
        ? ranked.map((r) => {
            const n = docMap.get(r.id);
            return { id: r.id, doc_no: n?.doc_no ?? "" };
          })
        : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    const u = byAnchor.get(r.id);
    const rw = rewriteSemanticHit(query, r.id, u?.memberIds, lex, docMap, semantic);
    if (seen.has(rw.id)) continue;
    seen.add(rw.id);
    ids.push(rw.id);
    if (ids.length >= k) break;
  }
  return ids;
}

function rrfFuse(lexIds: string[], semIds: string[], k: number, moreIds: string[] = []): string[] {
  const acc = new Map<string, number>();
  const bump = (ids: string[]) => {
    ids.forEach((id, rank) => acc.set(id, (acc.get(id) ?? 0) + 1 / (60 + rank + 1)));
  };
  bump(lexIds);
  bump(semIds);
  bump(moreIds);
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

function pctTimes(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as {
  nodes: Record<string, AtlasNode>;
};
const docs = Object.values(docsFile.nodes);
const docMap = new Map(docs.map((d) => [d.id, d]));
let queries = generateRetrievalQueries(docs);
if (QUERY_STYLE === "keywords") {
  queries = queries.map((q) => ({ ...q, query: keywordQuery(q.query) }));
  console.log(`query style: keywords — e.g. ${JSON.stringify(queries[0]!.query)} / ${JSON.stringify(queries[60]?.query ?? "")}`);
}
if (SUBSET && Number.isFinite(SUBSET)) queries = queries.slice(0, SUBSET);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// Arm-differential coverage. A slice whose targets are treated identically by both
// policies cannot measure the difference between them, however good its metrics look:
// the 2026-08-17 run scored kv-record 0.417→0.500 on 3/24 differential queries and was
// therefore uninformative. Print it up front so that failure mode is never silent.
// Lexical leakage: how much of each question is already present verbatim in its own
// answer. High means the question is a restatement of the document, so BM25 wins it
// outright and the run says nothing about semantic retrieval. Until 2026-08-18 the
// icd-param slice sat at ~1.00 (39 of 40 queries contained the answer text) and every
// conclusion drawn from it was really a conclusion about string matching. Printed per
// slice so that can never quietly return.
{
  const bySlice = new Map<string, { sum: number; n: number; ctrl: boolean }>();
  for (const q of queries) {
    const target = docMap.get(q.relevant[0] ?? "");
    if (!target) continue;
    const ov = lexicalOverlap(q.query, `${target.title} ${target.content ?? ""}`);
    const b = bySlice.get(q.slice) ?? { sum: 0, n: 0, ctrl: false };
    b.sum += ov;
    b.n++;
    b.ctrl = b.ctrl || q.lexicalControl === true;
    bySlice.set(q.slice, b);
  }
  const parts = [...bySlice.entries()].map(([sl, b]) => {
    const v = (b.sum / b.n).toFixed(2);
    return `${sl} ${v}${b.ctrl ? "*" : ""}`;
  });
  console.log(`lexical overlap by slice (* = deliberate lexical control): ${parts.join("  ")}`);
  const dupes = queries.length - new Set(queries.map((q) => q.query)).size;
  if (dupes > 0) console.log(`  ⚠ ${dupes} duplicate query strings — same question, different answers, unanswerable`);
}

const differentialQs = queries.filter((q) => q.differential !== undefined);
if (differentialQs.length) {
  const n = differentialQs.filter((q) => q.differential).length;
  console.log(
    `arm-differential coverage: ${n}/${differentialQs.length} flagged queries target docs the arms treat differently` +
      (n < differentialQs.length / 4 ? "  ⚠ too low to attribute any delta to the policy" : ""),
  );
}

if (BACKEND === "openrouter" && !OFFLINE && !config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set — use --backend tfidf, set the key, or run --offline against a filled cache.");
  process.exit(1);
}
if (BACKEND === "openrouter") vecCache = openVectorCache();
if (LOCAL) {
  // One cache per local model: their dimensions differ (ternlight 384, nomic 768)
  // and a cache file holds one dimension.
  const dir = path.join(ROOT, ".cache", "eval-local", `${BACKEND}-${MODELS.join("+").replace(/[^\w.+-]/g, "_")}`);
  fs.mkdirSync(dir, { recursive: true });
  vecCache = openVectorCache(dir);
}

// Briefings: which documents have one, and what pool the run may draw from. The
// pilot covers part of the atlas, so a briefing arm scored over everything would
// reward a document for being covered rather than for being right.
interface BriefingRow {
  briefing: string;
  questions?: string[];
}
const briefings = new Map<string, BriefingRow>();
if (NEEDS_BRIEFINGS || POOL_FLAG === "covered") {
  if (!fs.existsSync(BRIEFING_FILE)) {
    console.error(`briefing file not found: ${BRIEFING_FILE}\n  pass --briefing-file <path> (default public/doc-briefings.json), or drop the briefing arms.`);
    process.exit(1);
  }
  const file = JSON.parse(fs.readFileSync(BRIEFING_FILE, "utf8")) as { briefings?: Record<string, BriefingRow> };
  for (const [id, row] of Object.entries(file.briefings ?? {})) {
    if (docMap.has(id) && typeof row?.briefing === "string") briefings.set(id, row);
  }
}
const covered: ReadonlySet<string> = new Set(briefings.keys());
const fullCoverage = covered.size >= docs.length;
const POOL: "all" | "covered" = (POOL_FLAG as "all" | "covered" | undefined) ?? (NEEDS_BRIEFINGS && !fullCoverage ? "covered" : "all");
if (briefings.size > 0) {
  const why = POOL_FLAG
    ? "set by --pool"
    : POOL === "covered"
      ? `default: ${covered.size} of ${docs.length} documents have a briefing`
      : fullCoverage
        ? "default: every document has a briefing"
        : "default: no briefing arm requested";
  console.log(`briefings: ${covered.size}/${docs.length} documents from ${path.relative(ROOT, BRIEFING_FILE)}; pool=${POOL} (${why})`);
  if (POOL === "all" && NEEDS_BRIEFINGS && !fullCoverage) {
    console.warn(
      `  ⚠⚠ --pool all with PARTIAL briefing coverage (${covered.size}/${docs.length}): briefing arms are biased toward covered documents. A covered document gets a signal its uncovered competitor does not, so a gain here is not evidence the briefings help. Use --pool covered.`,
    );
  }
}

// "both" is the production recipe itself (sync-briefings embeds the same text),
// so the numbers measured here are the ones the stored vectors can reach.
const blockOf = (row: BriefingRow, mode: BriefingText): string =>
  mode === "briefing" ? row.briefing : mode === "questions" ? (row.questions ?? []).join("\n") : briefingEmbedText(row);

interface Arm {
  name: BriefingArmName;
  text: BriefingText | null;
  label: string;
}
const ARMS: Arm[] = BRIEFING_ARMS.flatMap((name) =>
  name === "none"
    ? [{ name, text: null, label: "none" } as Arm]
    : BRIEFING_TEXTS.map((text) => ({ name, text, label: `${name}:${text}` }) as Arm),
);

type Metrics = Omit<ReturnType<typeof metrics>, "per_query">;
interface ArmResult {
  policy: string;
  model: string;
  backend: string;
  rerank: string;
  collapse: boolean;
  hybrid: boolean;
  prefix: boolean;
  cap: number | null;
  crumb_depth: number | null;
  crumb_strategy: string | null;
  units: number;
  /** Arm name: none | s1 | s2 | s2docs. */
  briefings: BriefingArmName;
  /** Which text the block holds; null for `none`. */
  briefing_text: BriefingText | null;
  /** all | covered: the candidate pool and scored queries this arm ran over. */
  pool: "all" | "covered";
  query_embed_ms: { p50: number | null; p95: number | null };
  metrics: Metrics;
  /** Per scored query: id, slice, top-K hit (ancestors count), exact leaf hit. */
  per_query: ReturnType<typeof metrics>["per_query"];
  /** Leaf-rerank arms only: the paired control, ceiling, cost and latency. */
  rerank_detail?: unknown;
}

const results: ArmResult[] = [];
const capList = CAPS.length > 0 ? CAPS : [CAP !== undefined && !Number.isNaN(CAP) ? CAP : null];

if (REUSE_DB) {
  if (BACKEND !== "openrouter") {
    console.error("--reuse-db reuses neural vectors; pass --backend openrouter.");
    process.exit(1);
  }
  if (MODELS.length !== 1) {
    console.error("--reuse-db is single-model (the DB was embedded with one model); pass exactly one --models value matching it.");
    process.exit(1);
  }
  console.log(`loading cached embeddings from DATABASE_URL (read-only) — must be embedded with ${MODELS[0]}…`);
  cachedVectors = await loadCachedVectors();
  console.log(`  cache: ${cachedVectors.size} distinct content_hashes`);
}

let lexUnits: EmbedUnit[] | null = null;
let lexIdf: Map<string, number> | null = null;
let lexVecs: Map<string, number>[] | null = null;
if (HYBRID) {
  lexUnits = buildUnits(docs, "one_to_one");
  const toks = lexUnits.map((u) => tokenize(u.text));
  lexIdf = idfMap(toks);
  lexVecs = toks.map((t) => tfidfVec(t, lexIdf!));
}

for (const policy of POLICIES) {
  if (!GROUP_POLICIES.includes(policy)) {
    console.warn(`skip unknown policy ${policy}`);
    continue;
  }
  for (const cap of capList) {
   for (const strat of CRUMB_STRATS.length ? CRUMB_STRATS : [null]) {
    const opts = {
      ...(cap != null ? { cap } : {}),
      ...(CRUMB_DEPTH ? { crumbDepth: CRUMB_DEPTH } : {}),
      ...(strat ? { crumbStrategy: strat } : {}),
    };
    const allUnits = buildUnits(docs, policy, opts);
    console.log(
      `policy=${policy} cap=${cap ?? "none"}${strat ? ` crumb=${strat}` : CRUMB_DEPTH ? ` crumbDepth=${CRUMB_DEPTH}` : ""} units=${allUnits.length} backend=${BACKEND}`,
    );

    // The pool: under `covered`, units whose anchor and every member have a briefing,
    // and queries whose whole competing set does. Applied to EVERY arm, `none` too,
    // so the arms differ only in what they are given.
    const poolUnits =
      POOL === "covered" ? allUnits.filter((u) => covered.has(u.anchorId) && u.memberIds.every((id) => covered.has(id))) : allUnits;
    const competing = POOL === "covered" ? competingSets(docs, allUnits, queries) : null;
    const scoredQueries = competing ? queries.filter((q) => fullyCovered(competing.get(q.id), covered)) : queries;
    if (briefings.size > 0) {
      const perSlice = new Map<string, { scored: number; total: number }>();
      for (const q of queries) perSlice.set(q.slice, { scored: 0, total: 0, ...perSlice.get(q.slice) });
      for (const q of queries) perSlice.get(q.slice)!.total++;
      for (const q of scoredQueries) perSlice.get(q.slice)!.scored++;
      console.log(
        `  coverage: queries scored ${scoredQueries.length}/${queries.length}  units in pool ${poolUnits.length}/${allUnits.length}  documents covered ${covered.size}/${docs.length}`,
      );
      for (const [sl, c] of perSlice) console.log(`    ${sl}: queries scored ${c.scored}/${c.total}`);
    }
    if (scoredQueries.length === 0 || poolUnits.length === 0) {
      console.log(`  no queries scored under pool=${POOL} (${poolUnits.length} units, ${scoredQueries.length} queries): the briefings do not cover any query's whole competing set. Skipping this policy.`);
      continue;
    }

    for (const model of MODELS) {
     for (const arm of ARMS) {
      const block = (id: string): string | undefined => {
        const row = briefings.get(id);
        return row && arm.text ? blockOf(row, arm.text) : undefined;
      };
      // s1: the block rides in the unit's own text, so one vector carries both.
      const units =
        arm.name === "s1"
          ? poolUnits.map((u) => {
              const b = block(u.anchorId);
              if (b === undefined) return u;
              const text = `${b}\n\n${u.text}`;
              return { ...u, text, hash: unitHash(text) };
            })
          : poolUnits;

      let tfidfVecs: Map<string, number>[] | null = null;
      let idf: Map<string, number> | null = null;
      let neural: number[][] | null = null;
      if (BACKEND === "tfidf") {
        const toks = units.map((u) => tokenize(u.text));
        idf = idfMap(toks);
        tfidfVecs = toks.map((t) => tfidfVec(t, idf!));
      } else {
        // Vectors embedded for an earlier arm are reused by later ones through the
        // persistent cache, so an unchanged unit text is embedded once however many
        // arms include it (re-embedding the same string twice also reintroduces the
        // ~0.01 mrr wobble that made two identical configs disagree across runs).
        const got = await resolveVectors(new Map(units.map((u) => [u.hash, u.text])), model, `${policy} ${arm.label} units`);
        failIfOfflineMissing();
        neural = units.map((u) => got.get(u.hash)!);
        // Leaf attribution reads each member's own one-to-one vector. With
        // --reuse-db those come from the DB; a local embedder has to make them.
        if (LOCAL) {
          const members = new Map<string, string>();
          for (const u of units) {
            if (u.memberIds.length <= 1) continue;
            for (const id of u.memberIds) {
              const n = docMap.get(id);
              if (n) members.set(oneToOneHash(n), buildEmbedText(n));
            }
          }
          await resolveVectors(members, model, `${policy} member documents`);
          failIfOfflineMissing();
        }
      }

      // s2: a second ranking over the anchors' blocks alone. s2docs: a ranking over
      // every covered document in the pool, folded members included.
      let blockIndex: BlockIndex | null = null;
      if (arm.name === "s2") {
        const ids = units.filter((u) => block(u.anchorId) !== undefined).map((u) => u.anchorId);
        blockIndex = await buildBlockIndex(ids, ids.map((id) => block(id)!), model, `${policy} ${arm.label} anchor blocks`);
      } else if (arm.name === "s2docs") {
        const ids = [...new Set(units.flatMap((u) => [u.anchorId, ...u.memberIds]))].filter((id) => block(id) !== undefined);
        blockIndex = await buildBlockIndex(ids, ids.map((id) => block(id)!), model, `${policy} ${arm.label} document blocks`);
      }
      if (blockIndex) failIfOfflineMissing();

      const ranked: string[][] = [];
      // Leaf-rerank arms only: the same N-list's top-K without reranking (the
      // control), and whether a relevant doc was in the list at all (the ceiling).
      const controlRanked: string[][] = [];
      const ceilingHits: boolean[] = [];
      const rerankMs: number[] = [];
      const rerankScores: number[] = [];
      let rerankCost = 0;
      const qEmbedMs: number[] = [];
      // Anchor index built ONCE per arm. Looking this up with units.find() inside the
      // per-query/per-pool loops was ~179 x 50 x 11,340 array scans and made the run
      // look hung.
      const unitByAnchor = new Map(units.map((u) => [u.anchorId, u]));
      // anchor → its index in `units`, which is the index into `neural`: leaf
      // attribution needs the anchor's own (grouped) vector for the group-echo term.
      const unitIndex = new Map(units.map((u, i) => [u.anchorId, i]));
      type PoolRow = { id: string; text: string; score: number };
      const poolK = RERANK === "bm25" || HYBRID ? RERANK_POOL : LEAF_RERANK ? RERANK_N : K;
      // s2 ranks the anchors twice, so its first list must be long enough to fuse.
      const rankLen = arm.name === "s2" ? RERANK_POOL : poolK;
      // The pool a query ends up with, and the residual query built from it. Both
      // are functions because they run twice: once ahead of the loop, to learn
      // every residual text so they can be embedded in batches, and once in it.
      const neuralFirst = (qv: number[]): PoolRow[] =>
        units
          .map((u, i) => ({ id: u.anchorId, text: u.text, score: dot(qv, neural![i]!) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, rankLen);
      const shapePool = (q: RetrievalQuery, first: PoolRow[], qv: number[] | null): PoolRow[] => {
        let pool = first;
        if (arm.name === "s2" && blockIndex) {
          const fused = rrfFuse(pool.map((r) => r.id), blockIndex.rank(q.query, qv, RERANK_POOL), poolK);
          pool = fused.map((id) => ({ id, text: unitByAnchor.get(id)?.text ?? "", score: 0 }));
        }
        return RERANK === "bm25" ? bm25Rerank(q.query, pool).slice(0, K) : pool.slice(0, HYBRID ? RERANK_POOL : LEAF_RERANK ? RERANK_N : K);
      };
      const hasGroup = (pool: PoolRow[]) => pool.some((r) => (unitByAnchor.get(r.id)?.memberIds.length ?? 0) > 1);
      const residualFor = (q: RetrievalQuery, pool: PoolRow[]) =>
        residualQueryText(
          q.query,
          pool
            .slice(0, RESIDUAL_ANCHOR_K)
            .map((r) => docMap.get(r.id)?.title)
            .filter((t): t is string => !!t),
        );
      const attributes = BACKEND !== "tfidf" && Boolean(cachedVectors || OFFLINE || LOCAL);
      if (BACKEND !== "tfidf" && neural) {
        await prefetchQueryVectors(scoredQueries.map((q) => q.query), model, `${arm.label} queries`);
        if (attributes) {
          const residuals: string[] = [];
          for (const q of scoredQueries) {
            const qv = lookupVector(model, unitHash(config.embedQueryPrefix + q.query));
            if (!qv) continue;
            const pool = shapePool(q, neuralFirst(qv), qv);
            if (hasGroup(pool)) residuals.push(residualFor(q, pool));
          }
          await prefetchQueryVectors(residuals, model, `${arm.label} residual queries`);
        }
      }
      for (const q of scoredQueries) {
        // Hoisted above the backend branch: the neural arm assigns it after embedding
        // the query, and the residual-attribution block below reads it. Declared after
        // that assignment instead, it was a TDZ ReferenceError on the first query of
        // every --backend openrouter run — and once merely hoisted, its `= null` ran
        // after the assignment and silently disabled residual attribution. Neither was
        // reachable by CI: the tfidf lane takes the other branch, and scripts/eval/ was
        // in no tsconfig, so `tsc` never saw the file.
        let queryVec: number[] | null = null;
        let first: PoolRow[];
        if (BACKEND === "tfidf") {
          first = rankTfidf(q.query, units, tfidfVecs!, idf!, rankLen);
        } else {
          queryVec = await getQueryVector(q.query, model, qEmbedMs); // leaf attribution scores against this too — see below
          if (!queryVec) {
            ranked.push([]); // --offline and uncached: counted, the run stops after this arm
            continue;
          }
          first = neuralFirst(queryVec);
        }
        const pool = shapePool(q, first, queryVec);

        // Semantic leaf attribution, mirroring search.ts: score members by the
        // FUSION of two rankings (cosine to a residual query, and cosine to the
        // query minus a penalty for looking like their own group anchor) via the
        // shared `fuseLeafScores` — imported, not reimplemented, so the eval and
        // production cannot drift on the rule.
        //
        // One deliberate divergence: production builds the residual from the
        // LEXICAL leg's titles, because those exist before the embed and so cost
        // no second round trip. This harness has no MiniSearch leg (its lexical
        // arm is TF-IDF, and semantic-only arms have none at all), so it strips
        // its own pool's titles instead and pays the extra embed — latency is
        // free offline. That makes the eval's attribution a slight OVER-estimate
        // of production's, constant across arms, which is what matters for
        // comparing grouping policies and models.
        let leafScorer: ((id: string) => number | undefined) | undefined;
        // Only worth an embed when something in the pool is actually a GROUP. For
        // one_to_one every unit is a single doc, so there is nothing to attribute and
        // the residual call would be 179 wasted round-trips per run.
        const poolHasGroup = hasGroup(pool);
        // Attribution reads member vectors from the DB (--reuse-db) or the cache a
        // --reuse-db run filled (--offline). A plain openrouter run has neither, so it
        // attributes lexically, as before.
        if (attributes && poolHasGroup && queryVec && neural) {
          const residual = residualFor(q, pool);
          const rv = await getQueryVector(residual, model, []);
          const rows: LeafRow[] = [];
          const seen = new Set<string>();
          for (const r of rv ? pool : []) {
            const u = unitByAnchor.get(r.id);
            if ((u?.memberIds.length ?? 0) <= 1) continue; // singletons need no attribution
            const ai = unitIndex.get(r.id);
            const av = ai === undefined ? undefined : neural[ai];
            if (!av) continue;
            for (const mid of u?.memberIds ?? []) {
              if (seen.has(mid)) continue;
              const n = docMap.get(mid);
              const v = n ? lookupVector(model, oneToOneHash(n)) : undefined;
              if (!v) continue;
              seen.add(mid);
              rows.push({
                doc_id: mid, anchor_id: r.id,
                residual_sim: dot(rv!, v), query_sim: dot(queryVec, v), group_sim: dot(av, v),
              });
            }
          }
          if (rows.length >= 2) {
            const fused = fuseLeafScores(rows);
            leafScorer = (id: string) => fused.get(id);
          }
        }

        let lexHits: { id: string; doc_no: string }[] = [];
        if (HYBRID && lexUnits && lexVecs && lexIdf) {
          const lexPool = rankTfidf(q.query, lexUnits, lexVecs, lexIdf, K);
          lexHits = lexPool.map((r) => {
            const n = docMap.get(r.id);
            return { id: r.id, doc_no: n?.doc_no ?? "" };
          });
          const n = LEAF_RERANK ? RERANK_N : K;
          const semIds = attributeRank(q.query, pool, units, docMap, n, lexHits, leafScorer);
          // s2docs under --hybrid: the three-way fusion the chat's hybrid lane runs.
          const briefIds = arm.name === "s2docs" && blockIndex ? blockIndex.rank(q.query, queryVec, RERANK_POOL) : [];
          ranked.push(rrfFuse(lexHits.map((h) => h.id), semIds, n, briefIds));
        } else {
          const n = LEAF_RERANK ? RERANK_N : K;
          const leaves = attributeRank(q.query, pool.slice(0, n), units, docMap, n, lexHits, leafScorer);
          ranked.push(
            arm.name === "s2docs" && blockIndex ? rrfFuse(leaves, blockIndex.rank(q.query, queryVec, RERANK_POOL), n) : leaves,
          );
        }
        if (LEAF_RERANK) {
          const list = ranked.pop()!;
          controlRanked.push(list.slice(0, K));
          ceilingHits.push(list.some((id) => q.relevant.includes(id)));
          const out = await rerank(RERANK, q.query, list, docMap);
          rerankMs.push(out.ms);
          rerankScores.push(...out.scores);
          rerankCost += out.cost;
          ranked.push(out.ids.slice(0, K));
        }
      }
      failIfOfflineMissing();
      vecCache?.save();

      const { per_query, ...m } = metrics(ranked, scoredQueries, docMap);
      results.push({
        policy,
        model: BACKEND === "tfidf" ? "tfidf" : model,
        backend: BACKEND,
        rerank: RERANK,
        collapse: COLLAPSE || HYBRID,
        hybrid: HYBRID,
        prefix: Boolean(PREFIX),
        cap: cap,
        crumb_depth: CRUMB_DEPTH ?? null,
        crumb_strategy: strat,
        units: units.length,
        briefings: arm.name,
        briefing_text: arm.text,
        pool: POOL,
        query_embed_ms: { p50: pctTimes(qEmbedMs, 50), p95: pctTimes(qEmbedMs, 95) },
        metrics: m,
        per_query,
      });
      // The control slice reuses each target's own wording, so any working embedder
      // finds most of it. One that does not is broken, and every delta it reports
      // is noise — say so before the numbers are read.
      const control = m.slices.control;
      if (LOCAL && arm.name === "none" && control && control.recall_at_k < 0.3) {
        console.warn(
          `  ⚠⚠ ${model} found ${(control.recall_at_k * 100).toFixed(0)}% of the lexical-control queries. The embedder is returning unusable vectors; do not read the numbers below.`,
        );
      }
      const dis = m.disambiguation_accuracy == null ? "-" : m.disambiguation_accuracy.toFixed(3);
      console.log(
        `  ${policy} cap=${cap ?? "none"} ${BACKEND === "tfidf" ? "tfidf" : model} rerank=${RERANK} hybrid=${HYBRID} recall@${K}=${m.recall_at_k.toFixed(3)} exact=${m.exact_recall_at_k.toFixed(3)} disambig=${dis} mrr=${m.mrr.toFixed(3)} briefings=${arm.label} pool=${POOL}`,
      );
      if (LEAF_RERANK) {
        const c = metrics(controlRanked, scoredQueries, docMap);
        const cdis = c.disambiguation_accuracy == null ? "-" : c.disambiguation_accuracy.toFixed(3);
        const ceiling = ceilingHits.filter(Boolean).length / ceilingHits.length;
        const sorted = [...rerankScores].sort((a, b) => a - b);
        const sp = (x: number) => sorted[Math.floor(x * (sorted.length - 1))]!.toFixed(2);
        console.log(
          `    control (same ${RERANK_N}-list, no rerank): recall@${K}=${c.recall_at_k.toFixed(3)} exact=${c.exact_recall_at_k.toFixed(3)} disambig=${cdis} mrr=${c.mrr.toFixed(3)}   exact ceiling@${RERANK_N}=${ceiling.toFixed(3)} (a relevant LEAF in the list; recall@K also credits ancestors)`,
        );
        console.log(
          `    rerank per query: p50 ${(pctTimes(rerankMs, 50) ?? 0).toFixed(0)}ms p95 ${(pctTimes(rerankMs, 95) ?? 0).toFixed(0)}ms   cost $${rerankCost.toFixed(3)}   scores p10 ${sp(0.1)} p50 ${sp(0.5)} p90 ${sp(0.9)} (n=${sorted.length})`,
        );
        for (const [sl, x] of Object.entries(c.slices)) {
          console.log(`      control ${sl}: recall=${x.recall_at_k.toFixed(3)} exact=${x.exact_recall_at_k.toFixed(3)} mrr=${x.mrr.toFixed(3)}`);
        }
        results[results.length - 1]!.rerank_detail = {
          pool: RERANK_N, ceiling_recall: ceiling, control: c, cost_usd: rerankCost,
          rerank_ms: { p50: pctTimes(rerankMs, 50), p95: pctTimes(rerankMs, 95) },
        };
      }
      for (const [sl, s] of Object.entries(m.slices)) {
        console.log(
          `    ${sl}: n=${s.n} recall=${s.recall_at_k.toFixed(3)} exact=${s.exact_recall_at_k.toFixed(3)} mrr=${s.mrr.toFixed(3)}`,
        );
      }
     }
    }
   }
  }
}

// Paired bootstrap of every briefing arm against the `none` arm of the same policy,
// cap, crumb setting and model. Both arms scored the same queries (same pool), so
// rows pair by index. Per slice only where n >= 15: below that the interval says
// nothing a reader should act on.
interface BootstrapRow extends BootstrapResult {
  arm: string;
  vs: "none";
  policy: string;
  cap: number | null;
  crumb: string | number | null;
  model: string;
  metric: "exact" | "hit";
  slice: string | null;
}
const bootstrapRows: BootstrapRow[] = [];
const SLICE_MIN = 15;
const armKey = (r: ArmResult) => `${r.policy}|${r.cap}|${r.crumb_strategy}|${r.crumb_depth}|${r.model}`;
const armLabel = (r: ArmResult) => (r.briefing_text ? `${r.briefings}:${r.briefing_text}` : r.briefings);
if (NEEDS_BRIEFINGS && !BRIEFING_ARMS.includes("none")) {
  console.log("\nno bootstrap: add `none` to --briefings to pair each briefing arm with its baseline.");
}
for (const base of results.filter((r) => r.briefings === "none")) {
  const rivals = results.filter((r) => r.briefings !== "none" && armKey(r) === armKey(base));
  if (rivals.length === 0) continue;
  console.log(
    `\npaired bootstrap vs none — policy=${base.policy} cap=${base.cap ?? "none"} crumb=${base.crumb_strategy ?? base.crumb_depth ?? "none"} model=${base.model} (pool=${base.pool}, ${base.per_query.length} queries scored)`,
  );
  if (base.per_query.length === 0) {
    console.log("  no queries scored; nothing to bootstrap.");
    continue;
  }
  for (const rival of rivals) {
    const label = armLabel(rival);
    for (const metric of ["exact", "hit"] as const) {
      const scopes: (string | null)[] = [null, ...new Set(base.per_query.map((p) => p.slice))];
      for (const slice of scopes) {
        const rows = base.per_query.flatMap((p, i) =>
          slice === null || p.slice === slice ? [{ [label]: rival.per_query[i]![metric], none: p[metric] }] : [],
        );
        if (slice !== null && rows.length < SLICE_MIN) continue;
        const r = pairedBootstrap(rows, label, "none");
        console.log(`  ${metric.padEnd(5)} ${(slice ?? "overall").padEnd(20)} n=${String(r.n).padStart(3)}  ${formatBootstrap(label, "none", r)}`);
        bootstrapRows.push({ ...r, arm: label, vs: "none", policy: base.policy, cap: base.cap, crumb: base.crumb_strategy ?? base.crumb_depth, model: base.model, metric, slice });
      }
    }
  }
}

const report = {
  generated_at: new Date().toISOString(),
  backend: BACKEND,
  k: K,
  hybrid: HYBRID,
  prefix: PREFIX || null,
  query_style: QUERY_STYLE,
  pool: POOL,
  briefing_file: briefings.size > 0 ? path.relative(ROOT, BRIEFING_FILE) : null,
  briefing_documents: covered.size,
  query_count: queries.length,
  queries: queries.map((q) => ({
    id: q.id,
    slice: q.slice,
    query: q.query,
    ...(q.differential !== undefined ? { differential: q.differential } : {}),
  })),
  results,
  bootstrap: bootstrapRows,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`wrote ${OUT}`);
