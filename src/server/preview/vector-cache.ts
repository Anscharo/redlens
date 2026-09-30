// The ONLY module that touches preview_vectors (migration 035): vectors made
// for previews, kept so that a rebuild finds them and asks the provider for
// nothing. Behind two functions, so that moving the store elsewhere is this
// one file rewritten.
//
// Keyed by (model, content hash). Capped: past PREVIEW_VECTORS_MAX rows the
// least recently used are removed.

import { sql as realSql, toVectorLiteral } from "../db.ts";
import { config } from "../config.ts";

// Measured 2026-09-29: 459 vectors took 2.7 MB with their index, so 20,000 is
// about 120 MB. A preview needs a few hundred, so this holds the working set
// of well over the 20 bundles kept on disk, and of a pull request's earlier
// commits.
export const PREVIEW_VECTORS_MAX = 20_000;
// A read marks its rows as used, but not more than once an hour for each row:
// the mark only has to order rows for eviction.
const TOUCH_AFTER = "1 hour";

type Db = typeof realSql;

/**
 * Every known vector among `hashes`, keyed by hash: the ones kept here, and the
 * ones the LIVE atlas already holds for the same text (atlas_doc_embeddings),
 * in one round trip.
 */
export async function readVectors(hashes: string[], db: Db = realSql, model: string = config.embedModel): Promise<Map<string, number[]>> {
  if (!hashes.length) return new Map();
  // The RAW array with a ::jsonb cast — see pg-array.ts. pgvector's text form
  // is a JSON array, so it parses as one.
  const rows = (await db`
    WITH wanted AS (SELECT jsonb_array_elements_text(${hashes}::jsonb) AS h),
    touched AS (
      UPDATE preview_vectors p SET last_used = now()
        FROM wanted w
       WHERE p.model = ${model} AND p.content_hash = w.h AND p.last_used < now() - ${TOUCH_AFTER}::interval
      RETURNING 1
    )
    SELECT p.content_hash, p.embedding::text AS v
      FROM preview_vectors p JOIN wanted w ON p.content_hash = w.h
     WHERE p.model = ${model}
    UNION ALL
    SELECT e.content_hash, e.embedding::text AS v
      FROM atlas_doc_embeddings e JOIN wanted w ON e.content_hash = w.h
  `) as { content_hash: string; v: string }[];
  return new Map(rows.map((r) => [r.content_hash, JSON.parse(r.v) as number[]]));
}

/** Keep these vectors. A hash already kept is only marked as used. */
export async function saveVectors(entries: [hash: string, vector: number[]][], db: Db = realSql, model: string = config.embedModel): Promise<void> {
  if (!entries.length) return;
  const params: unknown[] = [];
  const values = entries
    .map(([hash, vector]) => {
      const b = params.length;
      params.push(model, hash, toVectorLiteral(vector));
      return `($${b + 1}, $${b + 2}, $${b + 3}::vector)`;
    })
    .join(",");
  await db.unsafe(
    `INSERT INTO preview_vectors (model, content_hash, embedding) VALUES ${values}
     ON CONFLICT (model, content_hash) DO UPDATE SET last_used = now()`,
    params,
  );
}

/** Remove the least recently used rows past the cap. Returns how many went. */
export async function evictVectors(db: Db = realSql, max: number = PREVIEW_VECTORS_MAX): Promise<number> {
  const gone = (await db`
    DELETE FROM preview_vectors
     WHERE (model, content_hash) IN (
       SELECT model, content_hash FROM preview_vectors ORDER BY last_used DESC, content_hash OFFSET ${max}
     )
    RETURNING 1
  `) as unknown[];
  return gone.length;
}
