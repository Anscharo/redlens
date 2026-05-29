// Postgres client — Bun's native SQL (no `pg` dependency). One pooled instance
// shared across the process. pgvector values are passed as `[a,b,c]` bracket
// strings with a `::vector` cast appended after the placeholder (see search.ts
// and sync-embeddings.ts).
import { SQL } from "bun";
import { config } from "./config.ts";

export const sql = new SQL(config.databaseUrl);

// Format a number[] as a pgvector literal: [0.1,0.2,…]. Pair with `::vector`.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
