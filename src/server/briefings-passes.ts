// The seed and embed passes and the pass runner of sync:briefings (split from
// sync-briefings.ts).
import { createHash } from "node:crypto";
import { briefingEmbedText, seedAction } from "../../scripts/lib/doc-briefings.mjs";
import type { BriefingWrite } from "./briefings-store.ts";
import { liveView, withDeadlineRetry, type BriefingDeps, type Live } from "./briefings-deps.ts";
import { writePass } from "./briefings-write.ts";

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
