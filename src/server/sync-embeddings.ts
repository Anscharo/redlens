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
import { buildEmbedText, contentHash } from "./embed-text.ts";
import { embedBatch, EMBED_DIM } from "./embed.ts";
import type { AtlasNode } from "./indexes.ts";

// Per-request embedding batch size (how many texts per OpenRouter call). There
// is no total cap: the content_hash diff already bounds each run to new/changed
// docs, so we always embed the whole stale set.
const BATCH = Number(process.env.EMBED_BATCH ?? 50);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry transient embedding failures (flaky OpenRouter) with exponential backoff.
// Per-batch upserts mean partial progress already persists; a batch that still
// fails after retries is skipped (stays stale, retried next run) rather than
// aborting the whole reconcile. See docs/plans/atlas-runtime-freshness-inprocess.md.
async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
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

async function main() {
  await runMigrations();

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

  const manifest = JSON.parse(readFileSync(join(config.publicDir, "manifest.json"), "utf8"));
  const atlasSha: string = manifest.atlasCommit ?? "unknown";

  const docs = Object.values(
    JSON.parse(readFileSync(join(config.publicDir, "docs.json"), "utf8")) as Record<string, AtlasNode>,
  );

  const have = new Map<string, string>(
    (await sql`SELECT doc_id, content_hash FROM atlas_doc_embeddings`).map(
      (r: { doc_id: string; content_hash: string }) => [r.doc_id, r.content_hash],
    ),
  );

  // Stable order so progress/restarts are deterministic.
  const queue = docs
    .map((d) => ({ id: d.id, doc_no: d.doc_no, text: buildEmbedText(d), hash: contentHash(d) }))
    .filter((q) => have.get(q.id) !== q.hash)
    .sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));

  const total = queue.length;
  console.log(`sync:embeddings — ${docs.length} docs, ${total} stale/new to embed`);
  if (total === 0) {
    await sql.end();
    return;
  }

  let done = 0;
  let skipped = 0;
  for (let i = 0; i < total; i += BATCH) {
    const slice = queue.slice(i, Math.min(i + BATCH, total));
    let vecs: number[][];
    try {
      vecs = await withRetry(() => embedBatch(slice.map((s) => s.text)), 3);
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
        params.push(s.id, toVectorLiteral(vecs[j]), s.hash, atlasSha);
        return `($${b + 1}, $${b + 2}::vector, $${b + 3}, $${b + 4})`;
      })
      .join(",");
    await sql.unsafe(
      `INSERT INTO atlas_doc_embeddings (doc_id, embedding, content_hash, atlas_sha) VALUES ${valuesSql}
       ON CONFLICT (doc_id) DO UPDATE SET
         embedding = excluded.embedding, content_hash = excluded.content_hash, atlas_sha = excluded.atlas_sha`,
      params,
    );
    done += slice.length;
    if (done % 500 < BATCH || done === total) console.log(`  ${done}/${total}`);
  }
  console.log(
    `sync:embeddings — done (${done} vectors${skipped ? `, ${skipped} skipped (retry next run)` : ""}, atlas ${atlasSha.slice(0, 12)})`,
  );
  await sql.end();
}

await main();
