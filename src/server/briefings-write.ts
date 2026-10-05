// The write pass of sync:briefings (split from sync-briefings.ts).
import {
  BRIEFING_MAX_FAILURES,
  BRIEFING_REPLY_INSTRUCTIONS,
  briefingQueue,
  packSets,
  parseRows,
  renderQueue,
  validateBriefing,
} from "../../scripts/lib/doc-briefings.mjs";
import type { BriefingWrite } from "./briefings-store.ts";
import { stripFences, withDeadlineRetry, type BriefingDeps, type Live, type ModelReply } from "./briefings-deps.ts";

interface WriteStats {
  queued: number;
  chunks: number;
  briefed: number;
  failed: number;
}

interface Chunk {
  docs: string[];
  texts: string[];
}

/** Why the write pass is off for this run, or null when it should run. */
function offReason(deps: BriefingDeps): string | null {
  return !deps.model ? "no BRIEFING_MODEL"
    : deps.perCycle === 0 ? "BRIEFINGS_PER_CYCLE=0"
    : !deps.hasApiKey ? "no OPENROUTER_API_KEY"
    : deps.noFetch ? "ATLAS_WORKER_NO_FETCH=1"
    : null;
}

/** The model's rows that pass validation, one per requested document. */
function validRows(parsed: unknown[], chunk: Chunk, n: number, deps: BriefingDeps, live: Live): Map<string, BriefingWrite> {
  const requested = new Set<string>(chunk.docs);
  const good = new Map<string, BriefingWrite>();
  for (const row of parsed) {
    const v = validateBriefing(row, live.nodeMap, requested);
    if (!v.ok) {
      console.warn(`  chunk ${n}: ${v.reason}`);
      continue;
    }
    if (good.has(v.uuid)) continue;
    good.set(v.uuid, {
      docId: v.uuid,
      briefing: v.entry.briefing,
      questions: v.entry.questions,
      digest: live.digest.get(v.uuid)!,
      contextDigest: live.context.get(v.uuid)!,
      model: deps.model,
    });
  }
  return good;
}

/** One model request, or null (already logged) when nothing usable came back. */
async function requestRows(deps: BriefingDeps, chunk: Chunk, n: number): Promise<unknown[] | null> {
  let reply: ModelReply;
  try {
    reply = await withDeadlineRetry(
      () => deps.complete(BRIEFING_REPLY_INSTRUCTIONS, chunk.texts.join("\n\n---\n\n")),
      3,
      deps,
    );
  } catch (e) {
    console.warn(`  chunk ${n}: request failed (${(e as Error).message}); no document touched`);
    return null;
  }
  // A truncated or unreadable reply says nothing about the documents in it, so
  // it counts against none of them.
  const text = stripFences(reply.content);
  const parsed = reply.finishReason === "length" || !text ? null : parseRows(text);
  if (!parsed) {
    console.warn(`  chunk ${n}: reply was ${reply.finishReason === "length" ? "cut off" : "not JSON Lines"}; no document touched`);
    return null;
  }
  return parsed;
}

async function runChunk(deps: BriefingDeps, live: Live, stats: WriteStats, chunk: Chunk, n: number): Promise<void> {
  if (deps.now() > deps.deadlineAt) {
    console.warn(`  chunk ${n}: deadline passed before it started; left for the next cycle`);
    return;
  }
  const parsed = await requestRows(deps, chunk, n);
  if (!parsed) return;
  const good = validRows(parsed, chunk, n, deps, live);
  const missing = chunk.docs.filter((id: string) => !good.has(id));
  if (good.size) await deps.store.upsertWorker([...good.values()]);
  if (missing.length) {
    await deps.store.bumpFailures(
      missing.map((id: string) => ({ docId: id, digest: live.digest.get(id)!, contextDigest: live.context.get(id)! })),
    );
  }
  stats.briefed += good.size;
  stats.failed += missing.length;
}

/** B2. */
export async function writePass(deps: BriefingDeps, live: Live): Promise<WriteStats | null> {
  const off = offReason(deps);
  if (off) {
    console.log(`sync:briefings — write pass off (${off})`);
    return null;
  }

  const rows = await deps.store.loadRows();
  const queue = briefingQueue(live.docs, rows, deps.perCycle, { tree: live.tree, citations: live.citations });
  const chunks: Chunk[] = packSets(renderQueue(live.docs, queue, { tree: live.tree, citations: live.citations }), {
    maxBytes: 40_000,
    maxRows: 80,
  });
  const stats: WriteStats = { queued: queue.length, chunks: chunks.length, briefed: 0, failed: 0 };

  // runChunk handles model and parse failures itself; a rejection here is a
  // database error. Its documents got no row, so they stay queued for next cycle.
  const settled = await Promise.allSettled(chunks.map((c, i) => runChunk(deps, live, stats, c, i + 1)));
  settled.forEach((s, i) => {
    if (s.status === "rejected") console.warn(`  chunk ${i + 1} failed: ${(s.reason as Error)?.message ?? s.reason}; retried next run`);
  });

  const exhausted = [...(await deps.store.loadRows()).values()].filter(
    (r) => r.failures >= BRIEFING_MAX_FAILURES && r.failed_context === live.context.get(r.doc_id),
  ).length;
  if (exhausted > 0) console.warn(`[drift] briefings: ${exhausted} documents failed validation ${BRIEFING_MAX_FAILURES} times`);
  console.log(
    `sync:briefings — write: ${stats.queued} queued, ${stats.chunks} chunks, ${stats.briefed} briefed, ${stats.failed} failed`,
  );
  return stats;
}
