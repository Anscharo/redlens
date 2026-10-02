// Planning for the briefings: which documents owe a row, the context digest a
// row was written from, the worker's queue, and the seed rule. Pure; see
// doc-briefings.mjs for the overview.

import { createHash } from "node:crypto";

import { buildCitations, buildDependents, buildTree } from "./doc-briefings-tree.mjs";
import { docDigest, planSweep } from "./mistakes-sweep.mjs";

/**
 * `planSweep`, with one correction for a corpus that is described in sittings.
 *
 * `planSweep` expands from every `new` document. For the mistakes sweep `new`
 * means new to the atlas, because its state has covered the whole corpus since
 * the bootstrap. Here the state starts empty and fills over many sittings, so
 * until it is complete `new` mostly means "not described yet" — and such a
 * document did not move. Expanding from it would re-queue the finished rows of
 * its children and link targets on every sitting (317 of the pilot's 2,332).
 *
 * So while `state.complete` is not set, a document is `linked` only if something
 * it depends on CHANGED or was REMOVED. Once every live document has been
 * described the merge sets `complete`, and from then on `new` means new to the
 * atlas and expands like any other movement.
 */
export function planBriefings(nodes, state, { full = false, tree = buildTree(nodes) } = {}) {
  const plan = planSweep(nodes, state, { full, backlinks: full ? null : buildDependents(nodes, tree) });
  if (full || state?.complete) return plan;
  const fresh = new Set(plan.new);
  const spared = new Set();
  for (const [uuid, causes] of Object.entries(plan.linkedBecause)) {
    const moved = causes.filter((cause) => !fresh.has(cause));
    if (moved.length) plan.linkedBecause[uuid] = moved;
    else {
      delete plan.linkedBecause[uuid];
      spared.add(uuid);
    }
  }
  if (!spared.size) return plan;
  // Back where they came from, in atlas order.
  const unchanged = new Set([...plan.unchanged, ...spared]);
  plan.linked = plan.linked.filter((uuid) => !spared.has(uuid));
  plan.unchanged = nodes.filter((n) => unchanged.has(n.id)).map((n) => n.id);
  return plan;
}

/**
 * About `count` of `ids`, spread evenly over the list in runs of `block`.
 *
 * `--limit` takes the FIRST n of the queue, which in atlas order is one end of
 * the corpus: a partial run made that way says nothing about the other end, and
 * a retrieval eval over it competes against an unrepresentative pool. This
 * keeps whole runs — a run holds whole subtrees, so an embedding group is
 * rarely cut — and chooses which runs to keep so they fall evenly from the
 * first document to the last.
 */
export function spreadSample(ids, count, block = 250) {
  if (count >= ids.length) return [...ids];
  const runs = Math.ceil(ids.length / block);
  const ratio = count / ids.length;
  const kept = [];
  for (let i = 0; i < runs; i++) {
    // Keep run i when the running total of `ratio` crosses a whole number.
    if (Math.floor((i + 1) * ratio + 1e-9) > Math.floor(i * ratio + 1e-9)) kept.push(...ids.slice(i * block, (i + 1) * block));
  }
  return kept;
}

/** True when the state holds a digest for every live document — the point at
 *  which `new` starts to mean "new to the atlas". See planBriefings. */
export function isComplete(nodes, state) {
  return nodes.every((n) => state?.docs?.[n.id] !== undefined);
}

/**
 * What a briefing was written from, beyond the document itself.
 *
 * A briefing is built from the document, its parent and the documents that cite
 * it. The document's own digest does not move when a parent is renamed or a
 * citer changes, so this folds all three in: the node's digest, its parent's
 * ('' for a root) and the sorted digests of its citers. A sibling edit moves
 * none of them, so it re-queues nothing.
 */
export function contextDigest(node, tree, citations) {
  const parent = tree.setOf.get(node.id)?.parent;
  const citers = (citations.get(node.id) ?? []).map((c) => docDigest(c.from)).sort();
  return createHash("sha256")
    .update([docDigest(node), parent ? docDigest(parent) : "", ...citers].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * What a seed row (public/doc-briefings.json) does to the database.
 *
 * `have` is the stored row or undefined; a placeholder (`briefing === ''`, it
 * only carries a failure count) counts as no row. `seed` is { digest },
 * `liveDigest` the digest of the live document, or undefined when the document
 * is not live.
 *
 *   skip     the document is gone: the foreign key would reject the row
 *   insert   no row (or a placeholder) and the document is live
 *   replace  the row is stale and the seed is current
 *   keep     anything else, including a worker row at the live digest — at equal
 *            digests the database wins, so the file is a seed and not an editor
 */
export function seedAction(have, seed, liveDigest) {
  if (liveDigest === undefined) return "skip";
  if (!have || have.briefing === "") return "insert";
  if (have.digest !== seed.digest && seed.digest === liveDigest) return "replace";
  return "keep";
}

/** After this many validation failures at one context digest a document is left
 *  alone until its context changes. */
export const BRIEFING_MAX_FAILURES = 3;

/**
 * The documents the worker owes a briefing, in atlas order, cut to `cap`.
 *
 * `docs` are live nodes in atlas order, `rows` a Map<uuid, { briefing,
 * context_digest, failures, failed_context }>. Owed: no row or a placeholder, or a
 * row written for another context (see contextDigest). A document that has failed
 * validation BRIEFING_MAX_FAILURES times at the live context is left out. The
 * count is kept against `failed_context`, not the row's own context_digest, which
 * describes its text and so differs from the live one for every stale row. A
 * context change makes the two differ again, so the document queues again. `tree` and `citations`
 * are computed from `docs` unless the caller already holds them.
 */
export function briefingQueue(
  docs,
  rows,
  cap,
  { tree = buildTree(docs), citations = buildCitations(docs) } = {},
) {
  const queue = [];
  if (cap <= 0) return queue;
  for (const doc of docs) {
    const row = rows.get(doc.id);
    const context = contextDigest(doc, tree, citations);
    const owed = !row || row.briefing === "" || row.context_digest !== context;
    if (!owed) continue;
    if (row && row.failures >= BRIEFING_MAX_FAILURES && row.failed_context === context) continue;
    queue.push(doc.id);
    if (queue.length >= cap) break;
  }
  return queue;
}
