// sync:briefings — the fourth post-sync tail (beside embeddings, history and doc
// versions). A briefing is a short placement-aware description of an atlas
// document plus two or three questions it answers, embedded as a second vector
// per document (docs/plans/atlas-doc-briefings.md). Three passes, in order, each
// writing as it goes so a killed run keeps what it finished:
//
//   1. seed   load public/doc-briefings.json when its hash changed, never over a
//             row the worker wrote for a newer version of the document
//   2. write  ask a model for briefings for new and changed documents, capped per
//             cycle (config.briefingsPerCycle); off when no model is configured
//   3. embed  vectors for every row whose text changed
//
//   bun src/server/sync-briefings.ts   # all three
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { embedBatch } from "./retrieval/embed.ts";
import { getClient } from "./chat/llm.ts";
import { shutdownPosthog } from "./posthog-node.ts";
import { realStore } from "./briefings-store.ts";
import type { BriefingDeps } from "./briefings-deps.ts";
import { runBriefings } from "./briefings-passes.ts";

export type { StoredRow, BriefingWrite, FailedDoc, ToEmbed, BriefingStore } from "./briefings-store.ts";
export type { ModelReply, BriefingDeps, Live } from "./briefings-deps.ts";
export { realStore } from "./briefings-store.ts";
export { stripFences } from "./briefings-deps.ts";
export { seedPass, embedPass, runBriefings } from "./briefings-passes.ts";
export { writePass } from "./briefings-write.ts";

// One run at a time, across callers (the worker tail, dev-preflight, a hand run).
// Arbitrary fixed key like the others: migrate.ts 4711_2026, diff-base-backfill.ts
// 4711_2033, sync-embeddings.ts 4711_2042. All that matters is that they differ.
const BRIEFINGS_LOCK_KEY = 4711_2051;

// ------------------------------------------------------------------- entry point

async function withLock(fn: () => Promise<void>): Promise<void> {
  let reserved: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  // Tri-state like sync-embeddings: "could not ask" runs unlocked (a missed lock
  // costs a duplicate request, a missed run costs search), "held" skips.
  let state: "mine" | "held" | "unavailable" = "unavailable";
  try {
    reserved = await sql.reserve();
    const rows = (await reserved`SELECT pg_try_advisory_lock(${BRIEFINGS_LOCK_KEY})`) as { pg_try_advisory_lock: boolean }[];
    state = rows[0]?.pg_try_advisory_lock ? "mine" : "held";
  } catch (e) {
    console.warn(`sync:briefings — advisory lock unavailable (${(e as Error).message}); proceeding unlocked`);
  }
  try {
    if (state === "held") {
      console.log("sync:briefings — another run holds the lock; skipping");
      return;
    }
    await fn();
  } finally {
    if (reserved) {
      if (state === "mine") {
        try {
          await reserved`SELECT pg_advisory_unlock(${BRIEFINGS_LOCK_KEY})`;
        } catch {
          /* connection already dead — the lock dies with the session */
        }
      }
      reserved.release();
    }
  }
}

// The worker kills its tails at 11 minutes from ITS start (atlas-worker.mjs
// TAIL_CAP_MS). This process starts a few seconds after, so eight minutes from
// process start leaves room for the last requests (120 s each) to finish.
function deadlineAt(env: NodeJS.ProcessEnv = process.env): number {
  const startedAt = Date.now() - process.uptime() * 1000;
  return startedAt + Number(env.BRIEFINGS_DEADLINE_MS ?? 8 * 60_000);
}

export function realDeps(): BriefingDeps {
  return {
    runMigrations,
    store: realStore,
    readSeed: () => {
      const file = join(config.publicDir, "doc-briefings.json");
      return existsSync(file) ? readFileSync(file) : null;
    },
    complete: async (system, user) => {
      const res = await getClient().chat.completions.create(
        {
          model: config.briefingModel,
          temperature: 0,
          // 20,000, not 12,000: Gemini 3.8 Flash was cut off once in 31 pilot
          // chunks at 12,000 and came within 500 tokens twice more.
          max_tokens: 20_000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { timeout: 120_000, maxRetries: 0 },
      );
      // OpenRouter can answer 200 with an error body and no choices.
      const choice = res.choices?.[0];
      if (!choice) throw new Error(`no choices in response: ${JSON.stringify(res).slice(0, 200)}`);
      return { content: choice.message?.content ?? "", finishReason: choice.finish_reason ?? null };
    },
    // Documents raw, no query prefix: the prefix belongs to the query side only.
    embedBatch: (texts) => embedBatch(texts, AbortSignal.timeout(120_000), 0, undefined, "embed-briefing"),
    model: config.briefingModel,
    perCycle: config.briefingsPerCycle,
    hasApiKey: Boolean(config.openrouterApiKey),
    noFetch: process.env.ATLAS_WORKER_NO_FETCH === "1",
    deadlineAt: deadlineAt(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    embedBatchSize: 50,
  };
}

export async function main(deps: BriefingDeps = realDeps()) {
  try {
    await withLock(() => runBriefings(deps));
  } finally {
    await sql.end();
  }
}

// Only when launched directly: the worker and dev-preflight shell out to this
// file, and a plain import (a test) must not start a real run.
if (import.meta.main) {
  await main();
  await shutdownPosthog();
}
