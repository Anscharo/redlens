# Detecting a repurposed UUID without accusing an innocent document

Working notes for the preview "identity changed" badge
(`src/server/preview/identity.ts`). Written 2026-09-29 after
next-gen-atlas#346 badged three documents that had only been respelled.
Status: **the defect is fixed and shipped**; everything under "Open threads"
is unfinished and safe to pick up in any order.

## What the badge claims, and why that is hard

`detectIdentitySwaps` flags a UUID whose *document was replaced* — the
identity is stable but now points at something else. That is a claim about
intent, inferred from content similarity alone, which is why it can be
**wrong in the direction that costs the most**: a false ⚠ on an innocent doc
is a visible accusation, a missed swap is just an ordinary Δ.

## The #346 defect (fixed — commit `bd9253f`)

Upstream respelled `ALMProxy` → `ALM Proxy` and `LitePSM` → `Lite PSM`,
touching the title and a few words of a one-sentence body. Three docs came
back badged. Two independent causes:

1. **`lineOverlap` is line-granular and 83% of the live atlas is a single
   line** (91% are ≤3). For a one-line body the LCS runs over two 1-element
   arrays, so it returns only 1.0 or 0.0 — a typo fix and a wholesale
   replacement are indistinguishable, and `REPLACE_MAX_OVERLAP` (0.15) is
   unreachable from above. Measured, the line measure flags **87% of ordinary
   edits to short docs, at every threshold**.
2. **The title gate kept its spaces.** It collapsed whitespace *runs* but not
   the spaces, so `Whitelisting Of ALMProxy` and `Whitelisting Of ALM Proxy`
   read as different titles.

Fix: short bodies route through `bodyWhollyReplaced`, which measures ordered
**word** containment (2.0% false flags / 5.4% missed at t=0.50); both title
checks compare a separator-squashed form.

## Harness

```bash
bun scripts/aux/identity-overlap-bakeoff.ts [--tern] [--qwen]
```

Builds two populations from the **live** atlas and a real preview:

- **NEGATIVE, must not flag** — the 19 real edits in atlas#346, plus live
  one-liners with 5/10/20/30% of their words substituted.
- **POSITIVE, must flag** — two unrelated one-liners, and the hard case:
  two **sibling** one-liners that share their template boilerplate.

It scores each candidate two ways, which are different proposals and must not
be conflated:

- **as a MEASURE**, replacing the word containment outright;
- **as a VETO**, one-sided — the word measure decides to flag and a high
  score overrides it. A veto only ever removes flags, so it is judged on what
  it rescues against what it costs.

The sibling population is the one that matters. It is where every
similarity-based approach degrades, and it is under-sampled relative to how
often template docs occur in the atlas.

## Open threads

### 1. IDF-weighted lexical overlap — CLOSED, don't ship it

Measured against synthetic negatives it looked like a strict Pareto win
(t=0.45: 1.7% false flags vs the shipped 2.0%, and better on misses). Measured
against the **real** labelled corpus it has **no headroom at all**: over the
2,106 real cosmetic edits to short bodies — the only place it would be used —
the shipped word measure and idf both flag **0.00%**. There is nothing to
recover. On real semantic edits idf is if anything slightly worse (4.88% at
t=0.45 vs word's 4.75% at the shipped 0.50).

The 2.0% → 1.7% gain was an artifact of the synthetic negatives (live
one-liners with random words substituted), which are harsher and differently
shaped than real lint/typo edits. Harness: `scripts/aux/identity-real-corpus.ts`.

### 2. Structural corroboration — WEAKER THAN IT LOOKS, do not require it

The idea: a rewrite-in-place changes *only* content, so a genuine repurposing
should also disturb something structural — a different parent, a changed type,
replaced children, a moved doc number. Requiring content replacement **and** a
structural change would have silenced all three #346 docs.

**It would also have missed the case this feature was built for.** The
canonical real repurposing — the Ozone fork fixture pinned in
`identity.test.ts` — is a UUID that *kept its doc number* while being
repurposed from "Operational GovOps" to "Sky Primitives", in place. Requiring
corroboration turns the one known true positive into a miss. A UUID can be
repurposed without moving, and in a fork that is the normal shape.

So this is a **corroborator, not a gate**: useful for ranking confidence, or
for choosing between "identity changed" and softer copy (thread 4), never as a
precondition. Noted because the shape is tempting and the counterexample is
already in the test suite.

If used that way, the prerequisite is small: `SnapshotDoc`
(`src/server/preview/snapshot.ts`) carries only
`id, doc_no, title, content, contentHash`, but `parentId` and `type` come free
from both builders — `loadAtlasSource` yields them and `docs.json` stores
them — so widening the type is two lines in `snapshotFromSrcDir` and
`snapshotFromDocsJson`.

### 3. Corpus-level rename detection — DONE

Shipped. `renameCampaigns` groups the changed docs by the word-level
substitution their titles underwent (`titleSubstitution` builds the key from an
LCS, so "Whitelisting Of ALMProxy" → "Whitelisting Of ALM Proxy" and "Reporting
Of ALMProxy" → "Reporting Of ALM Proxy" share one key). A key held by
`CAMPAIGN_MIN_DOCS` (2) or more documents is a terminology pass, and every
member is spared.

Two guards keep it from being a loophole: a substitution that leaves less than
`CAMPAIGN_MIN_TITLE_KEPT` (half) of the longer title standing yields **no key
at all**, so a family of documents genuinely replaced en masse cannot wave
itself through by agreeing; and a campaign member with demonstrably relocated
content is still flagged, the same carve-out `titlesRelated` uses.

Note this does not itself fix #346 — `sameTitle` catches a pure respelling
first. It covers the next variant: a campaign that changes a real word
("Whitelisting" → "Allowlisting") across N docs, which would otherwise land as
N separate accusations.

**Measured after building, which was the wrong order** —
`bun scripts/aux/identity-campaign-check.ts`, over the live atlas's 4,405
distinct titles:

- only **0.21% of independent swaps produce a substitution key at all** (the
  half-the-title guard doing the work);
- across 2,000 simulated 50-document PRs — 100,000 swaps — the rule
  **suppressed nothing**;
- it spared a real one-word terminology pass in **18 of 18** sibling families.

The exposure it does carry is **correlated, not random, and cannot be tuned
out**: if several sibling docs are all repointed from one entity to another in
one PR, their titles take the identical substitution and every one is spared.
At the level of titles alone, "the Keel docs now hold the Obex docs" and "we
renamed Keel to Obex" *are the same edit* — the rule takes the benign reading
on purpose. What separates them is the displaced content, which is why a
member with a demonstrated relocation is still flagged. Residual: a correlated
mass repurposing whose old content appears nowhere in the diff. Accepted; it
reads as a rename to a human too.

### 4. Make the un-corroborated case descriptive rather than accusatory — DONE

Today `movedTo` is best-effort: a swap is flagged even when the displaced
content cannot be found. But "this UUID's document was displaced" is the
*definition* of the claim — if the old content cannot be located, the badge is
a guess. Options, cheapest first:

- Keep flagging, but **change the copy** when `movedTo` is null: "substantially
  rewritten" is true either way and costs nothing if the inference is wrong;
  reserve "identity changed" for the corroborated case.
- Or require `movedTo`, accepting the loss of genuine delete-and-reuse.

This is risk reduction rather than accuracy, and it is independent of every
other thread — worth doing regardless of which measure wins.

### 5. Embeddings — PAUSED, do not resume without reading this

Two framings, both measured for ternlight (on-device, ~2ms, no network) and
**both rejected**:

- **As a measure**: worse at every operating point (at 0.67, 5.9% false flags
  for 7.7% missed, vs the word measure's 13.7%/2.8%). This is structural. The
  discriminator this gate needs is **lexical**, not semantic — the hard case
  is two sibling template docs differing only in which entity fills the slot,
  near-identical in meaning by construction. Ternlight shows the gradient
  already: it scores hard siblings (p50 0.469) far closer than unrelated docs
  (p50 0.171), i.e. it is most confused where the gate must be sharpest.
  **A stronger embedding should be expected to do worse here, not better.**
- **As a veto** over `word<=0.50`: mildly positive, too small to buy. The
  separation runs the right way (inside the flagged net, ordinary edits sit at
  p50 0.592 and real swaps at p50 0.256), but the window is narrow — at
  `>0.85` it rescues 2 of 32 wrongly-flagged edits for 1 of 1,285 real swaps;
  at `>0.80` the trade inverts (2 rescued, 9 lost); at `>0.90` nothing moves.
  The whole prize is ~0.1pp off a 2.0% false-flag rate, on a 32-doc residual
  where "2" is nearly noise.

**Qwen3 was never measured** — the cloud container had no `OPENROUTER_API_KEY`.
The `--qwen` arm is written and wired to `src/server/retrieval/embed.ts`'s
`embedBatch`, the same client the atlas search embeds with, so it measures the
vectors production would actually have. Responses disk-cache to
`.cache/identity-bakeoff/qwen.json`, so a rerun is free.

To resume locally:

```bash
export OPENROUTER_API_KEY=...          # or put it in .env
bun scripts/aux/identity-overlap-bakeoff.ts --tern --qwen
```

The open question is **only the veto framing**. The measure argument above
does not depend on model strength and should not be re-litigated without new
evidence. But the veto only needs confidence in the *easy* direction — "this
is the same sentence, respelled" — which is exactly where a 4096-dim hosted
model should be better calibrated than a 384-dim ternary one. If it widens
that narrow `>0.85` window into something robust, it is worth the WASM-free
network cost; if it does not, close the thread.

Before trusting any veto number, **enlarge the residual**. Thirty-two rows is
too few to set an operating point on. The cheapest source of more real
negatives is `atlas_history` — real per-doc before/after pairs across the whole
upstream history, reconstructable from its stored `DiffLine[]` the same way
the harness already reconstructs them from `patches.json`.

### 6. History as a signal — two obvious uses checked and rejected, one real

Probed 2026-09-29 against live `atlas_history` / `atlas_history_stats`. The two
approaches that come to mind first both fail on the very case that prompted
this, so check them before reaching for them again.

**Per-UUID churn prior — points the WRONG way.** The idea: a UUID that is
rewritten constantly is a template slot, so don't be alarmed. Measured on
`5c795414` (one of the three #346 docs): six events in its entire life, of
which only **two** are `modified` — and one of those two is PR 223, *"remove
non breaking space characters"*. The rest are the two layout migrations and
its birth. History says this document is **stable**. Fed in as a prior, that
makes the accusation look *more* credible, not less. The document's stability
is real; what was wrong is the gate's reading of the edit, not its reading of
the document.

**The existing `change_kind` classifier — would not have fired.**
`scripts/lib/history-classify.mjs` already classifies every historical edit as
lint / typo / semantic, which looks like the same judgement this gate needs.
It isn't, at the sizes that matter: `classifyDiff` requires ≤4 changed
alphanumeric characters with no run over 2 to call something a typo, and
#346 changes `ALMProxy`/`LitePSM`/`must be`/`will effectively allow` — it
classifies **semantic**. The `classifyPrTitle` override doesn't help either:
it keys on phrases like "whitespace" or "fix typos", and #346's PR is titled
*"Atlas Edit Proposal — 2026-09-28"*. Both lanes miss.

**Fingerprint lineage — proposed, then withdrawn. A PREVIEW IS NOT IN THESE
TABLES.** `atlas_history` and `atlas_doc_versions` are built by walking the git
log of **upstream main**. A PR branch's or a fork's commits are not in that
log, so a preview's own documents have **no rows at all** — the DB knows the
base side and nothing else.

That kills the idea as first written. It proposed asking whether this UUID's
old fingerprint *reappears under a different UUID*, as a corpus-wide version of
`relocationTarget`. But in a preview the displaced content reappears **inside
the PR**, which history has never seen, so the lookup searches the one place
the answer cannot be.

The reverse direction is mechanically sound — fingerprint the preview's NEW
content locally and look it up, and a hit under a different `doc_id` means this
UUID now holds a document that exists elsewhere upstream. It is still not worth
a DB call: `computeDiffArtifacts` already holds the **entire** upstream state at
the merge base as the `base` snapshot, in memory. Anything about what exists
upstream *right now* is already answerable there, for free.

So history's only unique contribution to the gate is content that existed
upstream **in the past but not now** — a fork reviving something deleted months
ago. Real, but narrow, and not what #346 was. Don't build the lineage lookup
for the general case.

**And the reason the whole concern is well-founded**, from
`atlas_history_stats`: in 2026-Q1 mechanical edits (907 `lint` + 448 `typo`)
**outnumbered** semantic ones (609); 2026-Q2 ran 506 + 436 against 992. Bulk
cosmetic passes are a routine mode of change in this corpus, not an edge case.
#346 is that genre, and so is PR 223, which touched this very document.

**The ground-truth use is the one that survives, and it is the biggest.** It is
unaffected by the above because it is *offline and upstream-only* — it evaluates
the gate rather than feeding it, so it never needs to see a preview.

The migration-006 backfill has in fact already run (confirmed 2026-09 against
production): 7,494 of ~7,635 `modified` rows are labelled. That is a real
corpus of **2,641 genuine cosmetic edits** — 1,519 `lint` + 1,122 `typo` —
against 4,853 `semantic` ones, with real before/after diffs. It replaces the
synthetic negatives (live one-liners with random words substituted) that every
false-flag number in this note rests on.

It also settles the base rate: **~35% of all classified atlas edits are
cosmetic.** Roughly one edit in three is #346's genre, so the
false-accusation risk is structural, not a one-off.

Next step when someone picks this up: re-run the bakeoff's negative population
from those 2,641 labelled edits and measure how many the shipped gate badges.
That is a real false-accusation rate, and it is the number that should decide
whether thread 1 (IDF) is worth shipping.

### 7. The real-corpus result, and the residual it exposed

`bun scripts/aux/identity-real-corpus.ts` scores `bodyWhollyReplaced` — the
shipped function, routed exactly as it routes in production — against 2,544
real human-labelled cosmetic edits (`change_kind` ∈ lint/typo) pulled from
`/api/history/batch` with their real diffs.

| | cosmetic edits wrongly flagged |
|---|---|
| pre-fix (`lineOverlap` on every body) | **52.00%** (1323/2544) |
| shipped | **0.59%** (15/2544) |
| shipped, bodies ≤3 lines | **0.00%** (0/2106) |
| shipped, bodies >3 lines | **3.42%** (15/438) |

So the real false-accusation rate was 52%, not the 87% the synthetic
population estimated, and the fix takes it to 0.59%.

**Every one of the 15 survivors is the SAME DEFECT, one size up.** They are
4-to-16-line documents, and all 15 score `word = 1.000` — the word measure
knows the body is fully intact. They are flagged only because
`SHORT_BODY_MAX_LINES = 3` routes them to `lineOverlap`, and a lint pass that
re-indents a bullet list (`        ◦` → `    -`) changes *every* line, so the
shared-line ratio collapses to 0.000–0.143 exactly as it did for one-liners.
Titles include "Reward Payment", "Rate Limit IDs", "stUSDS Risk Parameters".

The obvious fix is to stop routing on size and take
`max(lineOverlap, orderedWordContainment)` for every body — flag only when
*both* measures say replaced. All 15 would be spared, since word is already
1.000 on them. **Not done, and not yet measured**: the cost is in missed real
swaps, and the real corpus has no true-swap population to measure that on, so
it needs the synthetic positives from the bakeoff. Do that before changing it.

One caveat found while measuring: `orderedWordContainment`'s cost cap
(`a.length * b.length > 400_000`, ~632 words a side) degrades to a binary
normalized-substring test, which returns **0** for a body whose only change is
non-whitespace punctuation — a bullet-glyph swap in a 657-word doc scored
`word = 0.000` when the text was untouched. Any fix that leans harder on the
word measure should revisit that fallback.

Scope of the corpus, stated because it bounds every number above: only entries
whose stored diff reconstructs a whole body are usable (build-history trims to
changed lines ± context with `…` between hunks and caps at 20 lines), which
dropped 78 of 7,136; `atlas_history` stores no title, so this measures the
**body test** only — which is the right target, since the gate reaches it only
once a title has changed.

## Ordering

**3, 4, 6-groundtruth and 1 are done.** What is left, in order:

1. **The >3-line residual** (thread 7) — the same defect one size up, 15 real
   documents, with an obvious fix that needs its miss-cost measured first.
   This is the only open item with a known live defect behind it.
2. **5** (embeddings) — only the Qwen veto framing, and only if the residual
   above turns out to matter. Everything else there is measured and rejected.

**2** is a corroborator at best; do not build it as a gate. **1** (IDF) is
closed: the real corpus shows it has no headroom.

Three ideas in **6** are checked and dead — don't re-derive them: the churn
prior (points the wrong way), the `change_kind` reuse (classifies #346
semantic), and the fingerprint-lineage lookup (a preview has no rows in these
tables, and the base snapshot already answers the present-tense question in
memory).

Whatever is picked up next, **measure it before building it**. Thread 3 was
built on reasoning and measured afterwards; the measurement happened to come
back clean, which does not make the order right.
