// A disk-backed vector cache for the eval rigs, seeded from production.
//
// Keys are namespaced so a document vector and a query vector for the same text
// can never collide: `H\0<sha256 of embed text>` for documents and unit texts,
// which is exactly `atlas_doc_embeddings.content_hash`, and `Q\0<raw text>` for
// query vectors (the prefix is applied inside embedQuery, so a query vector
// embedded without the instruction prefix is not comparable to one embedded with
// it). The content_hash namespace is what lets a run seed from the DB and then
// embed only the texts production does not already store.
import fs from "node:fs";
import path from "node:path";
import { embedBatch } from "../../src/server/retrieval/embed.ts";

const BATCH = 50;

export interface VectorCache {
  /** key → vector. Read directly; `seedFromDb` and `fill` populate it. */
  vecs: Record<string, number[]>;
  /** Copies every distinct stored vector in, keyed by content_hash. Returns how
   *  many rows it read, or 0 without a DATABASE_URL. */
  seedFromDb(): Promise<number>;
  /** Embeds the keys that are still missing. `dryRun` reports the cost instead. */
  fill(keys: Map<string, string>, dryRun?: boolean): Promise<void>;
  /** Writes the cache back to disk, creating its directory. */
  save(): void;
}

export function openVectorCache(cachePath: string): VectorCache {
  const vecs: Record<string, number[]> = fs.existsSync(cachePath)
    ? (JSON.parse(fs.readFileSync(cachePath, "utf8")) as Record<string, number[]>)
    : {};

  async function seedFromDb(): Promise<number> {
    if (!process.env.DATABASE_URL) return 0;
    const { SQL } = await import("bun");
    const sql = new SQL({ url: process.env.DATABASE_URL, max: 2 });
    try {
      const rows = (await sql`SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding
                                FROM atlas_doc_embeddings`) as { content_hash: string; embedding: string }[];
      for (const r of rows) {
        const key = `H\u0000${r.content_hash}`;
        if (!vecs[key]) vecs[key] = r.embedding.replace(/^\[|\]$/g, "").split(",").map(Number);
      }
      return rows.length;
    } finally {
      await sql.end();
    }
  }

  async function fill(keys: Map<string, string>, dryRun = false): Promise<void> {
    const missing = [...keys].filter(([k]) => !vecs[k]);
    if (missing.length === 0) return;
    if (dryRun) {
      const chars = missing.reduce((n, [, t]) => n + t.length, 0);
      console.log(`--dry-run: would embed ${missing.length} texts (${chars} chars, ${Math.ceil(missing.length / BATCH)} batches)`);
      return;
    }
    console.log(`embedding ${missing.length} missing vectors…`);
    for (let i = 0; i < missing.length; i += BATCH) {
      const slice = missing.slice(i, i + BATCH);
      const out = await embedBatch(slice.map(([, text]) => text));
      slice.forEach(([k], j) => { vecs[k] = out[j]!; });
      console.log(`  ${Math.min(i + BATCH, missing.length)}/${missing.length}`);
    }
  }

  return {
    vecs,
    seedFromDb,
    fill,
    save() {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(vecs));
    },
  };
}

/** Cosine of two vectors the cache already normalised. */
export function cos(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}
