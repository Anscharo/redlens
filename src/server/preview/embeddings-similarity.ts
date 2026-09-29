// The identity gate's similarity: for each retitled document the gate would
// judge by meaning, the cosine of its old and new vector. The gate itself
// (identity.ts) is pure; this is the IO it is handed.

import { buildEmbedText, contentHash } from "../retrieval/embed-text.ts";
import { withDeadline } from "../jev.ts";
import { resolve, type PreviewVectors } from "./embeddings-store.ts";
import { wantsSimilarity, type BodySimilarity } from "./identity.ts";
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

// The identity gate's own lookups, per reference snapshot. They run after the
// build lane's budget (embeddings.ts BUDGET_MS) has ended, on the build's
// critical path, and the provider client has no timeout of its own.
const SIMILARITY_BUDGET_MS = 20_000;

const embedText = (d: SnapshotDoc) => buildEmbedText({ title: d.title ?? "", content: d.content ?? "" });

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i]; // both are unit vectors
  return d;
}

/**
 * The identity gate's similarity for one (reference, head) pair of snapshots:
 * for each retitled document the gate would judge by meaning, the cosine of
 * its old and new vector. Resolves to undefined when there is nothing to
 * score or the vectors cannot be had.
 *
 * The NEW side is a row this build already embedded. The OLD side is found in
 * the live store by content hash; a base that is behind live main holds text
 * the store has moved past, and those few documents are embedded here.
 */
export async function bodySimilarity(reference: Snapshot, head: Snapshot, pv: PreviewVectors): Promise<BodySimilarity | undefined> {
  // Its own deadline: the build lane's has passed. Once a budget is spent the
  // signal starts out aborted, so the live store is still read and the
  // provider is not asked.
  const signal = pv.spent ? AbortSignal.abort() : withDeadline(SIMILARITY_BUDGET_MS, pv.outer);
  try {
    const pairs: { id: string; oldHash: string; newHash: string }[] = [];
    const texts = new Map<string, string>();
    for (const [id, now] of head) {
      const was = reference.get(id);
      // A document stored as a group has no vector of its own to compare.
      if (!was || !pv.plain.has(id) || !wantsSimilarity(was, now)) continue;
      const oldText = embedText(was), newText = embedText(now);
      const pair = { id, oldHash: contentHash({ title: was.title ?? "", content: was.content ?? "" }), newHash: contentHash({ title: now.title ?? "", content: now.content ?? "" }) };
      texts.set(pair.oldHash, oldText).set(pair.newHash, newText);
      pairs.push(pair);
    }
    if (!pairs.length) return undefined;
    await resolve(texts, pv, signal);
    if (signal.aborted && !pv.outer?.aborted) pv.spent = true;
    const scores = new Map<string, number>();
    for (const p of pairs) {
      const a = pv.byHash.get(p.oldHash), b = pv.byHash.get(p.newHash);
      if (a && b) scores.set(p.id, cosine(a, b));
    }
    return scores.size ? (id) => scores.get(id) : undefined;
  } catch (e) {
    console.warn(`[preview] identity similarity skipped (${(e as Error).message})`);
    return undefined;
  }
}
