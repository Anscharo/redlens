// The SQL side of sync:briefings: the store contract and its real Postgres
// implementation (split from sync-briefings.ts).
import { createHash } from "node:crypto";
import { sql, toVectorLiteral } from "./db.ts";
import { docRowToNode, loadDocMetaSnapshot, type AtlasNode } from "./retrieval/indexes.ts";
import { briefingEmbedText } from "../../scripts/lib/doc-briefings.mjs";

export interface StoredRow {
  doc_id: string;
  briefing: string;
  digest: string;
  context_digest: string;
  failures: number;
  failed_context: string | null;
  briefing_hash: string;
}

/** A row to write whole: a seed row or a worker row. */
export interface BriefingWrite {
  docId: string;
  briefing: string;
  questions: string[];
  digest: string;
  contextDigest: string;
  model: string | null;
}

export interface FailedDoc {
  docId: string;
  digest: string;
  contextDigest: string;
}

export interface ToEmbed {
  doc_id: string;
  briefing: string;
  questions: unknown;
  briefing_hash: string;
}

/** Every SQL statement this tail makes, as small named functions so a test can
 *  replace the database with a fake. */
export interface BriefingStore {
  loadSnapshot(): Promise<{ atlasSha: string | null; docs: AtlasNode[] }>;
  loadSeedHash(): Promise<string | null>;
  loadRows(): Promise<Map<string, StoredRow>>;
  upsertSeed(rows: BriefingWrite[], fileHash: string): Promise<void>;
  upsertWorker(rows: BriefingWrite[]): Promise<void>;
  bumpFailures(docs: FailedDoc[]): Promise<void>;
  loadToEmbed(): Promise<ToEmbed[]>;
  writeVector(docId: string, briefingHash: string, vec: number[]): Promise<void>;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------- the real store

const ROW_COLS = ["doc_id", "briefing", "questions", "digest", "context_digest", "model", "source", "briefing_hash"];

// Manual placeholders, not the ${tx(rows, cols)} bulk helper: `questions` is
// jsonb and needs its own ::jsonb cast, bound as the RAW array (postgres-jsonb
// skill: a pre-stringified value is stored as a jsonb string).
function rowsSql(rows: BriefingWrite[], source: "seed" | "worker"): { values: string; params: unknown[] } {
  const params: unknown[] = [];
  const values = rows
    .map((r) => {
      const b = params.length;
      params.push(
        r.docId,
        r.briefing,
        r.questions,
        r.digest,
        r.contextDigest,
        r.model,
        source,
        sha256(briefingEmbedText(r)),
      );
      return `($${b + 1}::uuid, $${b + 2}, $${b + 3}::jsonb, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
    })
    .join(",");
  return { values, params };
}

type Tx = Pick<typeof sql, "unsafe">;

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

// The vector survives only when the text it was made from did not change.
const SEED_CONFLICT = `ON CONFLICT (doc_id) DO UPDATE SET
  briefing = excluded.briefing, questions = excluded.questions, digest = excluded.digest,
  context_digest = excluded.context_digest, model = excluded.model, source = excluded.source,
  embedding = CASE WHEN excluded.briefing_hash = atlas_doc_briefings.briefing_hash THEN atlas_doc_briefings.embedding ELSE NULL END,
  embedded_hash = CASE WHEN excluded.briefing_hash = atlas_doc_briefings.briefing_hash THEN atlas_doc_briefings.embedded_hash ELSE NULL END,
  briefing_hash = excluded.briefing_hash, failures = 0, failed_context = NULL, updated_at = now()`;

const WORKER_CONFLICT = `ON CONFLICT (doc_id) DO UPDATE SET
  briefing = excluded.briefing, questions = excluded.questions, digest = excluded.digest,
  context_digest = excluded.context_digest, model = excluded.model, source = excluded.source,
  briefing_hash = excluded.briefing_hash, embedding = NULL, embedded_hash = NULL,
  failures = 0, failed_context = NULL, updated_at = now()`;

async function insertRows(tx: Tx, rows: BriefingWrite[], source: "seed" | "worker"): Promise<void> {
  await chunked(rows, 400, async (chunk) => {
    const { values, params } = rowsSql(chunk, source);
    await tx.unsafe(
      `INSERT INTO atlas_doc_briefings (${ROW_COLS.join(", ")}) VALUES ${values} ${source === "seed" ? SEED_CONFLICT : WORKER_CONFLICT}`,
      params,
    );
  });
}

export const realStore: BriefingStore = {
  async loadSnapshot() {
    const { atlasSha, rows } = await loadDocMetaSnapshot(sql);
    return { atlasSha, docs: rows.map(docRowToNode) };
  },

  async loadSeedHash() {
    const rows = (await sql`SELECT briefings_seed_hash FROM sync_state WHERE id = 1`) as {
      briefings_seed_hash: string | null;
    }[];
    return rows[0]?.briefings_seed_hash ?? null;
  },

  async loadRows() {
    const rows = (await sql`
      SELECT doc_id, briefing, digest, context_digest, failures, failed_context, briefing_hash FROM atlas_doc_briefings
    `) as StoredRow[];
    return new Map(rows.map((r) => [r.doc_id, r]));
  },

  // The hash is written in the same transaction as the rows, so a crash halfway
  // leaves the old hash and the next run repeats the whole load.
  async upsertSeed(rows, fileHash) {
    await sql.begin(async (tx) => {
      await insertRows(tx, rows, "seed");
      await tx`UPDATE sync_state SET briefings_seed_hash = ${fileHash} WHERE id = 1`;
    });
  },

  async upsertWorker(rows) {
    await sql.begin((tx) => insertRows(tx, rows, "worker"));
  },

  // The count belongs to the context it was made at: it grows while the live
  // context stays put and restarts at 1 when it moves. A real row keeps its text
  // and its own (stale) context, so it stays queued until the count is spent.
  async bumpFailures(docs) {
    await chunked(docs, 400, async (chunk) => {
      const params: unknown[] = [];
      const values = chunk
        .map((d) => {
          const b = params.length;
          params.push(d.docId, d.digest, d.contextDigest);
          return `($${b + 1}::uuid, '', '[]'::jsonb, $${b + 2}, $${b + 3}, NULL, 'worker', '', 1, $${b + 3})`;
        })
        .join(",");
      await sql.unsafe(
        `INSERT INTO atlas_doc_briefings (doc_id, briefing, questions, digest, context_digest, model, source, briefing_hash, failures, failed_context)
         VALUES ${values}
         ON CONFLICT (doc_id) DO UPDATE SET
           failures = CASE WHEN atlas_doc_briefings.failed_context = excluded.failed_context
                           THEN atlas_doc_briefings.failures + 1 ELSE 1 END,
           failed_context = excluded.failed_context,
           updated_at = now()`,
        params,
      );
    });
  },

  async loadToEmbed() {
    return (await sql`
      SELECT doc_id, briefing, questions, briefing_hash FROM atlas_doc_briefings
      WHERE briefing <> '' AND embedded_hash IS DISTINCT FROM briefing_hash
    `) as ToEmbed[];
  },

  // Guarded on the hash the text was embedded from, so a row rewritten while the
  // slice was in flight is not stamped as embedded.
  async writeVector(docId, briefingHash, vec) {
    await sql`
      UPDATE atlas_doc_briefings SET embedding = ${toVectorLiteral(vec)}::vector, embedded_hash = briefing_hash
      WHERE doc_id = ${docId} AND briefing_hash = ${briefingHash}
    `;
  },
};
