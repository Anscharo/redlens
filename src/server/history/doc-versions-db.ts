// atlas_doc_versions access (migrations/034_atlas_doc_versions.sql): upstream's
// per-document version record, written by scripts/required/build-doc-versions.mjs.

import type { SQL } from "bun";

export interface DocVersionRow {
  doc_id: string;
  commit_seq: number;
  commit_sha: string;
  /** null = the document was removed at this commit. */
  fingerprint: string | null;
}

const COLS = ["doc_id", "commit_seq", "commit_sha", "fingerprint"] as const;

function insertSql(chunk: DocVersionRow[]): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const values = chunk
    .map((r) => `(${COLS.map((c) => (params.push(r[c]), `$${params.length}`)).join(",")})`)
    .join(",");
  return {
    text: `INSERT INTO atlas_doc_versions (${COLS.join(",")}) VALUES ${values}
           ON CONFLICT (doc_id, commit_seq) DO UPDATE SET commit_sha = EXCLUDED.commit_sha, fingerprint = EXCLUDED.fingerprint`,
    params,
  };
}

/** Append (idempotently) the rows of newly walked commits. */
export async function upsertDocVersions(sql: SQL, rows: DocVersionRow[], chunkSize = 2000): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { text, params } = insertSql(rows.slice(i, i + chunkSize));
    await sql.unsafe(text, params);
  }
}

/** Replace the whole table in ONE transaction: a full walk (first run, `--full`,
 *  or a cursor that is no longer in upstream's history) must never be readable
 *  half-written — a preview voting over partial intervals would find a sync
 *  point that is simply wrong, with nothing to tell it so. */
export async function replaceDocVersions(sql: SQL, rows: DocVersionRow[], chunkSize = 2000): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM atlas_doc_versions`;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { text, params } = insertSql(rows.slice(i, i + chunkSize));
      await tx.unsafe(text, params);
    }
  });
}

/** The incremental cursor: the full sha of the newest commit that has a row.
 *  Commits after it that changed no document are re-walked each run and yield
 *  nothing again — cheap, and it keeps the cursor inside this one table. */
export async function readDocVersionsCursor(sql: SQL): Promise<string | null> {
  try {
    const rows = await sql<{ commit_sha: string }[]>`
      SELECT commit_sha FROM atlas_doc_versions ORDER BY commit_seq DESC LIMIT 1
    `;
    return rows[0]?.commit_sha ?? null;
  } catch {
    return null;
  }
}
