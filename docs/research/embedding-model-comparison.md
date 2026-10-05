# Embedding model comparison: speed and quality

Question: would a smaller or different embedding model make meaning search
faster without a noticeable loss of quality? Production embeds with
`qwen/qwen3-embedding-8b` through OpenRouter at 1,024 dimensions.

## Short answer

- Decision: production embeds with gemini-embedding-2. On the whole corpus it
  measured −1.7 [−7.3, 4.5] on questions and +1.1 [−4.5, 6.7] on keywords
  against Qwen3-8B, with its own leaf rule and cosine floor ("The switch to
  gemini-embedding-2" below).
- Model size is not what makes the search slow. Qwen3-8B answers in about
  0.6 to 0.8 seconds at the median, like the other models, but one call in ten
  takes 7 to 36 seconds. That slow tail comes from the hosts that serve it, and
  pinning any one of the three hosts does not remove it.
- No model tested beats Qwen3-8B on quality. The Gemini models come closest,
  within 4 points either way with confidence intervals that include zero, and
  they have no slow tail.
- On half the corpus, gemini-embedding-2 is −2.2 [−7.8, 3.4] on questions and
  +0.6 [−5.0, 6.1] on keywords against Qwen3-8B, at about 0.4 s median and
  0.55 s at the 90th percentile. bge-m3 is −4.5 and −1.1, and loses on sibling
  tells.
- The smaller Qwen models and OpenAI's small model lose quality the bootstrap
  can separate from noise, mostly on telling near-identical sibling documents
  apart.

## Latency

`pnpm eval:embed-latency`, 60 queries (half question-shaped,
half keyword-shaped), each call sending two texts at 1,024 dimensions as a
search does, the models taking turns query by query. Measured from a laptop in
Europe, so compare the rows with each other, not with Railway. The
gemini-embedding-001 and LFM rows are from the first run; every other row is
from the second, which added the per-host breakdown and the pinned-host arms.

| Model (host) | Median | 90th percentile | Batch of 50 units |
|---|---|---|---|
| qwen3-embedding-8b, any host (production) | 763 ms | 35,756 ms | 3,036 ms |
| qwen3-embedding-8b on DeepInfra | 1,181 ms | 7,720 ms | 1,706 ms |
| qwen3-embedding-8b on Nebius | 608 ms | 26,131 ms | 2,128 ms |
| qwen3-embedding-8b on SiliconFlow | 1,084 ms | 7,590 ms, 2 calls timed out at 60 s | 3,304 ms |
| qwen3-embedding-4b (DeepInfra) | 553 ms | 1,799 ms | 1,758 ms |
| gemini-embedding-001 (Google) | 961 ms | 1,047 ms | 2,190 ms |
| gemini-embedding-2 (Google AI Studio) | 437 ms | 576 ms | 1,200 ms |
| text-embedding-3-small (OpenAI) | 448 ms | 530 ms | 1,229 ms |
| lfm-2.5-embedding-350m:free (Liquid) | 606 ms | 1,062 ms | failed: 919 tokens over its 512 limit |

The first run gave Qwen3-8B a 90th percentile of 13.7 s. The second run sent
four Qwen3-8B arms per query, so its hosts saw four times the traffic, which
may explain part of the larger 35.8 s. The tail is large in both runs.

The deployed servers see the same tail. PostHog's `$ai_embedding` events with
`chat_surface = embed-query` from the Railway PR environments over the last 30
days (no production events yet): 33 calls, median 0.61 s, 90th percentile
6.6 s, 13 over 2 s and 7 over 5 s. Only successful calls are logged, so the
searches that hit the 10 s embed timeout (`semanticEmbedTimeoutMs`) are missing
from these numbers and the real tail is worse.

Qwen3-0.6B was run locally through Ollama for quality only; a local latency
number says nothing about a hosted one.

## Quality

`pnpm eval:retrieval --policies kv_records_breadcrumbs --briefings none,s2docs
--briefing-text both --sample-scope 0.10 --sample-agent 0.08`, both
`--query-style` values. The sample is 10% of each top-level scope and 8% of each
agent artifact (1,020 documents, chosen by UUID hash, the same for every model),
plus every document a query competes over, so all 179 queries score. Pool: 1,458
of 6,844 units. Qwen models embed queries with the instruction prefix; the
others run without it. Every model gets semantic leaf attribution from its own
member vectors.

Exact recall@10 with briefings (production's shape), difference from Qwen3-8B
with a 95% paired-bootstrap interval:

| Model | Questions | Keywords | Sibling tells, questions | Sibling tells, keywords |
|---|---|---|---|---|
| qwen3-embedding-8b | 0.810 | 0.715 | 0.800 | 0.650 |
| gemini-embedding-001 | −3.9 [−9.5, 1.7] | +0.6 [−5.0, 6.1] | −12.5 [−27.5, 2.5] | −7.5 [−22.5, 5.0] |
| gemini-embedding-2 | −3.4 [−10.1, 2.8] | −2.2 [−8.4, 3.4] | −10.0 [−27.5, 7.5] | −12.5 [−27.5, 2.5] |
| text-embedding-3-small | −5.6 [−11.2, 0.0] | −5.6 [−10.6, −0.6] | −27.5 [−42.5, −15.0] | −15.0 [−27.5, −2.5] |
| qwen3-embedding-4b | −10.1 [−15.6, −4.5] | −6.7 [−12.8, −0.6] | −27.5 [−40.0, −15.0] | −17.5 [−32.5, −5.0] |
| qwen3-embedding-0.6b (local) | −12.3 [−18.4, −6.7] | −7.3 [−12.3, −2.2] | −30.0 [−45.0, −15.0] | −12.5 [−27.5, 2.5] |

Sibling tells are the 40 `icd-disambiguation` queries: picking one instance out
of near-identical siblings, the hardest slice and the one briefings help most.

Limits of this run:

- 179 queries give intervals about 6 points wide on each side, so a 3 to 4 point
  loss for the Gemini models can be neither confirmed nor ruled out.
- The leaf-attribution rule (`fuseLeafScores`, `GROUP_ECHO_PENALTY`) was tuned on
  Qwen3-8B. With lexical attribution instead, every other hosted model scored
  higher on questions (gemini-embedding-2 0.821 against 0.777,
  gemini-embedding-001 0.810 against 0.771, text-embedding-3-small 0.777
  against 0.754), so a model swap would need that rule retuned.
- Through OpenRouter the Gemini models run without their `task_type` setting.
- The sample keeps all competing sets, so absolute numbers are higher than the
  whole-corpus ones (0.760 for Qwen3-8B on questions).
- LFM was not scored: it rejects any text over 512 tokens, and many units are
  longer; it is also only offered as a free tier.

## Half-corpus rerun: gemini-embedding-2 and bge-m3

Same eval at `--sample-scope 0.5 --sample-agent 0.5`: 4,097 of 6,844 units and
8,872 documents in the pool, all 179 queries scored. bge-m3 ran locally through
Ollama (`bge-m3`, the BAAI/bge-m3 weights converted for Ollama, 1,024
dimensions, no query prefix) for quality, and through OpenRouter
(`baai/bge-m3`) for latency.

Latency, a third run of 60 searches:

| Model | Median | 90th percentile | Hosts |
|---|---|---|---|
| qwen3-embedding-8b | 2,807 ms | 32,804 ms | Nebius median 4.8 s, DeepInfra median 1.6 s |
| gemini-embedding-2 | 403 ms | 547 ms | Google AI Studio |
| bge-m3 | 600 ms | 966 ms | DeepInfra, Parasail |

Exact recall@10, difference from Qwen3-8B with a 95% paired-bootstrap interval:

| | Qwen3-8B | gemini-embedding-2 | bge-m3 |
|---|---|---|---|
| Questions, with briefings | 0.788 | −2.2 [−7.8, 3.4] | −4.5 [−9.5, 0.6] |
| Keywords, with briefings | 0.676 | +0.6 [−5.0, 6.1] | −1.1 [−6.1, 3.9] |
| Sibling tells, questions, with briefings | 0.775 | +0.0 [−17.5, 17.5] | −15.0 [−27.5, −5.0] |
| Questions, no briefings | 0.615 | −7.3 [−14.0, −1.1] | +2.2 [−3.4, 7.8] |
| Keywords, no briefings | 0.575 | −5.0 [−10.6, 0.6] | +0.6 [−3.4, 4.5] |

With briefings, as production runs, neither model separates from Qwen3-8B
overall. gemini-embedding-2 is the closer of the two and ties it on sibling
tells; bge-m3 loses on sibling tells, the one slice the bootstrap separates.
The two behave in opposite ways without briefings: bge-m3 matches Qwen3-8B on
the documents' own text, and gemini-embedding-2 falls behind on it but gains
the most from the briefings. The same attribution caveat applies: the rule was
tuned on Qwen3-8B.

## The switch to gemini-embedding-2

**Leaf rule.** The rule that picks a member inside a retrieved group
(`fuseLeafScores`) was tuned on Qwen. Swept for Gemini on the half-corpus pool
(with briefings, exact recall@10):

| Rule | Questions | Keywords |
|---|---|---|
| Both rankings fused, echo penalty 0.25 (Qwen's rule) | 0.765 | 0.682 |
| Both, penalty 0 / 0.5 / 1.0 | 0.771 / 0.760 / 0.765 | 0.687 / 0.670 / 0.659 |
| Residual ranking alone | 0.788 | 0.704 |
| Echo ranking alone | 0.732 | 0.665 |
| Lexical fallback only | 0.804 | 0.693 |

Residual alone is +2.2 [−0.6, 5.6] and +2.2 [0.0, 5.0] over the fused rule,
and level with Qwen's fused rule (+0.0 [−6.1, 5.6] and +2.8 [−2.8, 8.4]).
Lexical-only ties it. Residual was chosen because it holds on both query
styles and keeps the semantic path; `leafRuleFor` gives it to Gemini only.
The choice was made on the same 179 queries it is reported on, from seven
variants, so differences of two or three points here are close to noise.

**Cosine floor.** `semanticMinScore` was refitted by the rule that set Qwen's
0.30: the highest value that loses no correct anchor and empties no query's
rank 10. Gemini's cosines sit higher (correct anchor p10 0.749, rank-10 min
0.582, rank-200 min 0.541), so its floor is 0.55; 0.60 empties rank 10 for 3
queries. A nonsense query ("xyz unrelated banana recipe") still tops out at
0.57, as it cleared Qwen's floor too: the floor cuts the tail, it does not
detect irrelevance.

**Vector size.** OpenRouter returns gemini-embedding-2 at exactly 1,024
dimensions when asked (3,072 otherwise), already normalized, so no migration.

**Whole corpus, through the database.** After re-embedding the local database
(11,747 units, 11,747 briefings), `--reuse-db --pool all`, against Qwen3-8B on
the same atlas commit:

| | Qwen3-8B | gemini-embedding-2 | Difference |
|---|---|---|---|
| Questions, with briefings | 0.777 | 0.760 | −1.7 [−7.3, 4.5] (14 better, 17 worse) |
| Keywords, with briefings | 0.665 | 0.676 | +1.1 [−4.5, 6.7] (15 better, 13 worse) |
| Questions, no briefings | 0.626 | 0.570 | −5.6 [−11.7, 0.6] |
| Keywords, no briefings | 0.564 | 0.575 | +1.1 [−4.5, 6.7] |

With briefings, as production runs, the two cannot be told apart. Briefings
lift Gemini more than Qwen: +19.0 points on questions against +15.1.

## What follows

Production now uses gemini-embedding-2. If Qwen is ever wanted back, setting
`EMBED_MODEL=qwen/qwen3-embedding-8b` restores its prefix, floor and leaf rule
and re-embeds the corpus. Its slow tail could then be cut without changing a
vector by sending a second identical embed request when the first has not
answered after about a second and taking whichever returns first; that is not
measured.
