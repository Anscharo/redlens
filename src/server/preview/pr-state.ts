// PR-state sweep. Run on the atlas worker cron: for every PR that has a preview
// row, ask GitHub its current state and write it to previews.pr_state. The web
// service overlays this fresh state when serving meta.json, so a banner flips to
// "merged"/"closed" without rebuilding the bundle. Best-effort — a GitHub or DB
// hiccup logs and moves on; it never blocks the atlas build.

import { makeGhClient, CANONICAL_REPO } from "./resolve.ts";

// Minimal structural type so the worker can pass its own Bun.sql client without
// importing the web service's config-bound `sql`.
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export async function sweepPrStates(
  sql: SqlTag,
  token = process.env.GITHUB_TOKEN ?? "",
): Promise<{ checked: number; updated: number }> {
  const rows = (await sql`
    SELECT DISTINCT pr_number FROM previews WHERE kind = 'pr' AND pr_number IS NOT NULL
  `) as { pr_number: number }[];
  if (rows.length === 0) return { checked: 0, updated: 0 };

  const gh = makeGhClient(token);
  let updated = 0;
  for (const { pr_number } of rows) {
    const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls/${pr_number}`);
    if (!r.ok || !r.json) continue;
    const state = r.json.merged_at ? "merged" : r.json.state === "closed" ? "closed" : "open";
    const changed = (await sql`
      UPDATE previews SET pr_state = ${state}
      WHERE pr_number = ${pr_number} AND pr_state IS DISTINCT FROM ${state}
      RETURNING sha
    `) as unknown[];
    if (Array.isArray(changed)) updated += changed.length;
  }
  return { checked: rows.length, updated };
}
