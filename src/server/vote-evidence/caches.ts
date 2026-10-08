// The worker lane's two caches over vote_evidence_cache (sync-vote-evidence.ts):
// the decision model's answers, keyed by the exact request, and atlas
// history's first-writer searches, keyed by the words searched for. Each keeps
// a run from paying twice for the same question.

import crypto from "node:crypto";
import { askJev, noulOf, type JevQuestion } from "../jev.ts";
import type { SqlTag } from "../sql-types.ts";
import type { Judge } from "./compute.ts";
import { firstPr, historyHead } from "./history.ts";
import { cacheGet, cachePut } from "./store.ts";

const sha256 = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

type Ask = typeof askJev;

/** The decision model behind the cache, the per-run cap and the deadline. Null when judging is off. */
export function cachedJudge(db: SqlTag, model: string, perCycle: number, deadlineAt: number, ask: Ask = askJev): Judge {
  let asked = 0;
  return async (state: unknown, questions: Record<string, JevQuestion>, lane: string) => {
    const key = `jev:${sha256({ model, state, questions })}`;
    const hit = await cacheGet<{ nouls: Record<string, number | null> }>(db, key);
    if (hit) return hit.nouls;
    if (asked >= perCycle || Date.now() > deadlineAt) return null;
    asked++;
    const r = await askOnce(ask, { state, questions, model, lane });
    // A refused key, exhausted credits or a malformed question fails every
    // request alike: stop asking for the rest of the run.
    if (r === "fatal") asked = perCycle;
    if (!r || r === "fatal") return null;
    await cachePut(db, key, { nouls: r });
    return r;
  };
}

/** One model call's answers, null when it answered nothing, "fatal" when no later call can succeed. */
async function askOnce(ask: Ask, q: { state: unknown; questions: Record<string, JevQuestion>; model: string; lane: string }) {
  try {
    const run = await ask({ ...q, timeoutMs: 60_000 });
    const nouls = Object.fromEntries(Object.keys(q.questions).map((id) => [id, noulOf(run, id)]));
    return Object.values(nouls).every((p) => p === null) ? null : nouls;
  } catch (e) {
    console.warn(`sync:vote-evidence — ${q.lane} failed: ${(e as Error).message.slice(0, 200)}`);
    return (e as { fatal?: boolean }).fatal ? ("fatal" as const) : null;
  }
}

/**
 * The first pull request writing `needle`. A find is cached for good: the
 * commit that first wrote words stays first. A miss is cached against the
 * checkout's HEAD, so the same checkout never searches for it twice and a
 * newer one, which may hold the words, searches again.
 */
export function cachedFirstPr(db: SqlTag, atlasDir: string, lookup = firstPr, head = historyHead(atlasDir)): (needle: string) => Promise<number | null> {
  const ready = announced(head, atlasDir);
  return async (needle) => {
    const h = await ready;
    if (!h) return null;
    const [found, missed] = [`history:${sha256(needle)}`, `history-miss:${h}:${sha256(needle)}`];
    const hit = await cacheGet<{ pr: number }>(db, found);
    if (hit) return hit.pr;
    if (await cacheGet(db, missed)) return null;
    const pr = await searchOnce(lookup, needle, atlasDir);
    // A failed search (a timeout, say) is cached neither way: the next run tries again.
    if (pr !== undefined) await cachePut(db, pr === null ? missed : found, { pr });
    return pr ?? null;
  };
}

/** The checkout's head, warning once when it has no full history. */
async function announced(head: Promise<string | null>, atlasDir: string): Promise<string | null> {
  const h = await head;
  if (!h) console.warn(`sync:vote-evidence — ${atlasDir} has no full git history; no poll is matched through history`);
  return h;
}

/** One history search's pull request, null when none wrote the words, undefined when the search failed. */
function searchOnce(lookup: typeof firstPr, needle: string, atlasDir: string): Promise<number | null | undefined> {
  return lookup(needle, atlasDir).catch((e: Error) => {
    console.warn(`sync:vote-evidence — history search failed: ${e.message.slice(0, 200)}`);
    return undefined;
  });
}
