// Persistent embedding cache for the retrieval eval, so a re-score is offline.
//
//   .cache/eval-vectors.bin       concatenated Float32 rows
//   .cache/eval-vectors.idx.json  { dim, keys: string[] }   (row i = keys[i])
//
// Callers key by `${model}\u0000${sha256 hex of the exact text sent to the API}`.
// The model is in the key because two models' vectors must never meet, and the
// text hash is what the DB's `content_hash` already is for a document.
// Float32 is what the provider returns in effect (Qwen3 output is float32), so
// the round trip costs nothing that mattered.
import fs from "node:fs";
import path from "node:path";

export interface VectorCache {
  get(key: string): number[] | undefined;
  set(key: string, vec: number[]): void;
  has(key: string): boolean;
  readonly size: number;
  /** Writes both files. No-op when nothing was added since open/last save. */
  save(): void;
}

export function openVectorCache(dir = path.resolve(import.meta.dir, "../..", ".cache")): VectorCache {
  const binPath = path.join(dir, "eval-vectors.bin");
  const idxPath = path.join(dir, "eval-vectors.idx.json");
  const rows = new Map<string, number[]>();
  let dim = 0;
  let dirty = false;

  if (fs.existsSync(idxPath) && fs.existsSync(binPath)) {
    const idx = JSON.parse(fs.readFileSync(idxPath, "utf8")) as { dim: number; keys: string[] };
    const buf = fs.readFileSync(binPath);
    if (buf.byteLength !== idx.dim * idx.keys.length * 4) {
      throw new Error(
        `${binPath} holds ${buf.byteLength} bytes but ${idxPath} lists ${idx.keys.length} rows of ${idx.dim} floats; delete both files to rebuild`,
      );
    }
    dim = idx.dim;
    // Copy into an aligned buffer: a Buffer from readFileSync may sit at an odd offset.
    const all = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    idx.keys.forEach((key, i) => rows.set(key, Array.from(all.subarray(i * dim, (i + 1) * dim))));
  }

  return {
    get: (key) => rows.get(key),
    has: (key) => rows.has(key),
    get size() {
      return rows.size;
    },
    set(key, vec) {
      if (dim === 0) dim = vec.length;
      else if (vec.length !== dim) throw new Error(`vector cache holds ${dim}-dim vectors, got ${vec.length} for a new key`);
      rows.set(key, vec);
      dirty = true;
    },
    save() {
      if (!dirty) return;
      const keys = [...rows.keys()];
      const all = new Float32Array(keys.length * dim);
      keys.forEach((k, i) => all.set(rows.get(k)!, i * dim));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(binPath, new Uint8Array(all.buffer));
      fs.writeFileSync(idxPath, JSON.stringify({ dim, keys }));
      dirty = false;
    },
  };
}
