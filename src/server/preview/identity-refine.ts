// The identity gate's verdict BY MEANING, made after the preview is ready.
//
// A preview build must not wait on the embedding provider, so diff.json holds
// the gate's verdict by lines and words and the build ends there. This lane
// runs afterwards: it makes the preview's vectors, judges each retitled
// document of four lines or more by the cosine of its old and new vector, and
// writes the whole verdict to identity.json (identity.<key>.json for each diff
// base). The reader loads that file once the page is up and replaces the
// warnings diff.json gave it.
//
// The file holds the WHOLE verdict, not only what changed: a document the
// vector spares must be able to lose its mark, which a list of additions
// could not express.
//
// Best effort. With no API key or a failed provider no file is written, the
// handler answers 404, and the reader keeps what diff.json said.

import fs from "node:fs";
import path from "node:path";
import { buildPreviewEmbeddings, bodySimilarity, realVectorDeps, type VectorDeps } from "./embeddings.ts";
import { detectIdentitySwaps, type FormerUuid, type IdentitySwap } from "./identity.ts";
import type { Snapshot } from "./snapshot.ts";

/** One diff the build wrote, and what judging it again needs. `files` are the
 *  names to write the verdict under: the keyed one, and identity.json as well
 *  when this is the `auto` diff. */
export interface RefineJob {
  files: string[];
  reference: Snapshot;
  head: Snapshot;
  added: string[];
  changed: string[];
}

export const refineJob = (files: string[], reference: Snapshot, head: Snapshot, diff: { added: string[]; changed: string[] }): RefineJob => ({
  files,
  reference,
  head,
  added: diff.added,
  changed: diff.changed,
});

export interface IdentityJson {
  identitySwap: Record<string, IdentitySwap>;
  formerUuid: Record<string, FormerUuid>;
}

export const IDENTITY_FILES = ["identity.json", "identity.sky.json", "identity.repo.json"] as const;

/** Make the vectors, judge every job, write its files. Resolves when done,
 *  whatever happened; `signal` ends it early (the bundle is being rebuilt). */
export async function refineIdentity(outDir: string, jobs: RefineJob[], signal?: AbortSignal, deps: VectorDeps = realVectorDeps): Promise<void> {
  const vectors = await buildPreviewEmbeddings(outDir, deps, signal);
  if (!vectors) return;
  for (const job of jobs) {
    const similarity = await bodySimilarity(job.reference, job.head, vectors);
    const verdict: IdentityJson = detectIdentitySwaps({ changed: job.changed, added: job.added, mainById: job.reference, previewById: job.head, similarity });
    // The bundle may have been evicted or rebuilt while the provider answered.
    if (signal?.aborted || !fs.existsSync(outDir)) return;
    for (const name of job.files) fs.writeFileSync(path.join(outDir, name), JSON.stringify(verdict));
  }
}

// ---- the lane's lifetime ----------------------------------------------------
// One lane for each bundle, started when its build is ready. The handler asks
// isRefining to tell "not written YET" (202) from "will not be written" (404).

const pending = new Map<string, AbortController>();

export const isRefining = (sha: string): boolean => pending.has(sha);

export function stopRefine(sha: string): void {
  pending.get(sha)?.abort();
  pending.delete(sha);
}

/** Start the lane, detached from the build that calls it. Never rejects. */
export function startRefine(sha: string, outDir: string, jobs: RefineJob[], run: (outDir: string, jobs: RefineJob[], signal?: AbortSignal) => Promise<void> = refineIdentity): Promise<void> {
  stopRefine(sha);
  if (!jobs.length) return Promise.resolve();
  const abort = new AbortController();
  pending.set(sha, abort);
  return Promise.resolve()
    .then(() => run(outDir, jobs, abort.signal))
    .catch((e) => console.warn(`[preview] ${sha.slice(0, 8)}: identity verdict by meaning skipped (${(e as Error).message})`))
    .finally(() => {
      if (pending.get(sha) === abort) pending.delete(sha);
    });
}
