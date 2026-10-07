// Storage for Stale Dates vote evidence (migration 041), and the public read.
//
//   GET /api/vote-evidence → { atlasSha, computedAt, claims }
//
// The atlas worker writes the row (src/server/sync-vote-evidence.ts); the page
// and the chat's report tool lay it over the rules' verdicts
// (src/lib/votes/overlay.ts). Both treat a missing row as "rules only", so a
// fresh database or a DB-less dev box shows the rules' column unchanged.
import { sql } from "../db.ts";
import { json } from "../http.ts";
import type { SqlTag } from "../sql-types.ts";
import type { VoteEvidence } from "../../lib/votes/evidence.ts";
import type { VoteEvidenceOverlay } from "../../lib/votes/overlay.ts";

export interface StoredOverlay extends VoteEvidenceOverlay {
  complete: boolean;
}

interface Row {
  atlas_sha: string | null;
  claims: unknown;
  complete: boolean;
  computed_at: Date | string;
}

// A historically double-encoded jsonb write arrives as a JSON string; read it either way.
function parsed<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export async function readVoteEvidence(db: SqlTag = sql): Promise<StoredOverlay | null> {
  const rows = (await db`SELECT atlas_sha, claims, complete, computed_at FROM vote_evidence WHERE id = 1`) as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    atlasSha: r.atlas_sha ?? "",
    computedAt: new Date(r.computed_at).toISOString(),
    claims: parsed<Record<string, VoteEvidence>>(r.claims, {}),
    complete: r.complete,
  };
}

export async function writeVoteEvidence(db: SqlTag, o: StoredOverlay): Promise<void> {
  await db`
    INSERT INTO vote_evidence (id, atlas_sha, claims, complete, computed_at)
    VALUES (1, ${o.atlasSha}, ${o.claims}::jsonb, ${o.complete}, ${new Date(o.computedAt)})
    ON CONFLICT (id) DO UPDATE
      SET atlas_sha = excluded.atlas_sha, claims = excluded.claims, complete = excluded.complete, computed_at = excluded.computed_at
  `;
}

/** A cached answer, or undefined when this request was never answered. */
export async function cacheGet<T>(db: SqlTag, key: string): Promise<T | undefined> {
  const rows = (await db`SELECT result FROM vote_evidence_cache WHERE key = ${key}`) as { result: unknown }[];
  return rows.length ? parsed<T>(rows[0].result, undefined as T) : undefined;
}

export async function cachePut(db: SqlTag, key: string, result: object): Promise<void> {
  await db`
    INSERT INTO vote_evidence_cache (key, result) VALUES (${key}, ${result}::jsonb)
    ON CONFLICT (key) DO UPDATE SET result = excluded.result, created_at = now()
  `;
}

// Public and ungated, like /api/chain-state: Stale Dates is open to everyone.
// 503 until the worker has written a row; the page then shows the rules' verdicts.
export async function handleVoteEvidence(): Promise<Response> {
  try {
    const stored = await readVoteEvidence();
    if (!stored) return json({ error: "unavailable" }, 503);
    const { complete: _complete, ...overlay } = stored;
    return json(overlay, 200, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    console.error(`vote-evidence: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}

const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
let snapshot: { at: number; overlay: VoteEvidenceOverlay | null; loading: boolean } = { at: 0, overlay: null, loading: false };

/**
 * The stored overlay for synchronous callers (the chat's report tools build
 * synchronously): the last one read, refreshed in the background once it is
 * five minutes old. Null until the first read lands, which leaves the rules'
 * verdicts in place.
 */
export function currentVoteEvidence(db: SqlTag = sql, now = Date.now()): VoteEvidenceOverlay | null {
  if (!snapshot.loading && now - snapshot.at > SNAPSHOT_MAX_AGE_MS) {
    snapshot.loading = true;
    readVoteEvidence(db)
      .then((o) => void (snapshot = { at: now, overlay: o, loading: false }))
      .catch(() => void (snapshot = { ...snapshot, at: now, loading: false }));
  }
  return snapshot.overlay;
}
