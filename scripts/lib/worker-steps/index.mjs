// The atlas worker's side steps, declared once. scripts/required/atlas-worker.mjs
// owns the control flow (drift check, structural build, sync, publish, exit
// codes); everything else it does is an entry here, run by one generic runner
// per phase.
//
// An entry is `{ id, phase, label?, skipWhenNoFetch?, run(ctx) }`:
//   phase "tick" — every cron tick, BEFORE the drift check, sequentially, while
//                  ctx.db is open. run() returns its log line (without the
//                  "atlas-worker: " prefix). A throw is logged as
//                  "<label> skipped — <message>" and the tick carries on.
//                  skipWhenNoFetch, when set, is the line logged INSTEAD of
//                  running under --no-fetch (the step needs the network).
//   phase "tail" — after the heartbeat, all lanes in parallel; ctx.db is closed.
//                  run() returns the child's promise. A rejection is logged as
//                  "<id> reconcile error: <message>" and never fails the run.
// Every step is best-effort; the fatal work is the worker's own.
//
// The ctx every step receives:
//   { db, full, noFetch, env, runAsync(cmd, args, opts?), log(line), warn(line) }
//
// Add a step: a new file here (or a TAIL_LANES entry) plus one line below.
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
