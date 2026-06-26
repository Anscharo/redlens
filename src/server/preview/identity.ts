// Detect UUID-identity reassignments in a preview's diff.
//
// The diff pipeline keys docs by UUID. When a fork keeps a UUID (and usually its
// doc number too) but swaps the underlying *document* — a different title and an
// almost entirely rewritten body — the plain added/changed split records it as
// an ordinary "changed" edit. That badly undersells the change: a stable
// identity now points at a different document. This module flags that case and,
// best-effort, finds where the displaced (old) content went, so both sides of
// the swap can carry a warning marker.
//
// Pure (no IO); the only dependency is the shared LCS, so similarity is measured
// the same way as the rest of the diff machinery. Exercised by identity.test.ts.

import { lcsOps } from "../../lib/diffCore";

export interface IdentitySwap {
  /** Title the UUID had on the live atlas. */
  oldTitle: string;
  /** Title the UUID has in this preview. */
  newTitle: string;
  /** Best-effort: the preview doc (new UUID) that received the old content. */
  movedTo?: { id: string; doc_no: string; title: string };
}

export interface FormerUuid {
  /** The UUID this content used to live under on the live atlas. */
  previousId: string;
  previousTitle: string;
  previousDocNo: string;
}

/** Minimal doc shape this module needs — both AtlasNode (live) and preview
 *  docs.json nodes satisfy it. */
export interface SwapNode {
  id: string;
  doc_no: string;
  title?: string;
  content?: string;
}

// A changed doc counts as an identity swap only when BOTH hold: its title
// changed AND its body is almost entirely replaced (shared-line ratio at or
// below this). A high bar by design — we flag true document replacements, never
// ordinary big edits that keep the same title.
export const REPLACE_MAX_OVERLAP = 0.15;
// Relocation match: how much of the OLD doc's distinct words must reappear in a
// candidate new doc to call it the displaced content's new home. Word
// containment (not line overlap) so the match survives the content being
// expanded/edited when it moved.
export const RELOCATION_MIN_CONTAINMENT = 0.7;
// Skip relocation matching for trivially short docs — too few words to match
// confidently (every "X is Soter Labs." would otherwise collide).
const RELOCATION_MIN_WORDS = 5;

function normTitle(t: string | undefined): string {
  return (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Are these titles a specialization/rename of each other (one contains the
 *  other) rather than two unrelated documents? e.g. "Operational Executor Agent"
 *  → "Operational Executor Agent Ozone". Both must be non-empty. */
function titlesRelated(a: string | undefined, b: string | undefined): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function lines(t: string | undefined): string[] {
  return (t ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function words(t: string | undefined): string[] {
  return ((t ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1);
}

/** Fraction of lines shared between two texts (0 = disjoint … 1 = identical). */
export function lineOverlap(a: string | undefined, b: string | undefined): number {
  const la = lines(a);
  const lb = lines(b);
  if (la.length === 0 && lb.length === 0) return 1;
  if (la.length === 0 || lb.length === 0) return 0;
  const shared = lcsOps(la, lb).filter(([op]) => op === "=").length;
  return shared / Math.max(la.length, lb.length);
}

/** Fraction of the OLD doc's distinct words that appear in `cand` — robust to
 *  the content being expanded/edited when it moved. Returns 0 for docs with too
 *  few words to match confidently. */
export function wordContainment(oldText: string | undefined, cand: string | undefined): number {
  const o = [...new Set(words(oldText))];
  if (o.length < RELOCATION_MIN_WORDS) return 0;
  const c = new Set(words(cand));
  let hit = 0;
  for (const w of o) if (c.has(w)) hit++;
  return hit / o.length;
}

/** Find, among the added docs, the one whose body best contains the old doc's
 *  words — the displaced content's likely new home. Null when none clears the
 *  containment bar. */
function bestRelocation(oldContent: string | undefined, addedIds: string[], previewById: Map<string, SwapNode>): SwapNode | null {
  let best: { node: SwapNode; score: number } | null = null;
  for (const aid of addedIds) {
    const cand = previewById.get(aid);
    if (!cand) continue;
    const score = wordContainment(oldContent, cand.content);
    if (score >= RELOCATION_MIN_CONTAINMENT && (!best || score > best.score)) best = { node: cand, score };
  }
  return best?.node ?? null;
}

/** Classify identity swaps in a computed diff. `changed`/`added` are the UUID
 *  sets from mapChangedDocs; the maps are keyed by UUID for the live atlas and
 *  this preview respectively. */
export function detectIdentitySwaps(args: {
  changed: Iterable<string>;
  added: Iterable<string>;
  mainById: Map<string, SwapNode>;
  previewById: Map<string, SwapNode>;
}): { identitySwap: Record<string, IdentitySwap>; formerUuid: Record<string, FormerUuid> } {
  const { changed, added, mainById, previewById } = args;
  const identitySwap: Record<string, IdentitySwap> = {};
  const formerUuid: Record<string, FormerUuid> = {};
  const addedIds = [...added];

  for (const id of changed) {
    const main = mainById.get(id);
    const prev = previewById.get(id);
    if (!main || !prev) continue;
    if (normTitle(main.title) === normTitle(prev.title)) continue; // same title → ordinary edit
    if (lineOverlap(main.content, prev.content) > REPLACE_MAX_OVERLAP) continue; // body largely preserved → edit

    const moved = bestRelocation(main.content, addedIds, previewById);
    // A title that's a specialization/rename of the old (one contains the other,
    // e.g. "…Agent" → "…Agent Ozone") is a refinement, not a swap — UNLESS the
    // old content demonstrably relocated to a new doc, which means the uuid
    // really was repurposed.
    if (titlesRelated(main.title, prev.title) && !moved) continue;

    const swap: IdentitySwap = { oldTitle: main.title ?? "", newTitle: prev.title ?? "" };
    if (moved) {
      swap.movedTo = { id: moved.id, doc_no: moved.doc_no, title: moved.title ?? "" };
      formerUuid[moved.id] = { previousId: id, previousTitle: main.title ?? "", previousDocNo: main.doc_no };
    }
    identitySwap[id] = swap;
  }
  return { identitySwap, formerUuid };
}
