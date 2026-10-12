// The atlas worker's best-effort side steps; atlas-worker.mjs owns the control flow.
// An entry is `{ id, phase, label?, skipWhenNoFetch?, skipWhenInert?, onlyWhenInert?, run(ctx) }`:
//   "tick" — before the drift check, sequentially, ctx.db open; run() returns
//            its log line; a throw is logged and the tick carries on.
//            skipWhenNoFetch is the line logged instead under --no-fetch.
//   "tail" — after the heartbeat, in parallel, ctx.db closed; run() returns
//            the child's promise; a rejection never fails the run.
// In a PR environment (ctx.inert, src/server/pr-env/gate.ts) noFetch is also
// set, and skipWhenInert is the line logged instead of a step that would still
// call an outside API under --no-fetch. An onlyWhenInert step runs nowhere else
// and is skipped silently.
// ctx: { db, full, noFetch, inert, env, runAsync(cmd, args, opts?), log(line), warn(line) }
import prEnvCopy from "./pr-env-copy.ts";
import prState from "./pr-state.mjs";
import chainState from "./chain-state.mjs";
import balances from "./balances.mjs";
import forum from "./forum.mjs";
import pau from "./pau.mjs";
import pauOrigin from "./pau-origin.ts";
import voteArchive from "./vote-archive.ts";
import { TAIL_LANES } from "./tail.mjs";

export const WORKER_STEPS = [prEnvCopy, prState, chainState, balances, pau, pauOrigin, voteArchive, forum, ...TAIL_LANES];

export function stepsIn(steps, phase) {
  return steps.filter((s) => s.phase === phase);
}

const message = (e) => e?.message ?? e;

/** The line logged instead of running a step in this context, "" to skip silently, null to run it. */
function skipLine(step, ctx) {
  if (step.onlyWhenInert && !ctx.inert) return "";
  if (ctx.inert && step.skipWhenInert) return step.skipWhenInert;
  if (ctx.noFetch && step.skipWhenNoFetch) return step.skipWhenNoFetch;
  return null;
}

/** The steps of one phase that run in this context; each skipped one logs its line. */
function runnable(steps, phase, ctx) {
  return stepsIn(steps, phase).filter((step) => {
    const line = skipLine(step, ctx);
    if (line) ctx.log(`atlas-worker: ${line}`);
    return line === null;
  });
}

/** Tick phase: in declared order, one at a time, warn-and-continue. */
export async function runTickSteps(steps, ctx) {
  for (const step of stepsIn(steps, "tick")) {
    const line = skipLine(step, ctx);
    if (line !== null) {
      if (line) ctx.log(`atlas-worker: ${line}`);
      continue;
    }
    try {
      ctx.log(`atlas-worker: ${await step.run(ctx)}`);
    } catch (e) {
      ctx.warn(`atlas-worker: ${step.label ?? step.id} skipped — ${message(e)}`);
    }
  }
}

/** Tail phase: every lane started at once, settled together, failures warned in declared order. */
export async function runTailSteps(steps, ctx) {
  const lanes = runnable(steps, "tail", ctx);
  // async wrapper: a lane that throws synchronously becomes a rejection, not a crash.
  const results = await Promise.allSettled(lanes.map(async (lane) => lane.run(ctx)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      ctx.warn(`atlas-worker: ${lanes[i].id} reconcile error: ${message(result.reason)}`);
    }
  });
}
