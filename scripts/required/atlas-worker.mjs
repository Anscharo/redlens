#!/usr/bin/env bun
// Atlas worker — cron entry point for the Railway atlas worker service.
// Detects new atlas commits (vs. what's already in Postgres sync_state),
// runs a full build, then syncs all Postgres tables. The web service's
// in-process updater polls sync_state.atlas_sha and rebuilds its in-memory
// indexes from the updated DB rows — no git access needed on the web service.
//
// On change, embeddings and history run in parallel after the structural sync:
//
//   build-index → build-graph → sync.ts →
//     ┌── sync-embeddings.ts   (atlas_doc_embeddings)
//     └── build-history        (atlas_history — DB sink, reads its own cursor)
//
// Lightweight check: if upstream git SHA matches sync_state.atlas_sha, the
// structural tables are coherent, AND no stale 1:1 embeddings exist, skip the
// structural build — but still reconcile embeddings and history. A matching
// pointer alone is insufficient: restores and failed service wiring have left
// sync_state current while atlas_addresses was empty.
// Grouping metadata (attribution_only / member_ids) can go stale on a policy
// switch without a content_hash miss, and the coverage SELECT below cannot see
// that. sync-embeddings is incremental: a no-op when hashes AND flags match.
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
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SQL } from "bun";
import { touchSyncHeartbeat } from "../lib/worker-heartbeat.mjs";
import { stepsFor } from "../lib/build-steps.mjs";
import { inspectStructuralSnapshot } from "../lib/atlas-sync-health.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUBMODULE = path.join(ROOT, "vendor/next-gen-atlas");

// --no-fetch (or ATLAS_WORKER_NO_FETCH=1): build the CHECKED-OUT submodule commit
// instead of fetching + checking out origin/main. Used by `pnpm dev` — local dev
// builds the pinned commit you have, not upstream main (that's the cron's job).
const NO_FETCH = process.argv.includes("--no-fetch") || process.env.ATLAS_WORKER_NO_FETCH === "1";

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${cmd} ${args.join(" ")} &`);
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0]} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function runPostSyncTail(full) {
  const jobs = [
    {
      name: "embeddings",
      promise: runAsync("bun", ["src/server/sync-embeddings.ts"]),
    },
    {
      name: "history",
      promise: runAsync("bun", ["scripts/required/build-history.mjs", ...(full ? ["--full"] : [])], {
        env: {
          ...process.env,
          GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
        },
      }),
    },
  ];
  const results = await Promise.allSettled(jobs.map((job) => job.promise));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      // Best-effort: structural data is already committed. A later no-change
      // worker tick retries both lanes, so a transient tail failure self-heals.
      console.warn(`atlas-worker: ${jobs[i].name} reconcile error: ${result.reason?.message ?? result.reason}`);
    }
  }
}

async function getUpstreamSha() {
  // Local dev (--no-fetch): the "upstream" is the checked-out submodule commit,
  // so we sync the DB to exactly what's on disk. Otherwise: the tip of origin/main.
  const ref = NO_FETCH ? ["rev-parse", "HEAD"] : ["ls-remote", "origin", "refs/heads/main"];
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", SUBMODULE, ...ref], {
        stdio: ["ignore", "pipe", "inherit"],
        cwd: ROOT,
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, stdout: out }));
      child.on("error", reject);
    });
    const sha = stdout.trim().split(/\s+/)[0] ?? "";
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

async function main() {
  const t0 = Date.now();
  const full = process.env.ATLAS_WORKER_FULL === "1";

  if (!process.env.DATABASE_URL) {
    console.error("atlas-worker: DATABASE_URL is required");
    process.exit(1);
  }

  const db = new SQL(process.env.DATABASE_URL);

  // ── Preview PR-state sweep ────────────────────────────────────────────────
  // Runs every cron tick (before the atlas early-exit) since PR states change
  // independently of atlas commits. Best-effort; never blocks the build.
  try {
    const { sweepPrStates } = await import("../../src/server/preview/pr-state.ts");
    const res = await sweepPrStates(db);
    console.log(`atlas-worker: pr-state sweep — ${res.checked} PR(s) checked, ${res.updated} updated`);
  } catch (e) {
    console.warn(`atlas-worker: pr-state sweep skipped — ${e.message}`);
  }

  // ── Chain-state snapshot (time-gated) ─────────────────────────────────────
  // Also before the atlas early-exit: on-chain state changes independently of
  // atlas commits, and this is the last point where `db` is still open. The
  // cycle runs every ~12 minutes but the multicall sweep must NOT — the gate
  // reads the stored snapshot's fetched_at and only refetches past
  // CHAINSTATE_REFRESH_SECONDS (config.ts, default daily), so RPC spend is one
  // batch per interval. Best-effort: a rate-limited RPC never fails the sync.
  if (NO_FETCH) {
    console.log("atlas-worker: chain-state skipped (--no-fetch) — run `pnpm snap:chainstate` to populate it locally");
  } else {
    try {
      const { maybeRefreshChainState } = await import("../../src/server/chain-state.ts");
      const { fetchChainState } = await import("./fetch-chain-state.mjs");
      const res = await maybeRefreshChainState(db, { fetchSnapshot: () => fetchChainState() });
      console.log(
        res.refreshed
          ? `atlas-worker: chain-state refreshed (was ${res.reason}) — block ${res.block}`
          : `atlas-worker: chain-state fresh (${res.ageSeconds}s old, block ${res.block}) — no RPC fetch`,
      );
    } catch (e) {
      console.warn(`atlas-worker: chain-state step skipped — ${e.message}`);
    }
  }

  // ── Lightweight check ─────────────────────────────────────────────────────
  console.log("atlas-worker: checking upstream atlas SHA…");
  const [upstreamSha, syncState, staleCount] = await Promise.all([
    getUpstreamSha(),
    db`SELECT atlas_sha FROM sync_state WHERE id = 1`.then((r) => r[0]?.atlas_sha ?? null).catch(() => null),
    db`
      SELECT COUNT(*)::int AS n FROM atlas_doc_meta m
      WHERE NOT EXISTS (
        SELECT 1 FROM atlas_doc_embeddings e
        WHERE e.doc_id = m.id AND (
          (cardinality(COALESCE(e.member_ids, '{}')) <= 1 AND e.content_hash = m.content_hash)
          OR cardinality(COALESCE(e.member_ids, '{}')) > 1
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM atlas_doc_embeddings e
        WHERE cardinality(COALESCE(e.member_ids, '{}')) > 1 AND m.id = ANY(e.member_ids)
      )
    `.then((r) => r[0]?.n ?? 0).catch(() => 1), // default 1 → don't skip if query fails
  ]);
  const structural = await inspectStructuralSnapshot(db, syncState);

  // Is the SHARED artifact store already populated for the sha we point at?
  // sync_state advancing and the artifacts being published are separate events,
  // so a pointer match alone does not mean web instances can fetch anything —
  // the same reason the structural check above exists. Without this, the deploy
  // that first ships publishing would find sync_state current, skip the build,
  // and therefore never publish until upstream next moved (possibly days).
  // A query error (most likely migration 025 not applied yet — the web service
  // migrates at boot, this worker does not) is treated as "populated": forcing
  // a rebuild could not fix a missing table, and a rebuild loop every 12 minutes
  // would be worse than waiting for the web to migrate.
  let artifactsPublished = true;
  if (syncState) {
    try {
      const { hasArtifacts } = await import("../../src/server/atlas-artifacts.ts");
      artifactsPublished = await hasArtifacts(syncState, db);
    } catch (e) {
      console.warn(`atlas-worker: artifact-store probe skipped — ${e.message}`);
    }
  }
  if (!artifactsPublished) {
    console.warn(
      `atlas-worker: artifact store has nothing for ${(syncState ?? "").slice(0, 12)} — building to publish it`,
    );
  }

  const alreadyCurrent = upstreamSha && upstreamSha === syncState;
  // In local --no-fetch mode don't gate on embeddings (dev usually has no API key;
  // embeddings are optional) — fast-exit purely on the sha match so repeated
  // `pnpm dev` runs are instant once the DB is current and structurally sound.
  const noStaleEmbeds = NO_FETCH ? true : staleCount === 0;
  const forceStructuralSync = Boolean(syncState && !structural.healthy);

  if (!structural.healthy) {
    console.warn(`atlas-worker: structural integrity failed — ${structural.reasons.join("; ")}`);
  } else {
    console.log(
      `atlas-worker: structural integrity OK — ${structural.currentDocs} docs, ${structural.currentAddresses} addresses`,
    );
  }

  if (!full && alreadyCurrent && noStaleEmbeds && structural.healthy && artifactsPublished) {
    console.log(`atlas-worker: already current at ${(syncState ?? "").slice(0, 12)} — skipping fetch/build`);
    await touchSyncHeartbeat(db);
    await db.close();
    // Reconcile both independently incremental tails. Hash coverage can be
    // complete while grouping metadata is stale, and a failed history branch
    // must recover even when no later Atlas commit arrives.
    if (!NO_FETCH) {
      console.log("atlas-worker: reconciling embeddings + history");
      await runPostSyncTail(false);
    }
    process.exit(0);
  }

  if (!upstreamSha) {
    console.warn("atlas-worker: could not read upstream SHA — proceeding anyway");
  } else {
    console.log(
      `atlas-worker: upstream=${upstreamSha.slice(0, 12)} db=${(syncState ?? "none").slice(0, 12)} staleEmbeds=${staleCount}`,
    );
  }

  await db.close();

  // ── Full build ────────────────────────────────────────────────────────────
  if (NO_FETCH) {
    console.log("atlas-worker: --no-fetch — building the checked-out submodule commit (local dev)");
  } else {
    console.log("atlas-worker: fetching atlas origin/main…");
    run("git", ["-C", SUBMODULE, "fetch", "origin", "main"]);
    run("git", ["-C", SUBMODULE, "checkout", "origin/main"]);
  }

  // The `worker` profile of scripts/lib/build-steps.mjs (which records what
  // this profile skips, and why). build-graph runs BEFORE sync.ts because it
  // enriches addresses.atlas.json (Phase 4.5: ICD-derived roles, entity/
  // doc-title labels) — otherwise atlas_addresses is persisted with only the
  // structural Phase-2.6 annotation.
  for (const step of stepsFor("worker")) {
    console.log(`atlas-worker: ${step.name}…`);
    run("bun", [step.script]);
  }

  // ── Structural sync → advances sync_state.atlas_sha ──────────────────────
  console.log(`atlas-worker: sync.ts${forceStructuralSync ? " --force (integrity repair)" : ""}…`);
  run("bun", ["src/server/sync.ts", ...(forceStructuralSync ? ["--force"] : [])]);

  // Refuse to report success after a structural repair/build that still left
  // the pointer detached from its rows. This is deliberately before the
  // best-effort tails: docs and addresses are the core served snapshot.
  const verifyDb = new SQL(process.env.DATABASE_URL);
  const verifiedState = await verifyDb`
    SELECT atlas_sha FROM sync_state WHERE id = 1
  `.then((r) => r[0]?.atlas_sha ?? null).catch(() => null);
  const verified = await inspectStructuralSnapshot(verifyDb, verifiedState);
  await verifyDb.close();
  if (!verified.healthy) {
    throw new Error(`post-sync structural integrity failed: ${verified.reasons.join("; ")}`);
  }
  console.log(
    `atlas-worker: post-sync integrity OK — ${verified.currentDocs} docs, ${verified.currentAddresses} addresses`,
  );

  // ── Publish the artifact set every web instance reads ────────────────────
  // After the integrity gate (so we never publish artifacts for a sha whose rows
  // did not land) and before the best-effort tails. Best-effort ITSELF for now:
  // the structural sync has already committed, web instances still build their
  // own artifacts, and a failure here must not fail-mark an otherwise good run.
  // REVISIT IN PHASE 4: once the web stops building, this becomes load-bearing
  // and a failure should fail the run rather than warn.
  try {
    console.log("atlas-worker: publish-artifacts…");
    run("bun", ["scripts/required/publish-artifacts.ts"]);
  } catch (e) {
    console.warn(`atlas-worker: publish-artifacts failed — ${e.message} (web instances keep building their own)`);
  }

  // ── Parallel: embeddings + history ───────────────────────────────────────
  // build-history reads its own incremental cursor from atlas_history and
  // upserts straight into it (DB sink), so no cursor files to seed here.
  console.log("atlas-worker: parallel — sync-embeddings + build-history…");
  await runPostSyncTail(full);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`atlas-worker: done in ${elapsed}s`);
}

main().catch((err) => {
  console.error("atlas-worker: fatal error:", err?.message ?? err);
  process.exit(1);
});
