# Staged delivery for chat (replace stream-then-check)

**Decision (2026-08-06):** move the chat UX from "stream + badge, never gate" to **staged delivery** — the user watches honest progress stages while the harness works, and only the **final, verified (possibly revised) answer** is ever rendered. The draft answer, the badge downgrade after the fact, and the jarring mid-stream revision swap all disappear.

## User-facing stages

Looking for evidence → Comparing results → Synthesizing → Verifying content → (escalation only:) Seeking advice → Revising claims → Preparing final report.

Mapping onto events the orchestrator already emits: `querying` → "Looking for evidence" (with `describeCall`'s tool detail), round checks → "Comparing results", generation-in-progress → "Synthesizing", `checking` → "Verifying content", `advising` → "Seeking advice", `revising` → "Revising claims", finalize → "Preparing final report".

## What changes

- **Token events stop rendering in-flight.** Server keeps generating as today; a mode switch (env + per-conversation flag) suppresses/buffers token events on the SSE route; status events become the primary in-flight UI. Frontend (`src/components/chat/`) renders stages instead of a growing draft.
- **Revision UX becomes strictly better**: today a revised answer visibly replaces already-streamed content (`clear` event); staged mode never shows the draft at all.
- **stream-link-gate becomes unnecessary in staged mode** — post-answer citation repair suffices when nothing streams. Keep the gate for streaming mode while both modes exist.
- **Empty final answers become impossible**: the loop-exhaustion compose guard (**landed 2026-08-06**, `chat-loop.ts` `composeFinal`) buys one no-tools answer-or-abstain attempt whenever a round ends with empty content — both eval A/B arms had shipped `""` after burning maxIterations.
- **Optional polish**: display-stream the final answer (typewriter over already-verified text) so the reveal still feels alive — display streaming, not generation streaming.

## Costs / risks

- **Perceived latency** is the whole trade: answer + verify (+ revision) before anything readable — with sliced gemma, verify adds ~24s p50 after generation. Mitigate with substantive stage detail (tool names, doc counts, claim counts), and measure: A/B staged vs streaming with the eval harness + PostHog before flipping the default.
- Long answers hold the user longest — the compose guard + output budget matter more in this mode.

## Status

Planned, not started. Prereq ordering: land the wave-1 compose guard first (shared machinery), then the mode switch server-side, then the chat client stage UI.
