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
// …but the shared-LINE ratio only has resolution on a body with several lines,
// and 83% of the live atlas is a SINGLE line (measured 2026-09-29 over the
// 11,584-doc atlas; 91% are three lines or fewer). For a one-line body the LCS
// runs over two 1-element arrays, so lineOverlap can only return 1.0 (byte
// identical) or 0.0 — a one-word typo fix scores the same as a wholesale
// replacement, and 0.15 is unreachable from above. That is what put an
// "identity changed" badge on next-gen-atlas#346's `ALMProxy` → `ALM Proxy`
// spelling pass. So a short body is measured by WORD containment instead, which
// degrades smoothly, with its own (necessarily higher) bar: unrelated prose
// still shares its stopwords, so word overlap never approaches zero the way
// line overlap does.
export const SHORT_BODY_MAX_LINES = 3;
// Measured 2026-09-29 over the live atlas — ~1,600 ordinary edits (the 19 real
// edits in atlas#346, plus one-line live docs with 5/10/20/30% of their words
// substituted) against ~1,400 true swaps (two unrelated one-liners, and the
// hard case: two SIBLING one-liners that share their template boilerplate):
//
//   measure        threshold   ordinary edit flagged   real swap missed
//   line (shipped)      any*                   87.0%               0.1%
//   word                0.45                    0.4%               7.3%
//   word                0.50                    2.0%               5.4%  ← min sum
//   word                0.60                    6.6%               3.7%
//  *the line measure is flat across every threshold — that IS the defect.
//
// Ordinary edits sit far above 0.50 (the real #346 bodies score 0.79–0.92; a
// 10%-word-substitution edit has a p05 of 0.76), and the errors it does make
// are the cheap direction: a missed swap leaves an ordinary Δ, while a false ⚠
// on an innocent doc is the thing users report.
//
// An on-device embedding lane (ternlight) was measured here, two ways, and
// REJECTED both times — but for different reasons, so quote the right one:
//
//   AS A MEASURE, replacing the word containment: worse at every operating
//   point. At 0.67 it costs 5.9% false flags for 7.7% missed, where the word
//   measure gets 13.7%/2.8% — it buys a lower false-flag rate only by missing
//   3x the swaps. This is structural, and a stronger embedding should be
//   expected to do WORSE, not better: the discriminator this gate needs is
//   LEXICAL (are these the same words, in the same order), not semantic, since
//   the hard true-swap case is two sibling template docs differing only in
//   which entity fills the slot — near-identical in meaning by construction.
//   Ternlight already shows that gradient, scoring the hard siblings (p50
//   0.469) far closer than unrelated docs (p50 0.171): it is most confused
//   exactly where the gate must be sharpest.
//
//   AS A ONE-SIDED VETO over word<=0.50 (flag, unless the embedding is very
//   sure the meaning survived): mildly POSITIVE, and too small to buy. The
//   separation runs the right way — inside the flagged net, ordinary edits sit
//   at p50 0.592 and real swaps at p50 0.256 — but the usable operating point
//   is narrow. At tern>0.85 it rescues 2 of 32 wrongly-flagged edits for 1 of
//   1,285 real swaps; slacken it to >0.80 and the trade inverts (2 rescued, 9
//   lost); tighten it to >0.90 and nothing moves at all. So the whole prize is
//   ~0.1pp off a 2.0% false-flag rate, on a 32-doc residual where "2" is
//   nearly noise — paid for by loading WASM into a module whose no-IO purity
//   is why it is trivially testable. If that residual ever gets big enough to
//   matter, re-measure before assuming this still holds.
//
// Rerun both framings: `bun scripts/aux/identity-overlap-bakeoff.ts --tern`
// (add --qwen for the hosted Qwen3 arm; needs OPENROUTER_API_KEY).
export const REPLACE_MAX_WORD_OVERLAP = 0.5;
// A body with fewer words than this carries too little signal to call either
// way — every measure is dominated by stopwords — so we never flag it.
export const JUDGEABLE_MIN_WORDS = 6;
// Relocation match: the displaced content should reappear inside the new home —
// in order, and (nearly) in full — tolerating subword typo fixes and extra text
// the move tacked on. We measure it as ordered word containment (an LCS over
// words with fuzzy word equality), NOT a bag-of-words overlap: order + a high
// threshold are what keep unrelated docs from matching (a loose word-overlap
// heuristic gave a ~22% false-positive rate over the live atlas, matching shared
// boilerplate like "Completed Instances Directory" / "Failed Invocations").
export const RELOCATION_MIN_CHARS = 25; // old content must be this distinctive
export const RELOCATION_MIN_WORDS = 4; // …and carry at least this many words
export const RELOCATION_MIN_RATIO = 0.95; // …this fraction of them found, in order
// 0.95 (not 0.9) so a real word substitution between near-duplicate template
// docs ("Fluid" vs "Securitize") drops below the bar, while a subword typo —
// which still fuzzy-EQUALS its word via wordEq — stays counted.

function norm(t: string | undefined): string {
  return (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function words(t: string | undefined): string[] {
  return (t ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Are `a` and `b` within `tol` single-character edits? Bounded Levenshtein with
 *  an early exit once a whole row exceeds the budget. */
function withinEdits(a: string, b: string, tol: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > tol) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > tol) return false; // no cell in this row is recoverable
    prev = cur;
  }
  return prev[b.length] <= tol;
}

/** Two words count as equal if identical or a small typo apart — longer words
 *  tolerate more; short words must be exact (too easy to collide otherwise). */
function wordEq(a: string, b: string): boolean {
  if (a === b) return true;
  const tol = a.length <= 4 ? 0 : a.length <= 8 ? 1 : 2;
  return tol > 0 && withinEdits(a, b, tol);
}

/** Fraction of `oldText`'s words that appear, IN ORDER (LCS), inside `candText`
 *  — words matched fuzzily so subword typos don't break the alignment, and
 *  `candText` may carry extra words (the LCS skips them). 1.0 = the whole old
 *  body is present (possibly expanded); ~0 = unrelated. */
export function orderedWordContainment(oldText: string | undefined, candText: string | undefined): number {
  const a = words(oldText);
  const b = words(candText);
  if (a.length < RELOCATION_MIN_WORDS) return 0;
  // Cost cap (only fires when both bodies exceed ~632 words): skip the O(a·b) DP
  // and fall back to an exact normalized substring test. Deliberately binary —
  // a relocated-but-reformatted giant doc returns 0 (declines the relocation
  // link) rather than risk a slow or wrong fuzzy match; the swap is still flagged.
  if (a.length * b.length > 400_000) return norm(candText).includes(norm(oldText)) ? 1 : 0;
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = dp[j];
      dp[j] = wordEq(a[i - 1], b[j - 1]) ? diag + 1 : Math.max(dp[j], dp[j - 1]);
      diag = up;
    }
  }
  return dp[b.length] / a.length;
}

/** Title reduced to its letters and digits. Collapsing whitespace RUNS is not
 *  enough — that reads "Whitelisting Of ALMProxy" and "Whitelisting Of ALM
 *  Proxy" as two different titles, when they are the same title respelled.
 *  Squashing the separators entirely is what makes a spelling/punctuation
 *  normalisation (`ALMProxy` → `ALM Proxy`, `Lite-PSM` → `Lite PSM`) read as
 *  the cosmetic rename it is. */
function squashTitle(t: string | undefined): string {
  return (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The same document under a respelled name — not a retitle at all. */
function sameTitle(a: string | undefined, b: string | undefined): boolean {
  return squashTitle(a) === squashTitle(b);
}

/** Are these titles a specialization/rename of each other (one contains the
 *  other) rather than two unrelated documents? e.g. "Operational Executor Agent"
 *  → "Operational Executor Agent Ozone". Compared on the squashed form so a
 *  respelling inside the shared part ("ALMProxy Whitelisting" → "ALM Proxy
 *  Whitelisting Of Keel") does not break the containment. Both must be non-empty. */
function titlesRelated(a: string | undefined, b: string | undefined): boolean {
  const na = squashTitle(a);
  const nb = squashTitle(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function lines(t: string | undefined): string[] {
  return (t ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Fraction of the FIRST text's lines preserved (in order, via LCS) in the
 *  SECOND — how much of `a` survives into `b`. Directional on purpose: the swap
 *  gate calls it lineOverlap(oldBody, newBody) to ask "how much of the OLD body
 *  is still here?". Normalizing by `la.length` (the old side), not the longer
 *  side, means a short old body fully retained inside a much larger new body
 *  scores ~1 (preserved) instead of ~0 — so a stub that gets expanded under a
 *  new title is NOT misread as a wholesale replacement. (0 = none of `a`
 *  survives … 1 = all of it does.) */
export function lineOverlap(a: string | undefined, b: string | undefined): number {
  const la = lines(a);
  const lb = lines(b);
  if (la.length === 0 && lb.length === 0) return 1;
  if (la.length === 0 || lb.length === 0) return 0;
  const shared = lcsOps(la, lb).filter(([op]) => op === "=").length;
  return shared / la.length;
}

/** Was this uuid's body REPLACED (a different document now lives here), as
 *  opposed to edited? Granularity is chosen by the old body's size, because the
 *  two measures are not interchangeable:
 *    - several lines → shared-LINE ratio, the original measure (a long body
 *      that shares few whole lines really has been rewritten, and
 *      orderedWordContainment's cost cap degrades to a binary substring test
 *      on bodies this size);
 *    - up to SHORT_BODY_MAX_LINES → ordered WORD containment, because line
 *      granularity has no resolution here at all (see SHORT_BODY_MAX_LINES).
 *  A body too small to judge is never a replacement — it cannot carry the
 *  evidence, and a wrong ⚠ is worse than a missed one. */
export function bodyWhollyReplaced(oldBody: string | undefined, newBody: string | undefined): boolean {
  if (words(oldBody).length < JUDGEABLE_MIN_WORDS) return false;
  if (lines(oldBody).length <= SHORT_BODY_MAX_LINES) {
    return orderedWordContainment(oldBody, newBody) <= REPLACE_MAX_WORD_OVERLAP;
  }
  return lineOverlap(oldBody, newBody) <= REPLACE_MAX_OVERLAP;
}

/** Find where the displaced (old) content went. Conservative by design — a wrong
 *  match puts a misleading "moved to" link on the swap AND a false ⚠ on an
 *  innocent new doc, so we only claim a relocation when the evidence is strong:
 *    1. the old content is distinctive (>= RELOCATION_MIN_CHARS / _MIN_WORDS);
 *    2. it is NOT boilerplate — it appears in only the one live doc being swapped,
 *       not repeated across the atlas (no single "moved to" otherwise);
 *    3. (nearly) all of it reappears, in order, in EXACTLY ONE added doc
 *       (>= RELOCATION_MIN_RATIO, typo-tolerant); two or more matches is
 *       ambiguous, so we decline.
 *  Returns null (swap still flagged, just without a movedTo link) when unsure. */
export function relocationTarget(
  oldContent: string | undefined,
  mainById: Map<string, SwapNode>,
  addedIds: string[],
  previewById: Map<string, SwapNode>,
): SwapNode | null {
  const o = norm(oldContent);
  if (o.length < RELOCATION_MIN_CHARS || words(oldContent).length < RELOCATION_MIN_WORDS) return null;
  // Boilerplate guard: if the old content also appears verbatim in another live
  // doc, it's shared template text with no single destination.
  let mainHits = 0;
  for (const m of mainById.values()) {
    if (norm(m.content).includes(o) && ++mainHits > 1) return null;
  }
  // (Nearly) all of the old content, in order, in exactly one added doc.
  let match: SwapNode | null = null;
  for (const aid of addedIds) {
    const cand = previewById.get(aid);
    if (cand && orderedWordContainment(oldContent, cand.content) >= RELOCATION_MIN_RATIO) {
      if (match) return null; // ambiguous — more than one home
      match = cand;
    }
  }
  return match;
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
    // A swap replaces one real document with another. If either side is empty,
    // it's a stub being filled in or a doc being blanked — not an identity swap.
    if (!norm(main.content) || !norm(prev.content)) continue;
    // Same title — including one respelled around its separators — is an
    // ordinary edit, whatever happened to the body.
    if (sameTitle(main.title, prev.title)) continue;
    if (!bodyWhollyReplaced(main.content, prev.content)) continue; // body largely preserved → edit

    const moved = relocationTarget(main.content, mainById, addedIds, previewById);
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
