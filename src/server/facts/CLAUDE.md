# Chat facts (auto-injected context)

A **fact** is a block of context the chat injects into a turn only when the turn calls for it. Facts are pure code: no LLM call, no network, so a miss costs microseconds and injects nothing. The registry is `registry.ts` and the contract is `types.ts`.

The registered facts are glossary definitions, role dossiers (`roles.ts`), entity rows, concept censuses (up to `MAX_CENSUSES` = 3 of 10, routed, see below) and app documentation (`features.ts`, which reads the Features guide and also fires from the `/features` page).

- A role dossier fires for a defined role the question names, tolerating aliases and plurals. It carries the role's Definitions entry, the role family's Article, every doc titled with the role, and any "The <role> for X is Y" assignment. It exists because ranked search does not reliably surface a role's own Article.
- All facts ride one synthetic tool round in the transcript, so the verifier, quote grounding and citation checks treat what they inject as ordinary turn evidence.

## Two triggering lanes

1. **Regex signatures** fire on their own.
2. **Similarity** (`similarity.ts`) scores the question against the fact's `prototypes` with an on-device embedding (ternlight, WASM, about 2 ms, no network), minus its similarity to shared atlas-question prototypes. It catches phrasings no regex anticipates ("show me around", "what should i try first?").

The similarity lane scores question shape, not subject. It is therefore **suppressed** when the question names a real glossary term, entity or doc title, or is small talk; deterministic atlas-vocabulary matching supplies the subject knowledge the embedding lacks. The suppressors do nearly all the work: they stop 166 of 184 non-product questions, the margin 6 (`pnpm eval:facts --embed`).

Facts whose match is their extraction (glossary, entities: they must know which row to inject) declare no `prototypes` and never use the per-fact similarity lane.

## Consumers of the similarity mechanism

Each consumer has its own competing class and operating point. Re-run its eval before moving its margin.

| Consumer | Scores | Competing class | Margin (default) | Operating point |
|---|---|---|---|---|
| Features fact | the question | an atlas question | `CHAT_FACT_SIMILARITY_MARGIN` (−0.05) | permissive recall knee |
| Census routing, `concepts-prefetch.ts` | the question, 1 of 10 slugs | a specific document lookup | `CHAT_CENSUS_SIMILARITY_MARGIN` (0.4) | zero false fires, synthetic and real traffic |
| Tier router, `chat/complexity.ts` | the question | one named subject | `CHAT_COMPLEXITY_SIMILARITY_MARGIN` (0.25) | marginal trade |
| Promised-tool guard, `chat/announcement.ts` | an answer, per sentence | an actual answer | `CHAT_ANNOUNCEMENT_SIMILARITY_MARGIN` (0.25) | zero false fires |

`CHAT_FACT_SIMILARITY=0` turns the similarity lane off for every consumer at once; the regex lanes keep running.

**Features fact.** The margin is permissive because the injected context is read by a large model that can ignore what it does not need: over-injecting costs about 2k discarded tokens, under-injecting can lose the answer. Held out, it catches 25 of 28 product questions (regex alone: 6) at 5 false fires in 92, about 130 wasted tokens per atlas turn against 2,000 if the guide were always injected.

**Census routing** is 1-of-10 routing, which one `prototypes` array cannot express, so it does not go through the registry's `prototypes`/`semanticHit` plumbing. `similarity.ts` exports `rankPrototypeSets(question, Record<slug, string[]>, negatives)`: one embed call scored against every slug's prototype set and one shared negative set, sorted by margin. `routeCensuses()` is the one function both production and `pnpm eval:census` call, so they cannot diverge on the routing rule. A census question already names atlas vocabulary, so it uses its own `CENSUS_NEGATIVE_PROTOTYPES` and only small-talk suppression, never the shared `ATLAS_PROTOTYPES` suppressor. On 202 labeled questions, regex alone routes 30% of natural paraphrases and similarity 86%, at zero false fires. The margin is set where both the labeled corpus and real chat messages produce zero false fires; a margin fitted on the labeled corpus alone fires on open-ended requests ("trace the governance path for an amendment"). Run `pnpm eval:census` with `DATABASE_URL` set before trusting a lower one.

**Tier router.** `looksComplex` is a second lane behind `model-router.ts`'s STRONG regexes, which are high precision and low recall: they score 0 on 28 natural paraphrases written to avoid every trigger. On 180 questions (`pnpm eval:complexity`) the lane adds 13 true positives for 1 false fire. It does **not** suppress on `namesAtlasSubject`: whole-corpus questions are made of atlas vocabulary, and that suppressor would stand it down on 18 of 28 genuine positives. Zero false fires is unreachable, so the margin is set on the marginal trade: a false fire routes to a model measured better and faster (docs/chat-system.md §6.5), costing tokens, never correctness. No real-traffic false-fire check backs this margin; watch PostHog's `chat_route_reason="similarity"` share and run `pnpm eval:complexity` with `DATABASE_URL` set before lowering it.

**Promised-tool guard.** `announcesUnmadeToolCall` runs in `chat-loop.ts` where a round's text would be accepted as the final answer, and catches text that announces a lookup it never made ("One moment while I search the atlas."). It is the only consumer that scores an answer.
- The deterministic suppressor runs first: `isUncheckableAnswer` (`verify/smalltalk.ts`) treats anything with a markdown link, figure or doc number as an answer that never reaches the embedding. That is what protects tool-free answers built from prefetch material.
- The score is per sentence, best sentence wins, because an announcement is a clause inside pleasantries. Sentences under 20 characters are not scored.
- `isSmallTalk` is not used; assistant greetings are a negative prototype class instead.
- Below 0.125 the false fires become product answers ("Searching the atlas is done from the search bar"), which the guard must never touch.
- It retries at most once per turn and never on the final round.

## Pre-first-token Jev judgement

One Jev request runs before the first token (`chat/prefetch-judge.ts`, capped at `CHAT_PREFETCH_JUDGE_DEADLINE_MS`, default 600 ms; `CHAT_PREFETCH_JUDGE_MODEL=""` disables it). It adds a third complexity lane (STRONG at P ≥ `JEV_COMPLEXITY_THRESHOLD`), replaces the census similarity lane (regex ∪ Jev top 3 at P ≥ `JEV_CENSUS_THRESHOLD`), and filters the /teach shortlist. When the judgement is late or disabled, the similarity lanes above run unchanged, so their margins are the fallback path. Details: docs/chat-system.md "Pre-first-token Jev judgement". Ask before adding a second pre-first-token call.

## Adding a fact

Write the fact and append it to `FACTS`; never edit `chat.ts`. Every fact owns its reader-facing copy (`summarize(count)`): the route emits a `facts` SSE event and a `recalling` status, so a fired fact shows in the trace and the stage ticker. `CHAT_PREFETCH=0` disables the whole registry.
