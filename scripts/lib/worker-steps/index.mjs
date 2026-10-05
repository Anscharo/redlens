// The atlas worker's best-effort side steps; atlas-worker.mjs owns the control flow.
// An entry is `{ id, phase, label?, skipWhenNoFetch?, run(ctx) }`:
//   "tick" — before the drift check, sequentially, ctx.db open; run() returns
//            its log line; a throw is logged and the tick carries on.
//            skipWhenNoFetch is the line logged instead under --no-fetch.
//   "tail" — after the heartbeat, in parallel, ctx.db closed; run() returns
//            the child's promise; a rejection never fails the run.
// ctx: { db, full, noFetch, env, runAsync(cmd, args, opts?), log(line), warn(line) }
import prState from "./pr-state.mjs";
import chainState from "./chain-state.mjs";
import balances from "./balances.mjs";
import forum from "./forum.mjs";
import { TAIL_LANES } from "./tail.mjs";

export const WORKER_STEPS = [prState, chainState, balances, forum, ...TAIL_LANES];

export function stepsIn(steps, phase) {
  return steps.filter((s) => s.phase === phase);
}

const message = (e) => e?.message ?? e;

/** Tick phase: in declared order, one at a time, warn-and-continue. */
export async function runTickSteps(steps, ctx) {
  for (const step of stepsIn(steps, "tick")) {
    if (ctx.noFetch && step.skipWhenNoFetch) {
      ctx.log(`atlas-worker: ${step.skipWhenNoFetch}`);
      continue;
    }
    try {
      ctx.log(`atlas-worker: ${await step.run(ctx)}`);
    } catch (e) {
      ctx.warn(`atlas-worker: ${step.label} skipped — ${message(e)}`);
    }
  }
}

/** Tail phase: every lane started at once, settled together, failures warned in declared order. */
export async function runTailSteps(steps, ctx) {
  const lanes = stepsIn(steps, "tail");
  // async wrapper: a lane that throws synchronously becomes a rejection, not a crash.
  const results = await Promise.allSettled(lanes.map(async (lane) => lane.run(ctx)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      ctx.warn(`atlas-worker: ${lanes[i].id} reconcile error: ${message(result.reason)}`);
    }
  });
}
