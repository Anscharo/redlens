// sync:briefings — the fourth post-sync tail (beside embeddings, history and doc
// versions). A briefing is a short placement-aware description of an atlas
// document plus two or three questions it answers, embedded as a second vector
// per document (docs/plans/atlas-doc-briefings.md). Three passes, in order, each
// writing as it goes so a killed run keeps what it finished:
//
//   1. seed   load public/doc-briefings.json when its hash changed, never over a
//             row the worker wrote for a newer version of the document
//   2. write  ask a model for briefings for new and changed documents, capped per
//             cycle (config.briefingsPerCycle); off when no model is configured
//   3. embed  vectors for every row whose text changed
//
//   bun src/server/sync-briefings.ts   # all three
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, toVectorLiteral } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { embedBatch } from "./retrieval/embed.ts";
import { docRowToNode, loadDocMetaSnapshot, type AtlasNode } from "./retrieval/indexes.ts";
import { getClient } from "./chat/llm.ts";
import { shutdownPosthog } from "./posthog-node.ts";
import {
  BRIEFING_MAX_FAILURES,
  BRIEFING_REPLY_INSTRUCTIONS,
  briefingEmbedText,
  briefingQueue,
  buildCitations,
  buildTree,
  contextDigest,
  packSets,
  parseRows,
  renderQueue,
  seedAction,
  validateBriefing,
} from "../../scripts/lib/doc-briefings.mjs";
import { docDigest } from "../../scripts/lib/mistakes-sweep.mjs";

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

// One run at a time, across callers (the worker tail, dev-preflight, a hand run).
// Arbitrary fixed key like the others: migrate.ts 4711_2026, diff-base-backfill.ts
// 4711_2033, sync-embeddings.ts 4711_2042. All that matters is that they differ.
const BRIEFINGS_LOCK_KEY = 4711_2051;

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

// ------------------------------------------------------------ pure helpers

/** Models wrap JSON Lines in a code fence however they are told not to. */
export function stripFences(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("```"))
    .join("\n")
    .trim();
}

/** The questions column as an array, whatever the driver handed back. */
function questionsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((q): q is string => typeof q === "string");
  if (typeof raw === "string") {
    try {
      return questionsOf(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

// Retries a model request with backoff, and stops retrying once the deadline has
// passed: the worker kills the whole tail at 11 minutes, and a request started
// after that is only wasted spend.
async function withDeadlineRetry<T>(fn: () => Promise<T>, attempts: number, deps: BriefingDeps): Promise<T> {
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

// -------------------------------------------------------------- the three passes

type HashedNode = AtlasNode & { contentHash: string };

export interface Live {
  docs: HashedNode[];
  nodeMap: Record<string, HashedNode>;
  tree: ReturnType<typeof buildTree>;
  citations: ReturnType<typeof buildCitations>;
  digest: Map<string, string>;
  context: Map<string, string>;
}

function liveView(all: AtlasNode[]): Live {
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

interface SeedRow {
  briefing: string;
  questions?: string[];
  digest: string;
  model?: string | null;
}

/** B1. Returns the number of rows written, or null when the pass was skipped. */
export async function seedPass(deps: BriefingDeps, live: Live): Promise<number | null> {
  const bytes = deps.readSeed();
  if (!bytes) {
    console.log("sync:briefings — no public/doc-briefings.json; seed skipped");
    return null;
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  if (fileHash === (await deps.store.loadSeedHash())) {
    console.log("sync:briefings — seed file unchanged; seed skipped");
    return null;
  }
  const seed = (JSON.parse(bytes.toString("utf8")) as { briefings?: Record<string, SeedRow> }).briefings ?? {};
  const have = await deps.store.loadRows();
  const writes: BriefingWrite[] = [];
  let dropped = 0;
  for (const [uuid, row] of Object.entries(seed)) {
    const action = seedAction(have.get(uuid), row, live.digest.get(uuid));
    if (action === "skip") dropped++;
    if (action !== "insert" && action !== "replace") continue;
    writes.push({
      docId: uuid,
      briefing: row.briefing,
      questions: row.questions ?? [],
      digest: row.digest,
      // A seed written for an older version of the document must not look
      // current, or the write pass would never refresh it.
      contextDigest: row.digest === live.digest.get(uuid) ? live.context.get(uuid)! : "",
      model: row.model ?? null,
    });
  }
  await deps.store.upsertSeed(writes, fileHash);
  console.log(`sync:briefings — seed: ${writes.length} rows written, ${dropped} for documents no longer live`);
  return writes.length;
}

interface WriteStats {
  queued: number;
  chunks: number;
  briefed: number;
  failed: number;
}

/** B2. */
export async function writePass(deps: BriefingDeps, live: Live): Promise<WriteStats | null> {
  const off =
    !deps.model ? "no BRIEFING_MODEL"
    : deps.perCycle === 0 ? "BRIEFINGS_PER_CYCLE=0"
    : !deps.hasApiKey ? "no OPENROUTER_API_KEY"
    : deps.noFetch ? "ATLAS_WORKER_NO_FETCH=1"
    : null;
  if (off) {
    console.log(`sync:briefings — write pass off (${off})`);
    return null;
  }

  const rows = await deps.store.loadRows();
  const queue = briefingQueue(live.docs, rows, deps.perCycle, { tree: live.tree, citations: live.citations });
  const chunks = packSets(renderQueue(live.docs, queue, { tree: live.tree, citations: live.citations }), {
    maxBytes: 40_000,
    maxRows: 80,
  });
  const stats: WriteStats = { queued: queue.length, chunks: chunks.length, briefed: 0, failed: 0 };

  const runChunk = async (chunk: (typeof chunks)[number], n: number) => {
    if (deps.now() > deps.deadlineAt) {
      console.warn(`  chunk ${n}: deadline passed before it started; left for the next cycle`);
      return;
    }
    const requested = new Set<string>(chunk.docs);
    let reply: ModelReply;
    try {
      reply = await withDeadlineRetry(
        () => deps.complete(BRIEFING_REPLY_INSTRUCTIONS, chunk.texts.join("\n\n---\n\n")),
        3,
        deps,
      );
    } catch (e) {
      console.warn(`  chunk ${n}: request failed (${(e as Error).message}); no document touched`);
      return;
    }
    // A truncated or unreadable reply says nothing about the documents in it, so
    // it counts against none of them.
    const text = stripFences(reply.content);
    const parsed = reply.finishReason === "length" || !text ? null : parseRows(text);
    if (!parsed) {
      console.warn(`  chunk ${n}: reply was ${reply.finishReason === "length" ? "cut off" : "not JSON Lines"}; no document touched`);
      return;
    }

    const good = new Map<string, BriefingWrite>();
    for (const row of parsed) {
      const v = validateBriefing(row, live.nodeMap, requested);
      if (!v.ok) {
        console.warn(`  chunk ${n}: ${v.reason}`);
        continue;
      }
      if (good.has(v.uuid)) continue;
      good.set(v.uuid, {
        docId: v.uuid,
        briefing: v.entry.briefing,
        questions: v.entry.questions,
        digest: live.digest.get(v.uuid)!,
        contextDigest: live.context.get(v.uuid)!,
        model: deps.model,
      });
    }
    const missing = chunk.docs.filter((id: string) => !good.has(id));
    if (good.size) await deps.store.upsertWorker([...good.values()]);
    if (missing.length) {
      await deps.store.bumpFailures(
        missing.map((id: string) => ({ docId: id, digest: live.digest.get(id)!, contextDigest: live.context.get(id)! })),
      );
    }
    stats.briefed += good.size;
    stats.failed += missing.length;
  };

  await Promise.allSettled(chunks.map((c, i) => runChunk(c, i + 1)));

  const exhausted = [...(await deps.store.loadRows()).values()].filter(
    (r) => r.failures >= BRIEFING_MAX_FAILURES && r.failed_context === live.context.get(r.doc_id),
  ).length;
  if (exhausted > 0) console.warn(`[drift] briefings: ${exhausted} documents failed validation ${BRIEFING_MAX_FAILURES} times`);
  console.log(
    `sync:briefings — write: ${stats.queued} queued, ${stats.chunks} chunks, ${stats.briefed} briefed, ${stats.failed} failed`,
  );
  return stats;
}

/** B3. Returns the number of vectors written. */
export async function embedPass(deps: BriefingDeps, live: Live): Promise<number> {
  const order = new Map(live.docs.map((d, i) => [d.id, i]));
  const stale = (await deps.store.loadToEmbed()).sort((a, b) => (order.get(a.doc_id) ?? 0) - (order.get(b.doc_id) ?? 0));
  if (!stale.length) {
    console.log("sync:briefings — embed: nothing stale");
    return 0;
  }
  let done = 0;
  let skipped = 0;
  for (let i = 0; i < stale.length; i += deps.embedBatchSize) {
    const slice = stale.slice(i, i + deps.embedBatchSize);
    let vecs: number[][];
    try {
      vecs = await withDeadlineRetryEmbed(
        () => deps.embedBatch(slice.map((r) => briefingEmbedText({ briefing: r.briefing, questions: questionsOf(r.questions) }))),
        deps,
      );
    } catch (e) {
      skipped += slice.length;
      console.warn(`  embed @${i} (${slice.length} rows) failed after retries: ${(e as Error).message}; retried next run`);
      continue;
    }
    for (let j = 0; j < slice.length; j++) await deps.store.writeVector(slice[j]!.doc_id, slice[j]!.briefing_hash, vecs[j]!);
    done += slice.length;
    if (done % 500 < deps.embedBatchSize || done === stale.length) console.log(`  ${done}/${stale.length}`);
  }
  console.log(`sync:briefings — embed: ${done} vectors${skipped ? `, ${skipped} skipped (retry next run)` : ""}`);
  return done;
}

// Embeddings have no deadline of their own (a killed run keeps its slices), so
// this is the plain three-attempt retry.
async function withDeadlineRetryEmbed<T>(fn: () => Promise<T>, deps: BriefingDeps): Promise<T> {
  return withDeadlineRetry(fn, 3, { ...deps, deadlineAt: Number.POSITIVE_INFINITY });
}

export async function runBriefings(deps: BriefingDeps): Promise<void> {
  await deps.runMigrations();
  const { atlasSha, docs } = await deps.store.loadSnapshot();
  // An unsynced database is a precondition failure, not "nothing to do".
  if (docs.length === 0) {
    console.warn("sync:briefings — atlas_doc_meta is empty (structural sync has not run); skipping");
    return;
  }
  console.log(`sync:briefings — ${docs.length} docs, atlas ${(atlasSha ?? "unknown").slice(0, 12)}`);
  const live = liveView(docs);
  await seedPass(deps, live);
  await writePass(deps, live);
  await embedPass(deps, live);
}

// ------------------------------------------------------------------- entry point

async function withLock(fn: () => Promise<void>): Promise<void> {
  let reserved: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  // Tri-state like sync-embeddings: "could not ask" runs unlocked (a missed lock
  // costs a duplicate request, a missed run costs search), "held" skips.
  let state: "mine" | "held" | "unavailable" = "unavailable";
  try {
    reserved = await sql.reserve();
    const rows = (await reserved`SELECT pg_try_advisory_lock(${BRIEFINGS_LOCK_KEY})`) as { pg_try_advisory_lock: boolean }[];
    state = rows[0]?.pg_try_advisory_lock ? "mine" : "held";
  } catch (e) {
    console.warn(`sync:briefings — advisory lock unavailable (${(e as Error).message}); proceeding unlocked`);
  }
  try {
    if (state === "held") {
      console.log("sync:briefings — another run holds the lock; skipping");
      return;
    }
    await fn();
  } finally {
    if (reserved) {
      if (state === "mine") {
        try {
          await reserved`SELECT pg_advisory_unlock(${BRIEFINGS_LOCK_KEY})`;
        } catch {
          /* connection already dead — the lock dies with the session */
        }
      }
      reserved.release();
    }
  }
}

// The worker kills its tails at 11 minutes from ITS start (atlas-worker.mjs
// TAIL_CAP_MS). This process starts a few seconds after, so eight minutes from
// process start leaves room for the last requests (120 s each) to finish.
function deadlineAt(env: NodeJS.ProcessEnv = process.env): number {
  const startedAt = Date.now() - process.uptime() * 1000;
  return startedAt + Number(env.BRIEFINGS_DEADLINE_MS ?? 8 * 60_000);
}

function realDeps(): BriefingDeps {
  return {
    runMigrations,
    store: realStore,
    readSeed: () => {
      const file = join(config.publicDir, "doc-briefings.json");
      return existsSync(file) ? readFileSync(file) : null;
    },
    complete: async (system, user) => {
      const res = await getClient().chat.completions.create(
        {
          model: config.briefingModel,
          temperature: 0,
          max_tokens: 12_000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { timeout: 120_000, maxRetries: 0 },
      );
      // OpenRouter can answer 200 with an error body and no choices.
      const choice = res.choices?.[0];
      if (!choice) throw new Error(`no choices in response: ${JSON.stringify(res).slice(0, 200)}`);
      return { content: choice.message?.content ?? "", finishReason: choice.finish_reason ?? null };
    },
    // Documents raw, no query prefix: the prefix belongs to the query side only.
    embedBatch: (texts) => embedBatch(texts, AbortSignal.timeout(120_000), 0, undefined, "embed-briefing"),
    model: config.briefingModel,
    perCycle: config.briefingsPerCycle,
    hasApiKey: Boolean(config.openrouterApiKey),
    noFetch: process.env.ATLAS_WORKER_NO_FETCH === "1",
    deadlineAt: deadlineAt(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    embedBatchSize: 50,
  };
}

export async function main(deps: BriefingDeps = realDeps()) {
  try {
    await withLock(() => runBriefings(deps));
  } finally {
    await sql.end();
  }
}

// Only when launched directly: the worker and dev-preflight shell out to this
// file, and a plain import (a test) must not start a real run.
if (import.meta.main) {
  await main();
  await shutdownPosthog();
}
