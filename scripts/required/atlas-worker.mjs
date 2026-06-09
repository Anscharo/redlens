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
//     ┌── sync-embeddings.ts              (atlas_doc_embeddings)
//     └── build-history → sync-history-pg (atlas_history)
//
// Lightweight check: if upstream git SHA matches sync_state.atlas_sha AND no
// stale embeddings exist, exits immediately (no work needed).
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
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SQL } from "bun";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUBMODULE = path.join(ROOT, "vendor/next-gen-atlas");
const HISTORY_DIR = path.join(ROOT, "public/history");

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

async function getUpstreamSha() {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", SUBMODULE, "ls-remote", "origin", "refs/heads/main"], {
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

  // ── Lightweight check ─────────────────────────────────────────────────────
  console.log("atlas-worker: checking upstream atlas SHA…");
  const [upstreamSha, syncState, staleCount] = await Promise.all([
    getUpstreamSha(),
    db`SELECT atlas_sha FROM sync_state WHERE id = 1`.then((r) => r[0]?.atlas_sha ?? null).catch(() => null),
    db`
      SELECT COUNT(*)::int AS n FROM atlas_doc_meta m
      WHERE NOT EXISTS (
        SELECT 1 FROM atlas_doc_embeddings e
        WHERE e.doc_id = m.id AND e.content_hash = m.content_hash
      )
    `.then((r) => r[0]?.n ?? 0).catch(() => 1), // default 1 → don't skip if query fails
  ]);

  const alreadyCurrent = upstreamSha && upstreamSha === syncState;
  const noStaleEmbeds = staleCount === 0;

  if (!full && alreadyCurrent && noStaleEmbeds) {
    console.log(`atlas-worker: already current at ${(syncState ?? "").slice(0, 12)} — nothing to do`);
    await db.close();
    process.exit(0);
  }

  if (!upstreamSha) {
    console.warn("atlas-worker: could not read upstream SHA — proceeding anyway");
  } else {
    console.log(`atlas-worker: upstream=${upstreamSha.slice(0, 12)} db=${(syncState ?? "none").slice(0, 12)} staleEmbeds=${staleCount}`);
  }

  await db.close();

  // ── Full build ────────────────────────────────────────────────────────────
  console.log("atlas-worker: fetching atlas origin/main…");
  run("git", ["-C", SUBMODULE, "fetch", "origin", "main"]);
  run("git", ["-C", SUBMODULE, "checkout", "origin/main"]);

  console.log("atlas-worker: build-index…");
  run("bun", ["scripts/required/build-index.mjs"]);

  // build-graph enriches addresses.atlas.json (Phase 4.5: ICD-derived roles,
  // entity/doc-title labels) before sync.ts reads it — otherwise atlas_addresses
  // is persisted with only the structural Phase-2.6 annotation.
  console.log("atlas-worker: build-graph…");
  run("bun", ["scripts/required/build-graph.mjs"]);

  // ── Structural sync → advances sync_state.atlas_sha ──────────────────────
  console.log("atlas-worker: sync.ts…");
  run("bun", ["src/server/sync.ts"]);

  // ── History cursor for incremental walk ───────────────────────────────────
  const db2 = new SQL(process.env.DATABASE_URL);
  let cursor = null;
  if (!full) {
    try {
      const rows = await db2`
        SELECT commit_sha FROM atlas_history
        WHERE commit_seq = (SELECT MAX(commit_seq) FROM atlas_history WHERE commit_seq IS NOT NULL)
        LIMIT 1
      `;
      cursor = rows[0]?.commit_sha ?? null;
    } catch { /* first run */ }
    console.log(`atlas-worker: history cursor = ${cursor ? cursor.slice(0, 12) : "none (full)"}`);
  }
  await db2.close();

  mkdirSync(HISTORY_DIR, { recursive: true });
  if (cursor && !full) {
    writeFileSync(path.join(HISTORY_DIR, "_last_commit.txt"), cursor);
    const manifestPath = path.join(HISTORY_DIR, "_manifest.json");
    if (!existsSync(manifestPath)) writeFileSync(manifestPath, "{}");
  } else {
    for (const f of ["_last_commit.txt", "_manifest.json"]) {
      const p = path.join(HISTORY_DIR, f);
      if (existsSync(p)) try { execFileSync("rm", [p]); } catch { /* ignore */ }
    }
  }

  // ── Parallel: embeddings + history ───────────────────────────────────────
  console.log("atlas-worker: parallel — sync-embeddings + build-history…");
  const results = await Promise.allSettled([
    // Branch 1: embeddings (skipped without API key — sync-embeddings guards internally)
    runAsync("bun", ["src/server/sync-embeddings.ts"]),

    // Branch 2: history (incremental git walk → Postgres)
    (async () => {
      await runAsync("bun", ["scripts/required/build-history.mjs"], {
        env: {
          ...process.env,
          GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
        },
      });
      await runAsync("bun", ["src/server/sync-history-pg.ts"]);
    })(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      // Best-effort: log but don't fail the worker run
      console.warn(`atlas-worker: branch error: ${result.reason?.message ?? result.reason}`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`atlas-worker: done in ${elapsed}s`);
}

main().catch((err) => {
  console.error("atlas-worker: fatal error:", err?.message ?? err);
  process.exit(1);
});
