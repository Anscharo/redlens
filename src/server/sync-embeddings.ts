// sync:embeddings — reconcile pgvector embeddings against the atlas. Separate,
// best-effort lane: never blocks structural sync. Incremental by content_hash —
// only new/changed docs are re-embedded; a re-run after a clean sync is a no-op.
//
//   bun src/server/sync-embeddings.ts   # embed all new/changed docs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, toVectorLiteral } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { embedBatch, EMBED_DIM } from "./retrieval/embed.ts";
import type { AtlasNode } from "./retrieval/indexes.ts";
import { buildUnits, foldedIds, GROUP_POLICIES, type GroupPolicy } from "./retrieval/embed-units.ts";

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

  const docsFile = JSON.parse(readFileSync(join(config.publicDir, "docs.json"), "utf8")) as { atlasCommit?: string; nodes: Record<string, AtlasNode> };
  const atlasSha: string = docsFile.atlasCommit ?? "unknown";
  const docs = Object.values(docsFile.nodes);

  const have = new Map<string, string>(
    (await sql`SELECT doc_id, content_hash FROM atlas_doc_embeddings`).map(
      (r: { doc_id: string; content_hash: string }) => [r.doc_id, r.content_hash],
    ),
  );

  const byId = new Map(docs.map((d) => [d.id, d]));

  const policy = (GROUP_POLICIES as readonly string[]).includes(config.embedGroupPolicy)
    ? (config.embedGroupPolicy as GroupPolicy)
    : "one_to_one";
  const cap = config.embedGroupCap && Number.isFinite(config.embedGroupCap) ? config.embedGroupCap : undefined;
  const units = buildUnits(docs, policy, cap !== undefined ? { cap } : {});
  const folded = [...foldedIds(units)];

  // Stable order so progress/restarts are deterministic.
  const queue = units
    .map((u) => {
      const anchor = byId.get(u.anchorId);
      return { id: u.anchorId, doc_no: anchor?.doc_no ?? "", text: u.text, hash: u.hash, memberIds: u.memberIds };
    })
    .filter((q) => have.get(q.id) !== q.hash)
    .sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));

  const total = queue.length;
  console.log(`sync:embeddings — ${docs.length} docs, ${units.length} units (${policy}), ${total} stale/new to embed`);
  if (total === 0) {
    if (folded.length) {
      await sql.unsafe(`DELETE FROM atlas_doc_embeddings WHERE doc_id = ANY($1::uuid[])`, [folded]);
    }
    await sql.end();
    return;
  }

  let done = 0;
  let skipped = 0;
  for (let i = 0; i < total; i += deps.batch) {
    const slice = queue.slice(i, Math.min(i + deps.batch, total));
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
        params.push(s.id, toVectorLiteral(vecs[j]), s.hash, atlasSha, s.memberIds);
        return `($${b + 1}, $${b + 2}::vector, $${b + 3}, $${b + 4}, $${b + 5}::uuid[])`;
      })
      .join(",");
    await sql.unsafe(
      `INSERT INTO atlas_doc_embeddings (doc_id, embedding, content_hash, atlas_sha, member_ids) VALUES ${valuesSql}
       ON CONFLICT (doc_id) DO UPDATE SET
         embedding = excluded.embedding, content_hash = excluded.content_hash, atlas_sha = excluded.atlas_sha, member_ids = excluded.member_ids`,
      params,
    );
    done += slice.length;
    if (done % 500 < deps.batch || done === total) console.log(`  ${done}/${total}`);
  }
  if (folded.length) {
    await sql.unsafe(`DELETE FROM atlas_doc_embeddings WHERE doc_id = ANY($1::uuid[])`, [folded]);
  }
  console.log(
    `sync:embeddings — done (${done} vectors${skipped ? `, ${skipped} skipped (retry next run)` : ""}, atlas ${atlasSha.slice(0, 12)})`,
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
