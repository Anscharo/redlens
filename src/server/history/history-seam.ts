import type { SQL } from "bun";

const MIGRATION_COMMIT = "22cc27b5";
const MIGRATION_CHANGE_TYPE = "structural";

type SeamMeta = { seam?: string; extractedFrom?: string };

function seamTuples(entries: [string, SeamMeta][], params: unknown[]) {
  return entries
    .map(([id, meta]) => {
      params.push(id, meta.seam, meta.extractedFrom ?? null);
      return `($${params.length - 2}::uuid, $${params.length - 1}, $${params.length}::uuid)`;
    })
    .join(",");
}

async function applySeam(sql: SQL, sha: string, entries: [string, SeamMeta][]) {
  const params: unknown[] = [sha];
  const values = seamTuples(entries, params);
  const res = await sql.unsafe(
    `UPDATE atlas_history h SET seam = v.seam, extracted_from = COALESCE(v.extracted_from, h.extracted_from)
     FROM (VALUES ${values}) AS v(doc_id, seam, extracted_from)
     WHERE h.doc_id = v.doc_id AND h.commit_sha = $1 AND h.change_type = '${MIGRATION_CHANGE_TYPE}'`,
    params,
  );
  return res.count ?? 0;
}

async function stampUntraced(sql: SQL, sha: string) {
  const rest = await sql.unsafe(
    `UPDATE atlas_history SET seam = 'untraced'
     WHERE commit_sha = $1 AND change_type = '${MIGRATION_CHANGE_TYPE}' AND seam IS NULL`,
    [sha],
  );
  return rest.count ?? 0;
}

/** Stamp each doc's #117 seam verdict onto its migration row from the frozen artifact's docMeta. */
export async function stampMigrationSeam(
  sql: SQL,
  artifact: { meta?: { migrationCommit?: string }; docMeta?: Record<string, SeamMeta> },
  chunkSize = 1000,
): Promise<number> {
  const sha = (artifact.meta?.migrationCommit ?? MIGRATION_COMMIT).slice(0, 7);
  const entries = Object.entries(artifact.docMeta ?? {}).filter((entry): entry is [string, SeamMeta] => !!entry[1]?.seam);
  let stamped = 0;
  for (let i = 0; i < entries.length; i += chunkSize) stamped += await applySeam(sql, sha, entries.slice(i, i + chunkSize));
  return stamped + (await stampUntraced(sql, sha));
}
