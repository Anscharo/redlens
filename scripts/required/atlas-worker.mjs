#!/usr/bin/env bun
// Atlas worker — cron entry point for the Railway atlas worker service.
// Detects new atlas commits (vs. what's already in Postgres sync_state),
// runs a full build, then syncs all Postgres tables. The web service's
// in-process updater polls sync_state.atlas_sha and hydrates its in-memory
// indexes from atlas_artifacts (plus docs.json rebuilt from atlas_doc_meta)
// — no git access needed on the web service.
//
// main() is a table of phases. The control flow and every FATAL step live in
// this file; the best-effort side steps are entries in
// scripts/lib/worker-steps/ (add a step there, not here):
//
//   tick steps (pr-state, chain-state, balances, forum — every tick)
//   → drift check (scripts/lib/worker-drift.mjs)
//   → fast-exit:  heartbeat → tail
//   → rebuild:    build-index → … (stepsFor("worker")) → sync.ts →
//                 integrity gate → publish-artifacts → heartbeat →
//     ┌── embeddings     (atlas_doc_embeddings)
//     ├── history        (atlas_history — DB sink, reads its own cursor)
//     ├── doc-versions   (atlas_doc_versions — its own cursor; the first
//     │                   run backfills the whole history by itself)
//     └── briefings      (atlas_doc_briefings)
//
// Lightweight check: if upstream git SHA matches sync_state.atlas_sha, the
// structural tables are coherent, AND no stale 1:1 embeddings exist, skip the
// structural build — but still reconcile the tail. A matching pointer alone is
// insufficient: restores and failed service wiring have left sync_state
// current while atlas_addresses was empty.
// Grouping metadata (attribution_only / member_ids) can go stale on a policy
// switch without a content_hash miss, and the coverage SELECT cannot see that.
// sync-embeddings is incremental: a no-op when hashes AND flags match.
//
// Usage:
//   bun scripts/required/atlas-worker.mjs
//   DATABASE_URL=... GITHUB_TOKEN=... bun scripts/required/atlas-worker.mjs
//
// Required env:
//   DATABASE_URL    — same Postgres as the web service
//
// Optional env:
//   GITHUB_TOKEN        — for `gh api` PR metadata in build-history
//   OPENROUTER_API_KEY  — for embeddings (skipped if unset)
//   ATLAS_WORKER_FULL   — set to "1" to force a full history rebuild
//   ETH_RPC_URL         — mainnet RPC for the chain-state snapshot (falls back
//                         to the public CHAIN_RPC.ethereum endpoint)
//   CHAINSTATE_REFRESH_SECONDS — how old the stored snapshot may get before the
//                         chain-state step refetches it (default 86400 = daily)
//   BALANCES_REFRESH_SECONDS — how old an address's balances_checked_at may get
//                         before the rolling balances step refetches it
//                         (default 86400 = daily). A lookup itself happens at
//                         most hourly, whatever this is set to.
//   BALANCES_REFRESH_BATCH — addresses fetched per lookup, one chain at a time
//                         (default 50)
import { SQL } from "bun";
import { touchSyncHeartbeat } from "../lib/worker-heartbeat.mjs";
import { stepsFor } from "../lib/build-steps.mjs";
import { inspectStructuralSnapshot } from "../lib/atlas-sync-health.mjs";
import { SUBMODULE, readUpstreamSha, run, runAsync } from "../lib/worker-proc.mjs";
import { logRebuildReason, readDriftState } from "../lib/worker-drift.mjs";
import { WORKER_STEPS, runTailSteps, runTickSteps, stepsIn } from "../lib/worker-steps/index.mjs";

// --no-fetch (or ATLAS_WORKER_NO_FETCH=1): build the CHECKED-OUT submodule commit
// instead of fetching + checking out origin/main. Used by `pnpm dev` — local dev
// builds the pinned commit you have, not upstream main (that's the cron's job).
const NO_FETCH = process.argv.includes("--no-fetch") || process.env.ATLAS_WORKER_NO_FETCH === "1";
const t0 = Date.now();
const HARD_CAP_MS = 15 * 60 * 1000;
const TAIL_CAP_MS = 11 * 60 * 1000;
let cap;

function warnIfFull(full) {
  // Not needed to bootstrap an empty DB — build-history and build-doc-versions
  // both read their own cursor, both get null from an empty (or missing) table,
  // and both then walk everything anyway. All the flag adds is on every LATER
  // tick: it makes the fast-exit unreachable, turns doc-versions' append into a
  // drop-and-rewrite of the whole table, and re-walks all ~175 commits — and
  // with them ~174 `gh pr view` calls, since .cache/github-prs is local disk and
  // no Railway service mounts a volume, so every cron container starts cold.
  // At */12 that is ~870 GitHub API calls an hour against a 5,000/hr budget.
  if (full) {
    console.warn(
      "atlas-worker: ATLAS_WORKER_FULL=1 — forcing full history + doc-versions walks and disabling the fast-exit. " +
        "Unset it unless you are deliberately rewalking; an empty DB walks fully on its own.",
    );
  }
}

function armHardCap() {
  // One timer, two deadlines, because the run has two halves whose timeouts mean
  // opposite things.
  //
  // BEFORE the heartbeat everything is load-bearing. A hung GitHub/RPC fetch
  // there blocks every later */12 run and leaves the served snapshot stale
  // (observed 2026-09-17: four days of it), so the tick is killed and the run
  // FAILS. Unchanged.
  //
  // AFTER it, sync.ts, the integrity gate and publish-artifacts have all
  // committed and the only work left is the tail phase, which is documented
  // best-effort. Running out of clock there costs work, never committed state,
  // so it exits 0. One flat 15m cap reported that as a failed run instead, and a
  // cold atlas_doc_embeddings could never beat it: 11,584 docs at the measured
  // ~620/min is ~19 minutes, so the FIRST tick of every new environment was
  // guaranteed to exit(1) (observed 2026-09-25, ~9,000 embedded, everything
  // served already committed at T+12s).
  //
  // Only TWO of the four lanes actually resume mid-walk, and the difference
  // matters for how the budget is sized. sync-embeddings upserts per EMBED_BATCH
  // slice, so a kill keeps every slice already written and the next tick carries
  // on — that is the lane the budget exists for. sync-briefings does the same
  // (rows per model chunk, vectors per slice) and stops starting model requests
  // after BRIEFINGS_DEADLINE_MS (default 8m), so this cap rarely meets it. build-history and
  // build-doc-versions instead buffer the whole walk in memory and write once at
  // the end (upsertHistory / replace-or-upsertDocVersions), so a kill mid-walk
  // commits nothing and the next tick repeats it: work lost, not data. Both fit
  // with room to spare — 112s and 22s cold, measured, against a 660s budget —
  // and history, the slower one, would need ~1,000 atlas commits (from 175) to
  // threaten it. If it ever does, it needs a per-commit flush or a budget of its
  // own; don't just widen this one and call the comment still true.
  //
  // The tail deadline also sits under the */12 cron period, so the process is
  // gone before the next tick claims the same backlog. At 15m it never was: that
  // tick is either skipped (backfill gets 15m per 24m instead of 11m per 12m) or
  // it overlaps and re-embeds what this process is already paying for.
  //
  // Measured from t0 and floored at a minute, which gives TWO distinct thresholds
  // — don't conflate them. The floor ENGAGES once the heartbeat lands past minute
  // 10 (660 - hb < 60), but it only pushes the exit past the */12 TICK once the
  // heartbeat lands past minute 11 (hb + 60 > 720). In between, minute 10 to 11,
  // the floor is active and the process still exits inside its own tick. Only a
  // heartbeat after minute 11 outlives one, and that is the deliberate trade: a
  // very late heartbeat gets its minute rather than having the tails skipped
  // outright. Nothing observed comes near either threshold (T+12s), and Railway
  // skipping the overlapped tick is the benign outcome anyway.
  // unref() so a successful exit isn't held open for the remainder.
  cap = setTimeout(() => {
    console.error("atlas-worker: hard cap (15m) — exiting so cron can retry");
    process.exit(1);
  }, HARD_CAP_MS);
  cap.unref();
}

// Call right after touchSyncHeartbeat() on BOTH paths (fast-exit and rebuild):
// past that point the served snapshot is committed and only the tails remain.
function armTailCap() {
  clearTimeout(cap);
  cap = setTimeout(() => {
    console.warn(
      `atlas-worker: tail budget (${TAIL_CAP_MS / 60000}m) spent — the served snapshot is committed; ` +
        "stopping cleanly so the next cron tick resumes the tails",
    );
    process.exit(0);
  }, Math.max(60 * 1000, TAIL_CAP_MS - (Date.now() - t0)));
  cap.unref();
}

const tailNames = () => stepsIn(WORKER_STEPS, "tail").map((s) => s.id).join(" + ");

// In local --no-fetch mode don't gate on embeddings (dev usually has no API key;
// embeddings are optional) — fast-exit purely on the sha match so repeated
// `pnpm dev` runs are instant once the DB is current and structurally sound.
function canFastExit(drift, full) {
  const alreadyCurrent = drift.upstreamSha && drift.upstreamSha === drift.syncState;
  const noStaleEmbeds = NO_FETCH ? true : drift.staleCount === 0;
  return !full && alreadyCurrent && noStaleEmbeds && drift.structural.healthy && drift.artifactsPublished;
}

async function fastExit(db, ctx, syncState) {
  console.log(`atlas-worker: already current at ${(syncState ?? "").slice(0, 12)} — skipping fetch/build`);
  await touchSyncHeartbeat(db);
  armTailCap();
  await db.close();
  // Reconcile the independently incremental tails anyway. Hash coverage can be
  // complete while grouping metadata is stale, and a failed history branch
  // must recover even when no later Atlas commit arrives.
  if (!NO_FETCH) {
    console.log(`atlas-worker: reconciling ${tailNames()}`);
    await runTailSteps(WORKER_STEPS, ctx);
  }
  process.exit(0);
}

// The `worker` profile of scripts/lib/build-steps.mjs (which records what this
// profile skips, and why). build-graph runs BEFORE sync.ts because it enriches
// addresses.atlas.json (Phase 4.5: ICD-derived roles, entity/doc-title labels)
// — otherwise atlas_addresses is persisted with only the structural Phase-2.6
// annotation. sync.ts advances sync_state.atlas_sha. Every run() is fatal.
function buildAndSync(forceStructuralSync) {
  if (NO_FETCH) {
    console.log("atlas-worker: --no-fetch — building the checked-out submodule commit (local dev)");
  } else {
    console.log("atlas-worker: fetching atlas origin/main…");
    run("git", ["-C", SUBMODULE, "fetch", "origin", "main"]);
    run("git", ["-C", SUBMODULE, "checkout", "origin/main"]);
  }
  for (const step of stepsFor("worker")) {
    console.log(`atlas-worker: ${step.name}…`);
    run("bun", [step.script]);
  }
  console.log(`atlas-worker: sync.ts${forceStructuralSync ? " --force (integrity repair)" : ""}…`);
  run("bun", ["src/server/sync.ts", ...(forceStructuralSync ? ["--force"] : [])]);
}

// Refuse to report success after a structural repair/build that still left the
// pointer detached from its rows: docs and addresses are the core served
// snapshot. Then publish the artifact set every web instance reads — after the
// gate, so artifacts are never published for a sha whose rows did not land.
// Web instances do not build their own artifacts, so a publish failure fails
// the run (`run()` throws on a non-zero exit). sync.ts no-ops without touching
// synced_at when the pointer already matches, so the heartbeat comes only
// after publish, matching the fast-exit guarantee that web instances can fetch
// the artifact set.
async function verifyPublishHeartbeat() {
  const verifyDb = new SQL(process.env.DATABASE_URL);
  const verifiedState = await verifyDb`
    SELECT atlas_sha FROM sync_state WHERE id = 1
  `.then((r) => r[0]?.atlas_sha ?? null).catch(() => null);
  const verified = await inspectStructuralSnapshot(verifyDb, verifiedState);
  if (!verified.healthy) {
    await verifyDb.close();
    throw new Error(`post-sync structural integrity failed: ${verified.reasons.join("; ")}`);
  }
  console.log(
    `atlas-worker: post-sync integrity OK — ${verified.currentDocs} docs, ${verified.currentAddresses} addresses`,
  );
  console.log("atlas-worker: publish-artifacts…");
  run("bun", ["scripts/required/publish-artifacts.ts"]);
  await touchSyncHeartbeat(verifyDb);
  armTailCap();
  await verifyDb.close();
}

function openDb() {
  if (!process.env.DATABASE_URL) {
    console.error("atlas-worker: DATABASE_URL is required");
    process.exit(1);
  }
  return new SQL(process.env.DATABASE_URL);
}

async function main() {
  const full = process.env.ATLAS_WORKER_FULL === "1";
  warnIfFull(full);
  armHardCap();
  const db = openDb();
  const ctx = { db, full, noFetch: NO_FETCH, env: process.env, runAsync, log: console.log, warn: console.warn };

  await runTickSteps(WORKER_STEPS, ctx); // ── 1. tick steps (best-effort)
  console.log("atlas-worker: checking upstream atlas SHA…"); // ── 2. drift check
  const drift = await readDriftState(db, () => readUpstreamSha(NO_FETCH));
  if (canFastExit(drift, full)) return fastExit(db, ctx, drift.syncState);
  logRebuildReason(drift);
  await db.close();

  buildAndSync(Boolean(drift.syncState && !drift.structural.healthy)); // ── 3. build + sync (fatal)
  await verifyPublishHeartbeat(); // ── 4. gate + publish + heartbeat (fatal)
  console.log(`atlas-worker: parallel — ${tailNames()}…`); // ── 5. tail (best-effort)
  await runTailSteps(WORKER_STEPS, ctx);
  console.log(`atlas-worker: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("atlas-worker: fatal error:", err?.message ?? err);
  process.exit(1);
});
