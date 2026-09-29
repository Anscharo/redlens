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
// spelling pass. So the body must ALSO be replaced by WORD containment, which
// degrades smoothly, with its own (necessarily higher) bar: unrelated prose
// still shares its stopwords, so word overlap never approaches zero the way
// line overlap does.
//
// The gate first ROUTED on this line count — word measure at or under it, line
// measure above — and that left the same defect one size up: a lint pass that
// re-indents a bullet list changes every line of a 4-to-16-line body. It now
// asks both measures of every body (see bodyWhollyReplaced), so this is only
// the boundary the measurement scripts report on either side of.
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
//   3x the swaps. This was read as structural, with a stronger embedding
//   expected to do WORSE. Measured later, that was wrong about Qwen3 — see the
//   note after this block. The reasoning as it stood: the discriminator this gate needs is
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
//
// Both rejections above are about TERNLIGHT. The hosted Qwen3 embedding,
// measured 2026-09-29 on the real edits, ranks them above sibling swaps about
// as well as the word measure does alone (AUC 0.970 against 0.977) and agrees
// with it only in part (correlation 0.56), so the two combined beat either.
// Not used here: it needs a network call. The numbers and the candidate rules
// are in docs/research/identity-swap-detection.md, thread 5.
export const REPLACE_MAX_WORD_OVERLAP = 0.5;
// A body with fewer words than this carries too little signal to call either
// way — every measure is dominated by stopwords — so we never flag it.
export const JUDGEABLE_MIN_WORDS = 6;
// The body test compares words in full up to this many cells (2,000 words a
// side). Measured 2026-09-29: the largest real edit, 1,223 x 1,290 words, takes
// 48ms, and the test runs once per retitled document, not once per pair.
export const BODY_TEST_MAX_CELLS = 4_000_000;
// Bulk-rename detection. The per-document gate structurally cannot see that
// several documents in the same PR were retitled by the SAME edit: three UUIDs
// independently repurposed to an identical new title is implausible, one
// terminology pass is obvious. atlas#346 was exactly that — `ALMProxy` → `ALM
// Proxy` across three docs — and while the respelling itself is now caught by
// sameTitle, a campaign that changes a real word ("Whitelisting" →
// "Allowlisting") is not, and would land as N separate accusations.
//
// Two docs sharing a substitution is already a strong signal, so the bar is
// low; what keeps it honest is the second condition, that the substitution
// leave most of each title standing. A wholesale retitle yields no key at all,
// so a family of documents genuinely replaced en masse cannot be waved through
// by agreeing with each other.
//
// Measured after the fact (`bun scripts/aux/identity-campaign-check.ts`, over
// the live atlas's 4,405 distinct titles): only 0.21% of INDEPENDENT swaps
// produce a key at all, and across 2,000 simulated 50-document PRs — 100,000
// swaps — the rule suppressed nothing, while sparing a real one-word
// terminology pass in 18 of 18 sibling families.
//
// The exposure it does carry is correlated, not random, and cannot be tuned
// out because it is the rule's premise: if several sibling documents are all
// repointed from one entity to another in a single PR, their titles take the
// identical substitution and every one is spared. At the level of titles
// alone, "the Keel docs now hold the Obex docs" and "we renamed Keel to Obex"
// ARE the same edit; what tells them apart is the displaced content, which is
// exactly why a member with a demonstrated relocation stays flagged. So the
// residual is: a correlated mass repurposing whose old content appears nowhere
// in the diff. Accepted — it reads as a rename to a human reader too.
export const CAMPAIGN_MIN_DOCS = 2;
export const CAMPAIGN_MIN_TITLE_KEPT = 0.5;
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
  return wordsInOrder(a, b) / a.length;
}

/** How many of `a`'s words appear in `b`, in order — an LCS over words with
 *  fuzzy word equality. O(a·b). */
function wordsInOrder(a: string[], b: string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = dp[j];
      dp[j] = wordEq(a[i - 1], b[j - 1]) ? diag + 1 : Math.max(dp[j], dp[j - 1]);
      diag = up;
    }
  }
  return dp[b.length];
}

/** Fraction of the old body's words still present, in order, in the new body —
 *  orderedWordContainment without its binary fallback, for the body test. That
 *  fallback answers 0 for ANY change to a body over ~632 words, which is right
 *  for a relocation link (decline when unsure) and wrong here, where 0 means
 *  "replaced". Returns null when the bodies are too large to compare in full. */
export function bodyWordsKept(oldBody: string | undefined, newBody: string | undefined): number | null {
  const a = words(oldBody);
  const b = words(newBody);
  if (a.length === 0) return null;
  if (a.length * b.length > BODY_TEST_MAX_CELLS) return null;
  return wordsInOrder(a, b) / a.length;
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
 *  opposed to edited? Only when BOTH measures say so: few of its lines survive
 *  AND few of its words do. Each covers the other's blind spot — the line
 *  measure cannot tell a typo from a replacement in a one-line body, or a
 *  re-indented list from a rewritten one, and the word measure sees both.
 *
 *  Measured 2026-09-29 (`bun scripts/aux/identity-long-body.ts`) against the
 *  gate this replaced, which routed by size and asked one measure:
 *
 *                                            routed        both
 *    real cosmetic edits flagged (2,544)     15 (0.59%)    0
 *    real semantic edits flagged (4,439)    254 (5.72%)  195 (4.39%)
 *    sibling swaps missed, 1-3 lines          7.9%         8.0%
 *    sibling swaps missed, 4-20 lines        48.3%        49.1%
 *    unrelated swaps missed                  unchanged in every size band
 *
 *  "Sibling" in this table means same `parentId`, and only about one such
 *  pair in seven is a true sibling by document number. On true siblings both
 *  columns miss more (35% and 81%, thread 10). The comparison between the two
 *  rules stands.
 *
 *  Asking both can only REMOVE flags, so the cost is bounded by that miss
 *  column. The 48% is not this rule's doing: the line measure misses half the
 *  sibling swaps in that band by itself, because template siblings share their
 *  table headers and lead-in lines. Word containment alone would miss 13.3%
 *  there, for 231 semantic edits flagged instead of 195 — it ADDS flags, so it
 *  is a separate decision (docs/research/identity-swap-detection.md, thread 8).
 *
 *  A body too small to judge is never a replacement — it cannot carry the
 *  evidence, and a wrong ⚠ is worse than a missed one. One too large to
 *  compare word by word is left to the line measure. */
export function bodyWhollyReplaced(oldBody: string | undefined, newBody: string | undefined): boolean {
  if (words(oldBody).length < JUDGEABLE_MIN_WORDS) return false;
  if (lineOverlap(oldBody, newBody) > REPLACE_MAX_OVERLAP) return false;
  const kept = bodyWordsKept(oldBody, newBody);
  return kept === null || kept <= REPLACE_MAX_WORD_OVERLAP;
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

/** A canonical key for the edit that turned `oldT` into `newT`, or null when
 *  they are too different to call it an edit at all. Built from a word-level
 *  LCS, so "Whitelisting Of ALMProxy" → "Whitelisting Of ALM Proxy" and
 *  "Reporting Of ALMProxy" → "Reporting Of ALM Proxy" produce the SAME key:
 *  that is what lets two documents recognise each other as parts of one rename.
 *  Returns null when less than CAMPAIGN_MIN_TITLE_KEPT of the longer title
 *  survives — at that point it is a different title, not a substitution, and
 *  must not be able to form a campaign. */
export function titleSubstitution(oldT: string | undefined, newT: string | undefined): string | null {
  const a = words(oldT);
  const b = words(newT);
  if (!a.length || !b.length) return null;
  const ops = lcsOps(a, b);
  const kept = ops.filter(([op]) => op === "=").length;
  if (kept / Math.max(a.length, b.length) < CAMPAIGN_MIN_TITLE_KEPT) return null;
  // Collapse each run of removals/additions into one removed→added pair, in
  // order, so the key describes the substitution and not its position.
  const parts: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length || added.length) parts.push(`-${removed.join(" ")}+${added.join(" ")}`);
    removed = [];
    added = [];
  };
  for (const [op, w] of ops) {
    if (op === "=") flush();
    else if (op === "-") removed.push(w);
    else added.push(w);
  }
  flush();
  return parts.length ? parts.join("|") : null;
}

/** The changed documents whose retitle is one document's share of a bulk
 *  rename — the same substitution applied across at least CAMPAIGN_MIN_DOCS of
 *  them. A corpus-level judgement, so it is computed once per diff rather than
 *  per document. */
export function renameCampaigns(args: {
  changed: Iterable<string>;
  mainById: Map<string, SwapNode>;
  previewById: Map<string, SwapNode>;
}): Set<string> {
  const byEdit = new Map<string, string[]>();
  for (const id of args.changed) {
    const main = args.mainById.get(id);
    const prev = args.previewById.get(id);
    if (!main || !prev) continue;
    const key = titleSubstitution(main.title, prev.title);
    if (!key) continue;
    const group = byEdit.get(key);
    if (group) group.push(id);
    else byEdit.set(key, [id]);
  }
  const members = new Set<string>();
  for (const ids of byEdit.values()) {
    if (ids.length >= CAMPAIGN_MIN_DOCS) for (const id of ids) members.add(id);
  }
  return members;
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
  const renamed = renameCampaigns({ changed, mainById, previewById });

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
    // Likewise a retitle that is this document's share of a bulk rename: other
    // documents in the same diff took the identical edit, which is a fact about
    // the PR that no single document can see. Yields to a demonstrated
    // relocation for the same reason titlesRelated does.
    if (renamed.has(id) && !moved) continue;

    const swap: IdentitySwap = { oldTitle: main.title ?? "", newTitle: prev.title ?? "" };
    if (moved) {
      swap.movedTo = { id: moved.id, doc_no: moved.doc_no, title: moved.title ?? "" };
      formerUuid[moved.id] = { previousId: id, previousTitle: main.title ?? "", previousDocNo: main.doc_no };
    }
    identitySwap[id] = swap;
  }
  return { identitySwap, formerUuid };
}
