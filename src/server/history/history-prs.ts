import type { SQL } from "bun";
import type { HistoryInsert } from "./history-rows.ts";

export interface AtlasPrInsert {
  pr_number: number;
  title: string | null;
  url: string | null;
  author: string | null;
  review_count: number | null;
  approval_count: number | null;
  comment_count: number | null;
}

export function prRowsFromHistory(rows: HistoryInsert[]): AtlasPrInsert[] {
  const byPr = new Map<number, AtlasPrInsert>();
  for (const row of rows) {
    if (row.pr_number == null) continue;
    const existing = byPr.get(row.pr_number);
    byPr.set(row.pr_number, mergedPr(row, existing));
  }
  return [...byPr.values()];
}

function mergedPr(row: HistoryInsert, existing: AtlasPrInsert | undefined): AtlasPrInsert {
  return {
    pr_number: row.pr_number!,
    title: row.pr_title ?? existing?.title ?? null,
    url: row.pr_url ?? existing?.url ?? null,
    author: row.pr_author ?? existing?.author ?? null,
    review_count: row.review_count ?? existing?.review_count ?? null,
    approval_count: row.approval_count ?? existing?.approval_count ?? null,
    comment_count: row.comment_count ?? existing?.comment_count ?? null,
  };
}

function prTuples(chunk: AtlasPrInsert[], params: unknown[]) {
  return chunk
    .map((row) => {
      const cols = [row.pr_number, row.title, row.url, row.author, row.review_count, row.approval_count, row.comment_count];
      const ph = cols.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    })
    .join(",");
}

export async function upsertAtlasPrs(sql: SQL, rows: AtlasPrInsert[], chunkSize = 1000): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const params: unknown[] = [];
    const valuesSql = prTuples(rows.slice(i, i + chunkSize), params);
    await sql.unsafe(
      `INSERT INTO atlas_prs (pr_number, title, url, author, review_count, approval_count, comment_count)
       VALUES ${valuesSql}
       ON CONFLICT (pr_number) DO UPDATE SET
         title = COALESCE(excluded.title, atlas_prs.title),
         url = COALESCE(excluded.url, atlas_prs.url),
         author = COALESCE(excluded.author, atlas_prs.author),
         review_count = COALESCE(excluded.review_count, atlas_prs.review_count),
         approval_count = COALESCE(excluded.approval_count, atlas_prs.approval_count),
         comment_count = COALESCE(excluded.comment_count, atlas_prs.comment_count),
         updated_at = now()`,
      params,
    );
  }
}
