// Whether every stored vector was made by the running model (`EMBED_MODEL`).
//
// After a model change the worker re-embeds row by row, resumably (each row
// records its `embed_model`, migration 038). Until it finishes, a query vector
// from the new model is compared with document vectors from the old one: same
// dimension, no error, and the results are noise. While any row is behind, the
// search bar hides the meaning pill and GET /api/search/semantic answers
// `available: false`. Chat and MCP retrieval do not read this.
//
// The answer latches: the model is fixed for the life of the process, so once
// every row matches it nothing can put one behind again. Until then the check
// reruns at most once a minute (about 20 ms over both tables). A failed check
// keeps the last answer.
import { sql } from "./db.ts";
import { config } from "./config.ts";

export const RECHECK_MS = 60_000;

/** Is any stored vector, unit or briefing, from a model other than `model`? */
async function staleVectorsExist(model: string): Promise<boolean> {
  const rows = await sql`
    SELECT EXISTS (SELECT 1 FROM atlas_doc_embeddings WHERE embed_model IS DISTINCT FROM ${model})
        OR EXISTS (SELECT 1 FROM atlas_doc_briefings WHERE embedding IS NOT NULL AND embed_model IS DISTINCT FROM ${model})
        AS stale`;
  return Boolean(rows[0]?.stale);
}

export interface VectorsCurrent {
  /** The last answer, synchronous so the page can read it at serve time. Starts a recheck when one is due. */
  current(): boolean;
  /** Runs the check now (once at a time) and records the answer. */
  refresh(): Promise<void>;
}

export function createVectorsCurrent(stale: () => Promise<boolean>, now: () => number = Date.now): VectorsCurrent {
  let current = false;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  const refresh = () => {
    inFlight ??= (async () => {
      checkedAt = now();
      try {
        current = !(await stale());
      } catch (err) {
        console.warn(`[vectors-current] check failed: ${(err as Error).message}`);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return {
    current() {
      if (!current && now() - checkedAt >= RECHECK_MS) void refresh();
      return current;
    },
    refresh,
  };
}

export const vectorsCurrent = createVectorsCurrent(() => staleVectorsExist(config.embedModel));
