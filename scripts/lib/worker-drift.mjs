// The atlas worker's drift check: everything scripts/required/atlas-worker.mjs
// reads before deciding between the fast-exit and a structural rebuild. This
// module only gathers and logs the readings; the decision stays in the worker.
import { inspectStructuralSnapshot } from "./atlas-sync-health.mjs";

/**
 * Documents with no usable embedding: no 1:1 row at the current content hash,
 * no grouped row, and no membership in someone else's grouped row. A query
 * failure counts as 1 so the fast-exit is not taken on an unreadable table.
 */
function countStaleEmbeddings(db) {
  return db`
    SELECT COUNT(*)::int AS n FROM atlas_doc_meta m
    WHERE NOT EXISTS (
      SELECT 1 FROM atlas_doc_embeddings e
      WHERE e.doc_id = m.id AND (
        (cardinality(COALESCE(e.member_ids, '{}')) <= 1 AND e.content_hash = m.content_hash)
        OR cardinality(COALESCE(e.member_ids, '{}')) > 1
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM atlas_doc_embeddings e
      WHERE cardinality(COALESCE(e.member_ids, '{}')) > 1 AND m.id = ANY(e.member_ids)
    )
  `.then((r) => r[0]?.n ?? 0).catch(() => 1);
}

// Is the SHARED artifact store already populated for the sha we point at?
// sync_state advancing and the artifacts being published are separate events,
// so a pointer match alone does not mean web instances can fetch anything —
// the same reason the structural check exists. Without this, a deploy that
// first ships publishing would find sync_state current, skip the build, and
// never publish until upstream next moved.
// A query error (most likely the artifact-store migration not applied yet — the
// web service migrates at boot, this worker does not) is treated as "populated":
// forcing a rebuild could not fix a missing table, and a rebuild loop every
// tick would be worse than waiting for the web to migrate.
async function probeArtifactsPublished(db, syncState) {
  if (!syncState) return true;
  try {
    const { hasArtifacts } = await import("../../src/server/atlas-artifacts.ts");
    return await hasArtifacts(syncState, db);
  } catch (e) {
    console.warn(`atlas-worker: artifact-store probe skipped — ${e.message}`);
    return true;
  }
}

function logStructural(structural) {
  if (!structural.healthy) {
    console.warn(`atlas-worker: structural integrity failed — ${structural.reasons.join("; ")}`);
  } else {
    console.log(
      `atlas-worker: structural integrity OK — ${structural.currentDocs} docs, ${structural.currentAddresses} addresses`,
    );
  }
}

/**
 * @param {*} db open Bun SQL handle
 * @param {() => Promise<string | null>} readSha upstream SHA probe
 */
export async function readDriftState(db, readSha) {
  const [upstreamSha, syncState, staleCount] = await Promise.all([
    readSha(),
    db`SELECT atlas_sha FROM sync_state WHERE id = 1`.then((r) => r[0]?.atlas_sha ?? null).catch(() => null),
    countStaleEmbeddings(db),
  ]);
  const structural = await inspectStructuralSnapshot(db, syncState);
  const artifactsPublished = await probeArtifactsPublished(db, syncState);
  if (!artifactsPublished) {
    console.warn(
      `atlas-worker: artifact store has nothing for ${(syncState ?? "").slice(0, 12)} — building to publish it`,
    );
  }
  logStructural(structural);
  return { upstreamSha, syncState, staleCount, structural, artifactsPublished };
}

/** Logged on the rebuild path, once the fast-exit has been ruled out. */
export function logRebuildReason({ upstreamSha, syncState, staleCount }) {
  if (!upstreamSha) {
    console.warn("atlas-worker: could not read upstream SHA — proceeding anyway");
  } else {
    console.log(
      `atlas-worker: upstream=${upstreamSha.slice(0, 12)} db=${(syncState ?? "none").slice(0, 12)} staleEmbeds=${staleCount}`,
    );
  }
}
