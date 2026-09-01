// sync:embeddings — reconcile pgvector embeddings against the atlas. Separate,
// best-effort lane: never blocks structural sync. Incremental by content_hash
// AND grouping metadata (attribution_only / member_ids): only new/changed docs
// are re-embedded; a policy switch that keeps a folded member's 1:1 hash still
// UPDATEs the flags so those rows stop competing in search. A re-run after a
// clean sync is a no-op.
//
//   bun src/server/sync-embeddings.ts   # embed all new/changed docs
import { sql, toVectorLiteral, toUuidArrayLiteral } from "./db.ts";
import { fromUuidArray } from "./pg-array.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { embedBatch, EMBED_DIM } from "./retrieval/embed.ts";
import { docRowToNode, type DocMetaRow } from "./retrieval/indexes.ts";
import { buildUnits, foldedIds, GROUP_POLICIES, type EmbedUnit, type GroupPolicy } from "./retrieval/embed-units.ts";
import { buildEmbedText, contentHash } from "./retrieval/embed-text.ts";

interface HaveRow {
  hash: string;
  attributionOnly: boolean;
  memberIds: unknown;
}

interface WantedRow {
  id: string;
  doc_no: string;
  text: string;
  hash: string;
  memberIds: string[];
  attributionOnly: boolean;
}

// Empty uuid[] is the column default and means "this row is itself" (migration 022).
//
// Set comparison, not positional: member_ids records WHICH docs a vector covers,
// and nothing downstream reads it as a sequence — search.ts hands it to
// `doc_id = ANY(...)` and pickLeaf re-sorts by score. Comparing positionally
// would make a harmless reordering inside buildUnits look like drift and rewrite
// every grouped row for nothing.
function memberIdsEqual(docId: string, stored: unknown, expected: readonly string[]): boolean {
  const parsed = fromUuidArray(stored);
  const have = parsed.length === 0 ? [docId] : parsed;
  if (have.length !== expected.length) return false;
  const wanted = new Set(expected);
  // Set sizes too, so a duplicated id can't pass an equal-length subset check.
  return new Set(have).size === wanted.size && have.every((id) => wanted.has(id));
}

// Folded members stay searchable until their grouped anchor vector actually
// exists: flipping attribution_only first would hide them while search still
// has the old 1:1 parent. Owner-ready = upserted this run, or already stored
// at the grouped unit's hash (a previous run embedded the anchor).
function groupingAnchorReady(
  memberId: string,
  units: EmbedUnit[],
  have: Map<string, HaveRow>,
  upserted: Set<string>,
): boolean {
  for (const u of units) {
    if (u.anchorId === memberId || !u.memberIds.includes(memberId)) continue;
    if (upserted.has(u.anchorId)) return true;
    const h = have.get(u.anchorId);
    if (h && h.hash === u.hash) return true;
  }
  return false;
}

// Per-request embedding batch size (how many texts per OpenRouter call). There
// is no total cap: the content_hash diff already bounds each run to new/changed
// docs, so we always embed the whole stale set. Exported (rather than a bare
// module constant) so a test can assert the env parsing directly.
export function batchSizeFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.EMBED_BATCH ?? 50);
}

// Retry transient embedding failures (flaky OpenRouter) with exponential backoff.
// Per-batch upserts mean partial progress already persists; a batch that still
// fails after retries is skipped (stays stale, retried next run) rather than
// aborting the whole reconcile. See docs/plans/atlas-runtime-freshness-inprocess.md.
// `sleep` is injectable purely as a test seam (mirrors db.ts's waitForDb) so a
// test can assert the retry count/backoff schedule without burning the real
// multi-second exponential-backoff wall clock.
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  let lastErr: unknown;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (a < attempts) {
        const delay = 1000 * 2 ** (a - 1);
        console.warn(`  embed attempt ${a}/${attempts} failed (${(e as Error).message}); retry in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// Injected so main() is testable without a real Postgres connection, real
// OpenRouter calls, or the real backoff wall clock — mirrors preview/build.ts's
// BuildDeps/realBuildDeps. `sql` stays OUT of this seam and a direct top-of-file
// import: every DB-touching *.test.ts in this codebase fakes it via
// mock.module("./db.ts", …) instead (see db.test.ts / migrate.test.ts).
export interface EmbedDeps {
  runMigrations: () => Promise<string[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
  batch: number;
  sleep: (ms: number) => Promise<unknown>;
}
const realEmbedDeps: EmbedDeps = {
  runMigrations,
  embedBatch: (texts) => embedBatch(texts),
  batch: batchSizeFromEnv(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export async function main(deps: EmbedDeps = realEmbedDeps) {
  await deps.runMigrations();

  // Guard: the EMBED_DIM code constant must match the column's fixed dimension
  // (both are locked to the migration). A mismatch would make every INSERT fail
  // (or query-time `<=>` fail) deep in the run — fail fast and clearly instead.
  const colRows = (await sql.unsafe(
    `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
     WHERE attrelid = 'atlas_doc_embeddings'::regclass AND attname = 'embedding'`,
  )) as { t: string }[];
  const colDim = Number(colRows[0]?.t?.match(/vector\((\d+)\)/)?.[1]);
  if (colDim && colDim !== EMBED_DIM) {
    throw new Error(
      `EMBED_DIM=${EMBED_DIM} (embed.ts) but atlas_doc_embeddings.embedding is vector(${colDim}). ` +
        `Update EMBED_DIM to ${colDim} or add a migration to change the column dimension.`,
    );
  }

  // Docs come from atlas_doc_meta, NOT public/docs.json: the worker's fast-exit
  // path runs this reconcile in a fresh container where no build produced disk
  // artifacts, so the file read crashed every fast-exit cron run with ENOENT
  // (2026-09-01) and the reconcile only ever ran after full builds. The DB is
  // the snapshot sync.ts just verified anyway — same read (and row shape) the
  // web updater's refresh-from-store uses, so the two can't drift.
  const [state] = (await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`) as { atlas_sha?: string }[];
  const atlasSha: string = state?.atlas_sha ?? "unknown";
  const docRows = (await sql`
    SELECT id, doc_no, title, type, depth,
           parent_id AS "parentId", content, ord AS "order",
           node_content_hash AS "contentHash", address_refs AS "addressRefs"
    FROM atlas_doc_meta ORDER BY ord
  `) as unknown as DocMetaRow[];
  const docs = docRows.map(docRowToNode);
  // An unsynced DB is a precondition failure, not "nothing stale": embedding
  // zero docs would report a clean no-op while search stays vectorless.
  if (docs.length === 0) {
    console.warn("sync:embeddings — atlas_doc_meta is empty (structural sync has not run); skipping");
    await sql.end();
    return;
  }

  const have = new Map<string, HaveRow>(
    (
      await sql`SELECT doc_id, content_hash, attribution_only, member_ids FROM atlas_doc_embeddings`
    ).map((r: { doc_id: string; content_hash: string; attribution_only: boolean; member_ids: unknown }) => [
      r.doc_id,
      { hash: r.content_hash, attributionOnly: Boolean(r.attribution_only), memberIds: r.member_ids },
    ]),
  );

  const byId = new Map(docs.map((d) => [d.id, d]));

  const policy = (GROUP_POLICIES as readonly string[]).includes(config.embedGroupPolicy)
    ? (config.embedGroupPolicy as GroupPolicy)
    : "one_to_one";
  // No opts: cap and crumb depth/root were env knobs that measured as no-ops and
  // were removed. Policies carry their own defaults (kv_records_breadcrumbs keeps the
  // root crumb internally because that one IS load-bearing — without it 13 units come
  // out byte-identical to another, i.e. duplicate vectors nothing can rank apart).
  const units = buildUnits(docs, policy, {});
  const folded = [...foldedIds(units)];
  // Folded members used to be DELETED. They are now embedded 1:1 and stored with
  // attribution_only = true (migration 023): excluded from search, read only to decide
  // WHICH member of an already-retrieved group a query wanted. That step was measured
  // at 34% accurate with term overlap vs ~51% against vectors, and is the single
  // largest loss in the pipeline — retrieval finds the right group for essentially
  // every ICD query and attribution throws two thirds of them away.
  const foldedSet = new Set(folded);
  const attributionUnits: WantedRow[] = folded
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => ({
      id: d.id,
      doc_no: d.doc_no,
      text: buildEmbedText(d),
      hash: contentHash(d),
      memberIds: [d.id],
      attributionOnly: true,
    }));

  // Folded members keep contentHash(d) — the same 1:1 hash they had before
  // grouping — so a policy switch (one_to_one → icd_params) is invisible to a
  // hash-only stale check. Those rows still need attribution_only / member_ids
  // written or they keep competing in search.ts's WHERE NOT attribution_only.
  const wanted: WantedRow[] = units
    .map((u) => {
      const anchor = byId.get(u.anchorId);
      return {
        id: u.anchorId,
        doc_no: anchor?.doc_no ?? "",
        text: u.text,
        hash: u.hash,
        memberIds: u.memberIds,
        attributionOnly: foldedSet.has(u.anchorId),
      };
    })
    .concat(attributionUnits);

  const byDocNo = (a: WantedRow, b: WantedRow) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true });
  const toEmbed = wanted.filter((q) => {
    const h = have.get(q.id);
    return !h || h.hash !== q.hash;
  }).sort(byDocNo);
  const toMeta = wanted.filter((q) => {
    const h = have.get(q.id);
    if (!h || h.hash !== q.hash) return false;
    return h.attributionOnly !== q.attributionOnly || !memberIdsEqual(q.id, h.memberIds, q.memberIds);
  }).sort(byDocNo);

  const total = toEmbed.length;
  console.log(
    `sync:embeddings — ${docs.length} docs, ${units.length} units (${policy}), ${total} stale/new to embed, ${toMeta.length} grouping metadata`,
  );
  if (total === 0 && toMeta.length === 0) {
    await sql.end();
    return;
  }

  let done = 0;
  let skipped = 0;
  const upserted = new Set<string>();
  for (let i = 0; i < total; i += deps.batch) {
    const slice = toEmbed.slice(i, Math.min(i + deps.batch, total));
    let vecs: number[][];
    try {
      vecs = await withRetry(() => deps.embedBatch(slice.map((s) => s.text)), 3, deps.sleep);
    } catch (e) {
      skipped += slice.length;
      console.warn(`  batch @${i} (${slice.length} docs) failed after retries: ${(e as Error).message} — skipping; retried next run`);
      continue;
    }
    if (done === 0 && vecs[0]) console.log(`  vector dim from provider: ${vecs[0].length}`);

    const params: unknown[] = [];
    const valuesSql = slice
      .map((s, j) => {
        const b = params.length;
        params.push(s.id, toVectorLiteral(vecs[j]), s.hash, atlasSha, toUuidArrayLiteral(s.memberIds), s.attributionOnly);
        return `($${b + 1}, $${b + 2}::vector, $${b + 3}, $${b + 4}, $${b + 5}::uuid[], $${b + 6})`;
      })
      .join(",");
    await sql.unsafe(
      `INSERT INTO atlas_doc_embeddings (doc_id, embedding, content_hash, atlas_sha, member_ids, attribution_only) VALUES ${valuesSql}
       ON CONFLICT (doc_id) DO UPDATE SET
         embedding = excluded.embedding, content_hash = excluded.content_hash, atlas_sha = excluded.atlas_sha,
         member_ids = excluded.member_ids, attribution_only = excluded.attribution_only`,
      params,
    );
    done += slice.length;
    for (const s of slice) upserted.add(s.id);
    if (done % 500 < deps.batch || done === total) console.log(`  ${done}/${total}`);
  }

  // Embed grouped anchors BEFORE hiding folded 1:1 rows. A failed parent embed
  // must not flip children to attribution_only or they vanish from search while
  // the parent still has its old 1:1 vector.
  const metaNow = toMeta.filter((q) => !q.attributionOnly || groupingAnchorReady(q.id, units, have, upserted));
  if (metaNow.length) {
    const params: unknown[] = [];
    const valuesSql = metaNow
      .map((s) => {
        const b = params.length;
        params.push(s.id, atlasSha, toUuidArrayLiteral(s.memberIds), s.attributionOnly);
        // doc_id MUST be cast: an uncast parameter in a VALUES list is inferred as
        // text, and the join below then compares uuid = text — "operator does not
        // exist: uuid = text". Every column in a VALUES row needs its own type.
        return `($${b + 1}::uuid, $${b + 2}, $${b + 3}::uuid[], $${b + 4}::boolean)`;
      })
      .join(",");
    await sql.unsafe(
      `UPDATE atlas_doc_embeddings AS e SET
         atlas_sha = v.atlas_sha, member_ids = v.member_ids, attribution_only = v.attribution_only
       FROM (VALUES ${valuesSql}) AS v(doc_id, atlas_sha, member_ids, attribution_only)
       WHERE e.doc_id = v.doc_id`,
      params,
    );
  }

  const metaNote = metaNow.length ? `, ${metaNow.length} metadata` : "";
  console.log(
    `sync:embeddings — done (${done} vectors${skipped ? `, ${skipped} skipped (retry next run)` : ""}${metaNote}, atlas ${atlasSha.slice(0, 12)})`,
  );
  await sql.end();
}

// Only run when launched directly (`bun src/server/sync-embeddings.ts`) — every
// caller (package.json sync:embeddings, atlas-worker.mjs, atlas-updater.ts's
// boot-embeddings spawn) shells out to this file as a subprocess rather than
// importing it, but without this guard a plain `import "./sync-embeddings.ts"`
// (e.g. from a test) would kick off a real DB + OpenRouter run as a side effect
// of module load.
if (import.meta.main) {
  await main();
}
