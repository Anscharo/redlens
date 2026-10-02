# Chat server

How the chat works end to end (loop, tools, harness, guard rails, delivery, SSE contract, evals): [`docs/chat-system.md`](../../../docs/chat-system.md). Read it before changing anything under `src/server/chat/` or `apps/web/src/components/chat/`. The plans in `docs/plans/archive/` record intent only, not current behaviour.

Context injected before the model runs is the fact registry, and the similarity lanes that `complexity.ts`, `announcement.ts` and `prefetch-judge.ts` use are documented with it: see `src/server/facts/CLAUDE.md`. Add a fact there, never by editing `chat.ts`.

## Two distinctions the chat never blurs

- **This chat vs the whole web app**: enforced by the features fact's `chat` / `app` split.
- **The Atlas vs our extraction**: the Atlas is the source documents; entities, relations, roles, addresses, params, censuses and every report built on them are SAbR's parse of them. The system prompt's "Entity traversal (live graph)" section states it, and the features fact's `vocabulary` block and `CENSUSES_NOTE` reinforce it.

## Verifier

- The verifier is refutation-only: it reports what the evidence contradicts, never what an answer gets right. Two concurrent auditors (`refute`, `overreach`) run on every answer, and a `confirm` call runs only when at least one candidate survives code span validation, so a clean answer pays nothing extra.
- The auditors live in `verify/sliced-verifier.ts` (`runSlicedVerifier`). Per-slice models: `CHAT_VERIFIER_SLICE_MODELS="refute=m1,overreach=m2,confirm=m3"`. `CHAT_VERIFIER_MODEL` stays on gemma-4 until `pnpm eval:verifier` or `pnpm eval:slices` says otherwise.
- The parameter table (`src/lib/paramIndex.ts`), liveness tags (`src/lib/liveness.ts`) and the absence contract (`verify/absence.ts`) feed the `refute`/`confirm` pipeline as candidate contradictions, not as outcomes of their own. The two indexes are derived in `buildIndexes()`, so they are never stale against the served docs.
- The deterministic verification passes run per paragraph as the answer streams (`paragraph_check` events). With `CHAT_REFUTE_MODE=paragraph` (the default) the `refute` audit also runs per paragraph, concurrently with generation, and reports `paragraph_refute`.

## Not built

- **Class completeness**: superlative and exhaustive questions (`oldest`, `all`) cannot be answered from ranked search. Plan: [`docs/plans/chat-class-completeness.md`](../../../docs/plans/chat-class-completeness.md).
- The deferred parts of the constraints-wiki plan (v2 card rerun, attach-on-hit, Phase 2, A.6 rollup) need a new decision before anyone builds them; the status ledger is at the top of `docs/research/constraints-wiki.md`.
