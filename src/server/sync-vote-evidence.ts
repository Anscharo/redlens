// sync:vote-evidence — the atlas worker tail that refines Stale Dates' vote
// evidence (docs/plans/vote-matching.md §11). Each run:
//
//   1. gate     skip while the stored row is complete, for this atlas commit,
//               and younger than VOTE_EVIDENCE_REFRESH_SECONDS
//   2. fetch    the vote record and every poll body, as `pnpm votes:sync` reads them
//   3. compute  the rules' verdict per claim, refined by atlas history (the
//               atlas checkout's full git log) and the decision model, both
//               cached in vote_evidence_cache so only new or changed claims cost
//   4. write    the vote_evidence row GET /api/vote-evidence serves
//
//   bun src/server/sync-vote-evidence.ts
import crypto from "node:crypto";
import { resolve } from "node:path";
import { sql } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { askJev, noulOf, type JevQuestion } from "./jev.ts";
import { JEV } from "./env/chat.ts";
import { shutdownPosthog } from "./posthog-node.ts";
import { docRowToNode, loadDocMetaSnapshot } from "./retrieval/indexes.ts";
import type { SqlTag } from "./sql-types.ts";
import { computeOverlay, type ComputeInput, type Judge } from "./vote-evidence/compute.ts";
import { firstPr, hasHistory } from "./vote-evidence/history.ts";
import { cacheGet, cachePut, readVoteEvidence, writeVoteEvidence } from "./vote-evidence/store.ts";
import { readVoteRecord } from "../../scripts/lib/votes/record.ts";

// One run at a time across callers. Arbitrary fixed key; it only has to differ
// from the others (sync-briefings.ts lists them).
const LOCK_KEY = 4711_2057;
// The worker stops its tails 11 minutes after it starts; no new model request after this.
const DEADLINE_MS = 6 * 60_000;
const ATLAS_DIR = resolve(import.meta.dir, "../..", process.env.ATLAS_SRC_DIR ?? "vendor/next-gen-atlas");

/**
 * The lane's settings (declared in env/atlas.ts), parsed here rather than in
 * config.ts because only this process reads them, as sync-embeddings parses
 * EMBED_BATCH.
 *
 * Jev 1.13 by default: on the hand-checked gold
 * (docs/research/vote-matching/second-voice-eval.md) it caught 33 of 34 wrong
 * executives where the rules caught 17, at 97% accuracy. Every answer is cached
 * by request, so a run only asks about new or changed claims; perCycle caps the
 * requests one run makes (a fresh database needs about 40). An empty model or a
 * perCycle of 0 turns judging off; history still runs.
 */
export function laneSettings(env: NodeJS.ProcessEnv = process.env) {
  return {
    model: env.VOTE_EVIDENCE_MODEL ?? JEV,
    perCycle: Number(env.VOTE_EVIDENCE_PER_CYCLE ?? 80),
    refreshSeconds: Number(env.VOTE_EVIDENCE_REFRESH_SECONDS ?? 3600),
  };
}

const sha256 = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Why a run is due, or null while the stored evidence is fresh. */
export async function dueReason(db: SqlTag, atlasSha: string, refreshSeconds: number, now = Date.now()): Promise<string | null> {
  const row = await readVoteEvidence(db);
  if (!row) return "no row";
  if (!row.complete) return "unfinished";
  if (row.atlasSha !== atlasSha) return "atlas moved";
  const ageSeconds = (now - Date.parse(row.computedAt)) / 1000;
  return ageSeconds >= refreshSeconds ? "stale" : null;
}

/** The decision model behind the cache, the per-run cap and the deadline. Null when judging is off. */
export function cachedJudge(db: SqlTag, model: string, perCycle: number, deadlineAt: number, ask = askJev): Judge {
  let asked = 0;
  return async (state: unknown, questions: Record<string, JevQuestion>, lane: string) => {
    const key = `jev:${sha256({ model, state, questions })}`;
    const hit = await cacheGet<{ nouls: Record<string, number | null> }>(db, key);
    if (hit) return hit.nouls;
    if (asked >= perCycle || Date.now() > deadlineAt) return null;
    asked++;
    try {
      const run = await ask({ state, questions, model, lane, timeoutMs: 60_000 });
      const nouls = Object.fromEntries(Object.keys(questions).map((id) => [id, noulOf(run, id)]));
      if (Object.values(nouls).every((p) => p === null)) return null;
      await cachePut(db, key, { nouls });
      return nouls;
    } catch (e) {
      console.warn(`sync:vote-evidence — ${lane} failed: ${(e as Error).message.slice(0, 200)}`);
      // A refused key, exhausted credits or a malformed question fails every
      // request alike: stop asking for the rest of the run.
      if ((e as { fatal?: boolean }).fatal) asked = perCycle;
      return null;
    }
  };
}

/**
 * The first pull request writing `needle`, cached once found. A miss is not
 * cached: a checkout behind the database finds the words on a later run.
 */
export function cachedFirstPr(db: SqlTag, atlasDir: string, lookup = firstPr): (needle: string) => Promise<number | null> {
  const on = hasHistory(atlasDir);
  if (!on) console.warn(`sync:vote-evidence — ${atlasDir} has no full git history; no poll is matched through history`);
  return async (needle) => {
    if (!on) return null;
    const key = `history:${sha256(needle)}`;
    const hit = await cacheGet<{ pr: number }>(db, key);
    if (hit) return hit.pr;
    const pr = lookup(needle, atlasDir);
    if (pr !== null) await cachePut(db, key, { pr });
    return pr;
  };
}

async function run(db: SqlTag): Promise<void> {
  await runMigrations();
  const { atlasSha, rows } = await loadDocMetaSnapshot(sql);
  if (!rows.length) return console.warn("sync:vote-evidence — atlas_doc_meta is empty; nothing to judge");
  const lane = laneSettings();
  const reason = await dueReason(db, atlasSha ?? "", lane.refreshSeconds);
  if (!reason) return console.log("sync:vote-evidence — fresh; nothing to do");
  const { artifact, pollBodies } = await readVoteRecord({ portal: true });
  const input: ComputeInput = { docs: Object.fromEntries(rows.map((r) => [r.id, docRowToNode(r)])), artifact, pollBodies };
  const model = config.openrouterApiKey && lane.perCycle > 0 ? lane.model || null : null;
  const startedAt = Date.now() - process.uptime() * 1000;
  const judge = cachedJudge(db, model ?? "", lane.perCycle, startedAt + DEADLINE_MS);
  const r = await computeOverlay(input, { model, judge, firstPr: cachedFirstPr(db, ATLAS_DIR), today: new Date() });
  await writeVoteEvidence(db, { atlasSha: atlasSha ?? "", computedAt: new Date().toISOString(), claims: r.claims, complete: r.unjudged === 0 });
  console.log(
    `sync:vote-evidence (${reason}) — ${Object.keys(r.claims).length} claims, ${r.judged} judged by ${model ?? "no model"}, ` +
      `${r.fromHistory} matched through history, ${r.unjudged} left for the next run`,
  );
}

async function withLock(fn: () => Promise<void>): Promise<void> {
  const reserved = await sql.reserve();
  try {
    const rows = (await reserved`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`) as { ok: boolean }[];
    if (!rows[0]?.ok) return console.log("sync:vote-evidence — another run holds the lock; skipping");
    try {
      await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    }
  } finally {
    reserved.release();
  }
}

// Only when launched directly, so a test can import the pieces.
if (import.meta.main) {
  try {
    // --no-fetch (local dev) never fetches the vote record or spends on the model.
    if (process.env.ATLAS_WORKER_NO_FETCH === "1") console.log("sync:vote-evidence — skipped (--no-fetch); run `pnpm sync:vote-evidence` to fill it locally");
    else await withLock(() => run(sql));
  } finally {
    await sql.end();
    await shutdownPosthog();
  }
}
