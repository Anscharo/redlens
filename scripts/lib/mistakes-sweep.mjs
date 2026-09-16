// Incremental bookkeeping for the Potential Mistakes sweep.
//
// The sweep itself is LLM judgement (see .claude/skills/mistakes-report), so
// this module does the part that must be deterministic: decide WHICH documents
// need re-reading, and merge agent output back without losing findings for the
// documents nobody looked at this run.
//
// Two rules make the incremental pass safe:
//
//   1. A document's findings are exactly what its most recent evaluation
//      produced. Re-evaluating a doc drops its old findings first, so a defect
//      fixed upstream disappears instead of lingering.
//   2. A document is only marked scanned when a chunk that contained it came
//      back intact. A killed agent's silence is indistinguishable from "found
//      nothing", so an unreturned chunk must stay in the next plan rather than
//      being recorded as clean.
//
// Everything here is pure — the CLI (scripts/aux/mistakes-sweep.mjs) owns I/O.

import { sha256 } from "./atlas-parser.mjs";
import { UUID_LINK_RE } from "./graph-patterns.mjs";

/** State file version. Bump only when the digest recipe changes: an older
 *  version means every digest is incomparable, so the CLI forces a full sweep
 *  rather than silently treating unchanged docs as scanned. */
export const STATE_VERSION = 1;

/**
 * What a re-evaluation is keyed on.
 *
 * `contentHash` covers the body only, so title and type are folded in
 * explicitly — a renamed document is worth re-reading (the sweep finds naming
 * and typo defects in titles). `doc_no` is deliberately EXCLUDED: upstream
 * renumbers wholesale (PR #235), findings are anchored by UUID, and the report
 * re-resolves the current doc_no live. Including it would re-run the whole
 * corpus for an editorial relabel.
 */
export function docDigest(node) {
  return sha256(`${node.title}\u0000${node.type}\u0000${node.contentHash}`).slice(0, 16);
}

/** An empty state: every document reads as new. */
export function emptyState() {
  return { version: STATE_VERSION, atlasSha: null, sweptAt: null, docs: {} };
}

/** Reject a state written by a different digest recipe — see STATE_VERSION. */
export function isStateUsable(state) {
  return !!state && state.version === STATE_VERSION && !!state.docs;
}

/**
 * Reverse index of the atlas cross-reference graph: target UUID → the UUIDs of
 * the documents whose text links to it.
 *
 * This is the relation `build-graph` emits as the `cites` edge, read with the
 * same regex so the two can never disagree about what counts as a reference. It
 * is derived here rather than loaded from `public/relations.json` because that
 * artifact is built ephemerally and never committed — a planner that needed it
 * would behave differently on a fresh checkout, which is exactly the kind of
 * silent difference this sweep cannot afford.
 *
 * One deliberate difference from the `cites` edge: a link whose target is no
 * longer in the corpus is kept, not dropped. A dangling reference is precisely
 * the defect the expansion exists to catch, and the citing document is the only
 * place left to catch it from. Self-links are dropped — they say nothing about a
 * document you would otherwise skip.
 */
export function buildBacklinks(nodes) {
  const backlinks = new Map();
  for (const node of nodes) {
    for (const [, , target] of (node.content ?? "").matchAll(UUID_LINK_RE)) {
      const to = target.toLowerCase();
      if (to === node.id) continue;
      if (!backlinks.has(to)) backlinks.set(to, new Set());
      backlinks.get(to).add(node.id);
    }
  }
  return backlinks;
}

/**
 * Compare the live atlas against the last sweep.
 *
 * → { new, changed, linked, unchanged, removed, total } where the first five are
 * UUID arrays and every live document lands in exactly one of them. `removed`
 * are UUIDs the state knows but the atlas no longer has — their findings are
 * dropped on merge (the doc is gone; the finding cannot be checked against
 * source any more).
 *
 * `linked` is the cross-reference expansion. A document whose own text did not
 * move can still have been broken by a document that did: its citation names a
 * title that was renamed, a figure that was restated, or a target that was
 * deleted outright. Pass `backlinks` (from `buildBacklinks`) to re-queue the
 * documents that point at anything new, changed or removed.
 *
 * Expansion is ONE HOP on purpose. A citer that gets re-read is not itself
 * "changed" — its digest is unchanged, and the run would otherwise walk outward
 * from a one-word fix until it had re-read the corpus.
 */
export function planSweep(nodes, state, { full = false, backlinks = null } = {}) {
  const known = full ? {} : (state?.docs ?? {});
  const live = new Set();
  const plan = {
    new: [],
    changed: [],
    linked: [],
    unchanged: [],
    removed: [],
    linkedBecause: {},
    total: nodes.length,
  };

  for (const node of nodes) {
    live.add(node.id);
    const prev = known[node.id];
    if (!prev) plan.new.push(node.id);
    else if (prev !== docDigest(node)) plan.changed.push(node.id);
    else plan.unchanged.push(node.id);
  }
  for (const uuid of Object.keys(state?.docs ?? {})) if (!live.has(uuid)) plan.removed.push(uuid);

  // Nothing to expand from when the whole corpus is already queued.
  if (!backlinks || full) return plan;

  const moved = [...plan.new, ...plan.changed, ...plan.removed];
  const skipped = new Set(plan.unchanged);
  for (const target of moved) {
    for (const citer of backlinks.get(target) ?? []) {
      if (!skipped.has(citer)) continue; // already queued on its own account
      (plan.linkedBecause[citer] ??= []).push(target);
    }
  }
  const expanded = new Set(Object.keys(plan.linkedBecause));
  plan.linked = plan.unchanged.filter((uuid) => expanded.has(uuid));
  plan.unchanged = plan.unchanged.filter((uuid) => !expanded.has(uuid));
  return plan;
}

/** The documents a plan sends back to the model, in atlas order. */
export function docsToEvaluate(plan) {
  return [...plan.new, ...plan.changed, ...(plan.linked ?? [])];
}

/**
 * Split documents into chunks that fit an agent's context.
 *
 * Chunks never span a document: an agent that receives half a document would
 * report against text it cannot see the end of. A single document larger than
 * the budget gets its own chunk rather than being cut.
 */
export function chunkDocs(nodes, { maxBytes = 40_000 } = {}) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const node of nodes) {
    const cost = (node.content?.length ?? 0) + (node.title?.length ?? 0) + 128;
    if (current.length && size + cost > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(node);
    size += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const SEVERITIES = new Set(["high", "medium", "low"]);
const PASSES = new Set(["language", "factual", "deterministic"]);
/** The report's filter pills are built from this same vocabulary. A category
 *  outside it round-trips badly: `presentCategories()` renders a pill for it,
 *  but `categoryCodec(CATEGORY_LABELS)` cannot decode it from the URL, so the
 *  pill looks broken. Kept in sync with CATEGORY_LABELS (src/lib/
 *  potentialMistakesIndex.ts) by scripts_tests/mistakes-sweep.test.ts, which
 *  can import the TypeScript this module cannot. */
export const CATEGORIES = new Set([
  "numeric", "entity", "governance", "contradiction", "structural", "xref",
  "stale", "placeholder", "copy-paste", "wrong-word", "typo", "grammar",
  "markdown", "naming", "duplication",
]);

/**
 * Validate one agent-reported finding against the artifact's schema.
 *
 * Findings are model output, so every field is checked before it can reach the
 * committed artifact: an unknown UUID means the agent invented or mistyped a
 * document, and the row is dropped with a reason rather than shipped.
 *
 * → { ok: true, finding } | { ok: false, reason }
 */
export function validateFinding(row, nodeMap) {
  if (!row || typeof row !== "object") return { ok: false, reason: "not an object" };
  const node = nodeMap[row.uuid];
  if (!node) return { ok: false, reason: `unknown uuid ${row.uuid}` };
  for (const field of ["category", "quote", "issue"]) {
    if (typeof row[field] !== "string" || !row[field].trim())
      return { ok: false, reason: `missing ${field}` };
  }
  if (!CATEGORIES.has(row.category)) return { ok: false, reason: `bad category ${row.category}` };
  if (!SEVERITIES.has(row.severity)) return { ok: false, reason: `bad severity ${row.severity}` };
  if (!PASSES.has(row.pass)) return { ok: false, reason: `bad pass ${row.pass}` };
  // The quote must be verbatim atlas text — that is what makes a finding
  // checkable against source, and what the report highlights in the document.
  const haystack = `${node.title}\n${node.content ?? ""}`;
  if (!haystack.includes(row.quote)) return { ok: false, reason: "quote not found in document" };

  return {
    ok: true,
    finding: {
      id: `${node.doc_no}#${row.category}`,
      docNo: node.doc_no,
      uuid: node.id,
      // Stamped from the atlas, like id and docNo: agents are told not to supply
      // it, and a re-evaluated document must not lose the source file it had.
      file: node.file ?? row.file ?? "",
      category: row.category,
      severity: row.severity,
      pass: row.pass,
      quote: row.quote,
      issue: row.issue,
      fix: typeof row.fix === "string" ? row.fix : "",
    },
  };
}

/** Disambiguate ids when one document yields several findings of one category
 *  (`A.1#typo`, `A.1#typo-2`, …) — the id is the report's stable row key. */
export function dedupeIds(findings) {
  const seen = new Map();
  return findings.map((f) => {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    return n === 1 ? f : { ...f, id: `${f.id}-${n}` };
  });
}

/**
 * Fold this run's findings into the previous artifact.
 *
 * `evaluated` is the set of UUIDs actually covered by a chunk that came back
 * intact — NOT everything the plan asked for. Findings survive untouched for
 * every document outside that set; findings are replaced for documents inside
 * it, and dropped for documents the atlas no longer has.
 */
export function mergeFindings(previous, incoming, evaluated, removed = [], { dropCorpus = false } = {}) {
  const drop = new Set([...evaluated, ...removed]);
  // A corpus-wide finding (uuid null) spans documents — "these six artifacts
  // say circulating where two say total". No chunk contains it, so
  // validateFinding cannot regenerate one and no document sweep may retire it:
  // dropping it on --full would delete a real finding nothing can rebuild.
  // These rows are hand-maintained; `--drop-corpus` is the deliberate purge.
  const kept = previous.filter((f) =>
    f.uuid == null ? !dropCorpus : !drop.has(f.uuid),
  );
  return {
    findings: dedupeIds(sortFindings([...kept, ...incoming])),
    kept: kept.length,
    replaced: previous.length - kept.length,
    added: incoming.length,
  };
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/** Severity first, then atlas order by doc_no — the order the report and the
 *  rendered markdown both expect, so a merge never reshuffles unrelated rows. */
export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
      compareDocNo(a.docNo, b.docNo) ||
      a.category.localeCompare(b.category),
  );
}

/** Numeric segment-wise doc_no comparison: `A.10` sorts after `A.9`. */
export function compareDocNo(a, b) {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = Number.parseInt(x, 10);
    const ny = Number.parseInt(y, 10);
    const cmp =
      Number.isFinite(nx) && Number.isFinite(ny) && String(nx) === x && String(ny) === y
        ? nx - ny
        : x.localeCompare(y);
    if (cmp) return cmp;
  }
  return 0;
}

/** Record the digests of the documents this run actually evaluated. Documents
 *  the atlas dropped leave the state so they stop appearing as `removed`. */
export function advanceState(state, nodeMap, evaluated, removed = [], atlasSha = null) {
  const docs = { ...(state?.docs ?? {}) };
  for (const uuid of removed) delete docs[uuid];
  for (const uuid of evaluated) {
    const node = nodeMap[uuid];
    if (node) docs[uuid] = docDigest(node);
  }
  return { version: STATE_VERSION, atlasSha, sweptAt: new Date().toISOString().slice(0, 10), docs };
}
