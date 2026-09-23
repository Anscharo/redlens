// Fill `previews` rows whose diff-base columns are still NULL.
//
// Migration 033 added the columns, and only a build upserts them. A preview
// that is already on disk never rebuilds — the handler bumps last_access and
// serves the bundle — so every row written before the columns existed stays
// NULL. This recomputes the same record a same-sha rebuild would write and
// stores it without resetting created_at or last_access. A later rebuild
// still overwrites it via upsertPreview.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { installationToken } from "./github-app.ts";
import { CANONICAL_REPO, makeGhClient, type GhClient, type Resolved } from "./resolve.ts";
import { resolveCandidates, type Candidates } from "./pr-diff.ts";
import { fetchAndExtract } from "./tarball.ts";
import { snapshotFromSrcDir, type Snapshot } from "./snapshot.ts";
import { diffBaseHasLca, diffBaseLabel, diffBaseLogLine, diffBaseType } from "./diff-base-record.ts";
import type { PreviewBases, PreviewMeta } from "./cache.ts";
import {
  fillPreviewDiffBase,
  listPreviewsWithoutDiffBase,
  materializeDiffBase,
  resolveBackfillRow,
  type BackfillRow,
  type DiscoveredBase,
} from "./diff-base-backfill-row.ts";

export interface BackfillResult {
  filled: number;
  skipped: number;
  failed: number;
}

interface LiveAtlas {
  commit: string;
  snapshot: Snapshot;
}

export interface BackfillDeps {
  list: () => Promise<BackfillRow[]>;
  token: () => string;
  installationToken: (repo: string) => Promise<string | null>;
  gh: (token: string) => GhClient;
  candidates: typeof resolveCandidates;
  live: (token: string) => Promise<LiveAtlas>;
  /** Checkout `sha` in `repo` and parse it. Throws if the archive is gone. */
  snapshotAt: (repo: string, sha: string, token: string) => Promise<Snapshot>;
  fill: (sha: string, meta: PreviewMeta, discovered: DiscoveredBase) => Promise<boolean>;
}

const LOCK_KEY = 4711_2033;

async function servedAtlas(token: string): Promise<LiveAtlas> {
  try {
    const ix = getIndexes();
    if (ix.meta.atlasCommit && ix.docMap.size > 0) {
      return { commit: ix.meta.atlasCommit, snapshot: ix.docMap as unknown as Snapshot };
    }
  } catch {
    /* script / test process — indexes are loaded only by the server boot */
  }
  const rows = (await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`) as { atlas_sha: string | null }[];
  const commit = rows[0]?.atlas_sha;
  if (!commit) throw new Error("no served atlas commit");
  return { commit, snapshot: await loadSnapshot(CANONICAL_REPO, commit, token) };
}

async function loadSnapshot(repo: string, sha: string, token: string): Promise<Snapshot> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-diff-base-"));
  try {
    const { srcDir } = await fetchAndExtract(repo, sha, token, dir);
    return snapshotFromSrcDir(srcDir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function realDeps(): BackfillDeps {
  return {
    list: () => listPreviewsWithoutDiffBase(),
    token: () => config.githubToken,
    installationToken,
    gh: makeGhClient,
    candidates: resolveCandidates,
    live: servedAtlas,
    snapshotAt: loadSnapshot,
    fill: (sha, meta, discovered) =>
      fillPreviewDiffBase(sql as unknown as Parameters<typeof fillPreviewDiffBase>[0], sha, meta, discovered),
  };
}

function metaFor(resolved: Resolved, bases: PreviewBases, live: LiveAtlas, counts: { added: number; changed: number }): PreviewMeta {
  return {
    sha: resolved.sha,
    repo: resolved.repo,
    ref: resolved.ref,
    kind: resolved.kind,
    resolvedAt: "",
    docCount: 0,
    buildMs: 0,
    private: resolved.private,
    prBase: resolved.prBase && { repo: resolved.prBase.repo, ref: resolved.prBase.ref },
    defaultBranch: resolved.defaultBranch,
    bases,
    baseAtlasCommit: live.commit,
    diffCounts: counts,
  };
}

export async function backfillPreviewDiffBases(over: Partial<BackfillDeps> = {}): Promise<BackfillResult> {
  const deps: BackfillDeps = { ...realDeps(), ...over };
  const result: BackfillResult = { filled: 0, skipped: 0, failed: 0 };
  const rows = await deps.list();
  if (rows.length === 0) return result;
  const token = deps.token();
  // No service token means no canonical compare and no archives. Leave the
  // rows NULL for a later boot that has one, rather than guessing.
  if (!token) return { ...result, skipped: rows.length };
  const live = await deps.live(token);
  // Merge bases only. Heads are one-shot and must not accumulate — each is a
  // full atlas, and a table of old previews is a table of distinct heads.
  const baseCache = new Map<string, Snapshot>([[live.commit, live.snapshot]]);
  for (const row of rows) {
    const sha8 = row.sha.slice(0, 8);
    try {
      let tokenForRow: string | null = token;
      if (row.private) {
        // No installation token (app not configured, not installed, or the
        // lookup threw) — skip rather than redline with the service token.
        // The row stays NULL and a later boot retries.
        try {
          tokenForRow = await deps.installationToken(row.repo);
        } catch {
          tokenForRow = null;
        }
        if (!tokenForRow) {
          result.skipped++;
          continue;
        }
      }
      const gh = deps.gh(tokenForRow || token);
      const hydrated = await resolveBackfillRow(row, gh);
      if (hydrated === "skip") {
        result.skipped++;
        continue;
      }
      const { resolved, discovered } = hydrated;
      const candidates: Candidates = await deps.candidates(resolved, {
        token: tokenForRow || token,
        priv: !!row.private,
        atlasCommit: live.commit,
      });
      const materialized = await materializeDiffBase(resolved, candidates, live, async (repo, sha) => {
        const hit = baseCache.get(sha);
        if (hit && sha !== resolved.sha) return hit;
        const snap = await deps.snapshotAt(repo, sha, tokenForRow || token);
        if (sha !== resolved.sha) baseCache.set(sha, snap);
        return snap;
      });
      if (materialized === "skip") {
        result.skipped++;
        continue;
      }
      const meta = metaFor(resolved, materialized.bases, live, materialized.counts);
      const wrote = await deps.fill(row.sha, meta, discovered);
      if (wrote) {
        result.filled++;
        console.log(diffBaseLogLine(meta).replace(": ", ": backfill "));
      } else result.skipped++;
    } catch (e) {
      result.failed++;
      console.warn(`[preview] ${sha8}: diff-base backfill failed (${(e as Error).name || "Error"})`);
    }
  }
  return result;
}

/** Detached boot hook. Quiet when there is nothing to fill. One advisory lock
 *  so two web replicas don't each download every archive. */
export function startPreviewDiffBaseBackfill(): void {
  if (!config.githubToken) return;
  void (async () => {
    const reserved = await sql.reserve();
    try {
      const got = (await reserved`SELECT pg_try_advisory_lock(${LOCK_KEY})`) as { pg_try_advisory_lock: boolean }[];
      if (!got[0]?.pg_try_advisory_lock) return;
      const r = await backfillPreviewDiffBases();
      if (r.filled || r.skipped || r.failed) {
        console.log(`[preview] diff-base backfill: filled ${r.filled}, skipped ${r.skipped}, failed ${r.failed}`);
      }
    } catch (e) {
      console.warn(`[preview] diff-base backfill failed (${(e as Error).name || "Error"})`);
    } finally {
      try {
        await reserved`SELECT pg_advisory_unlock(${LOCK_KEY})`;
      } catch {
        /* connection already dead — the lock dies with the session */
      }
      reserved.release();
    }
  })();
}

if (import.meta.main) {
  const dry = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : NaN;
  const r = await backfillPreviewDiffBases({
    ...(Number.isFinite(limit) ? { list: async () => (await listPreviewsWithoutDiffBase()).slice(0, limit) } : {}),
    ...(dry
      ? {
          fill: async (sha, meta) => {
            console.log(
              `[preview] ${sha.slice(0, 8)}: dry-run ${diffBaseType(meta)} lca=${diffBaseHasLca(meta)} ${diffBaseLabel(meta)} +${meta.diffCounts?.added ?? "?"}/${meta.diffCounts?.changed ?? "?"}`,
            );
            return true;
          },
        }
      : {}),
  });
  console.log(JSON.stringify(r));
  await sql.end();
}
