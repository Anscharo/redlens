// Shared types and helpers for the sync:briefings passes (split from
// sync-briefings.ts): the injected dependencies, the live document view, and
// the deadline-aware retry.
import type { AtlasNode } from "./retrieval/indexes.ts";
import { buildCitations, buildTree, contextDigest } from "../../scripts/lib/doc-briefings.mjs";
import { docDigest } from "../../scripts/lib/mistakes-sweep.mjs";
import type { BriefingStore } from "./briefings-store.ts";

export interface ModelReply {
  content: string;
  finishReason: string | null;
}

export interface BriefingDeps {
  runMigrations: () => Promise<string[]>;
  store: BriefingStore;
  /** The committed seed file's bytes, or null when it is absent. */
  readSeed: () => Buffer | null;
  complete: (system: string, user: string) => Promise<ModelReply>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
  model: string;
  perCycle: number;
  hasApiKey: boolean;
  /** ATLAS_WORKER_NO_FETCH=1: local dev, which must not spend. */
  noFetch: boolean;
  /** Epoch ms after which no new model request starts. */
  deadlineAt: number;
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
  embedBatchSize: number;
}

/** Models wrap JSON Lines in a code fence however they are told not to. */
export function stripFences(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("```"))
    .join("\n")
    .trim();
}

// Retries a model request with backoff, and stops retrying once the deadline has
// passed: the worker kills the whole tail at 11 minutes, and a request started
// after that is only wasted spend.
export async function withDeadlineRetry<T>(fn: () => Promise<T>, attempts: number, deps: BriefingDeps): Promise<T> {
  let lastErr: unknown;
  for (let a = 1; a <= attempts; a++) {
    if (deps.now() > deps.deadlineAt) throw new Error("deadline passed");
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (a < attempts) {
        const delay = 1000 * 2 ** (a - 1);
        console.warn(`  briefing attempt ${a}/${attempts} failed (${(e as Error).message}); retry in ${delay}ms`);
        await deps.sleep(delay);
      }
    }
  }
  throw lastErr;
}

type HashedNode = AtlasNode & { contentHash: string };

export interface Live {
  docs: HashedNode[];
  nodeMap: Record<string, HashedNode>;
  tree: ReturnType<typeof buildTree>;
  citations: ReturnType<typeof buildCitations>;
  digest: Map<string, string>;
  context: Map<string, string>;
}

export function liveView(all: AtlasNode[]): Live {
  // A document with no parser hash cannot be digested: docDigest would hash the
  // string "undefined" and every such document would share one digest. Leave it
  // out of the live set entirely.
  const docs = all.filter((d): d is HashedNode => Boolean(d.contentHash));
  if (docs.length < all.length) {
    console.warn(`sync:briefings — ${all.length - docs.length} documents have no content hash; skipped`);
  }
  const tree = buildTree(docs);
  const citations = buildCitations(docs);
  return {
    docs,
    nodeMap: Object.fromEntries(docs.map((d) => [d.id, d])),
    tree,
    citations,
    digest: new Map(docs.map((d) => [d.id, docDigest(d)])),
    context: new Map(docs.map((d) => [d.id, contextDigest(d, tree, citations)])),
  };
}
