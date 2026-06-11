// previews table access. The table is metadata only (sha→repo durability +
// quota accounting + telemetry); bundles live on disk (cache.ts). See
// migrations/006_previews.sql.

import { sql } from "../db.ts";
import type { PreviewMeta } from "./cache.ts";

export interface PreviewRow {
  sha: string;
  repo: string;
  ref: string;
  kind: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_author: string | null;
  pr_state: string | null;
  doc_count: number;
  build_ms: number;
}

/** Upsert on a successful build. created_at is preserved on conflict (re-builds
 *  of a known sha don't reset its analysis date and so don't inflate the quota). */
export async function upsertPreview(m: PreviewMeta): Promise<void> {
  await sql`
    INSERT INTO previews
      (sha, repo, ref, kind, pr_number, pr_title, pr_author, pr_state, doc_count, build_ms, last_access)
    VALUES
      (${m.sha}, ${m.repo}, ${m.ref}, ${m.kind}, ${m.prNumber ?? null}, ${m.prTitle ?? null},
       ${m.prAuthor ?? null}, ${m.prState ?? null}, ${m.docCount}, ${m.buildMs}, now())
    ON CONFLICT (sha) DO UPDATE SET
      repo = EXCLUDED.repo, ref = EXCLUDED.ref, kind = EXCLUDED.kind,
      pr_number = EXCLUDED.pr_number, pr_title = EXCLUDED.pr_title,
      pr_author = EXCLUDED.pr_author, pr_state = EXCLUDED.pr_state,
      doc_count = EXCLUDED.doc_count, build_ms = EXCLUDED.build_ms, last_access = now()
  `;
}

/** Recover the repo (and PR metadata) for a pinned `/preview/<sha>` URL whose
 *  bundle was evicted/wiped — needed to re-fetch the tarball. null = unknown sha. */
export async function getPreviewRow(sha: string): Promise<PreviewRow | null> {
  const rows = (await sql`SELECT * FROM previews WHERE sha = ${sha}`) as PreviewRow[];
  return rows[0] ?? null;
}

export async function isKnownSha(sha: string): Promise<boolean> {
  const rows = (await sql`SELECT 1 FROM previews WHERE sha = ${sha}`) as unknown[];
  return rows.length > 0;
}

export async function touchPreview(sha: string): Promise<void> {
  await sql`UPDATE previews SET last_access = now() WHERE sha = ${sha}`;
}

/** Count NEW previews analyzed today (UTC). Re-builds of known SHAs don't insert,
 *  so they're exempt — regeneration is free, new analysis is quota'd. */
export async function previewsTodayCount(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM previews
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc')
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}
