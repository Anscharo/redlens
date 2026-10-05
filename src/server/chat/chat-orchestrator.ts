// Chat reliability harness orchestrator (docs/chat-system.md §6).
// Wraps the pure runChat loop with: live status events, a streaming citation
// gate (invalid links repaired before their tokens reach the client),
// incremental per-paragraph deterministic checks (verify/incremental.ts —
// `paragraph_check` events as the answer streams), pipelined deterministic
// round checks over the finished answer, and a post-answer verifier audit
// (stream + badge — annotate-only, never gates or rewrites the answer).
// Unset model slots degrade to the plain loop's behavior; harness flakiness
// never breaks a turn. `transcript`/`checksMeta` are internal — the SSE route
// strips them via sanitizeDone before events reach a client.
//
// The phases live under harness/: context.ts builds the turn's state (and
// starts the concurrent small-talk judge), stream-pass.ts streams the answer,
// post-answer.ts runs the exits, repair and deterministic checks, and
// lane-pass.ts the model lanes after `answer_final`.
import { createHarnessCtx } from "./harness/context.ts";
import { streamAnswer } from "./harness/stream-pass.ts";
import { finishTurn } from "./harness/post-answer.ts";
import type { CheckRowMeta, DoneEvent, HarnessEvent, VerifiedChatOpts } from "./harness/types.ts";

export type { CheckRowMeta, HarnessEvent, HarnessDone } from "./harness/types.ts";
export { describeCall } from "./harness/status-copy.ts";
export { normalizeAndRepair } from "./harness/repair.ts";

// The wire-safe done: internal evidence/persistence fields removed.
export function sanitizeDone(done: DoneEvent & { checksMeta?: CheckRowMeta[] }): Omit<DoneEvent, "transcript"> {
  const { transcript: _t, checksMeta: _c, ...wire } = done as DoneEvent & { checksMeta?: CheckRowMeta[] };
  return wire;
}

export async function* runVerifiedChat(opts: VerifiedChatOpts): AsyncGenerator<HarnessEvent> {
  const ctx = createHarnessCtx(opts);
  const done = yield* streamAnswer(ctx);
  if (!done) return; // the loop can only end via done; defensive
  yield* finishTurn(ctx, done);
}
