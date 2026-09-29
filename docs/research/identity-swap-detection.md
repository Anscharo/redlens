# Detecting a repurposed UUID without accusing an innocent document

Working notes for the preview "identity changed" badge
(`src/server/preview/identity.ts` and the `identity-*.ts` files beside it).
**This document holds the measurements; the code holds only the bars.** "The
bars in the code", below, says which thread set each one. Written 2026-09-29 after
next-gen-atlas#346 badged three documents that had only been respelled.
Status: **the defect and its long-body residual are fixed, and longer bodies
are now judged by the search vector**. "Ordering" at the end lists what is
open.

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

Fix: short bodies were routed to ordered **word** containment (2.0% false
flags / 5.4% missed at t=0.50); both title checks compare a separator-squashed
form. The routing itself was replaced later the same day — see thread 7.

The bakeoff that picked the word bar, over ~1,600 ordinary edits (the 19 real
edits in atlas#346, plus one-line live docs with 5/10/20/30% of their words
substituted) and ~1,400 swaps (two unrelated one-liners, and two sibling
one-liners that share their template):

| measure | threshold | ordinary edit flagged | real swap missed |
|---|---|---|---|
| line | any | 87.0% | 0.1% |
| word | 0.45 | 0.4% | 7.3% |
| word | **0.50** | 2.0% | 5.4% |
| word | 0.60 | 6.6% | 3.7% |

The line measure is flat across every threshold, which is the defect. 0.50 is
the smallest sum of the two errors. Ordinary edits sit far above it: the real
#346 bodies score 0.79 to 0.92, and an edit that substitutes 10% of the words
has a p05 of 0.76.

## The bars in the code

Each constant, its value, and the thread that measured it. Re-measure before
moving one.

| constant | file | value | meaning | set by |
|---|---|---|---|---|
| `REPLACE_MAX_OVERLAP` | `identity-body.ts` | 0.15 | replaced by lines: at most this share of old lines survive | the original gate; never decides alone since thread 7 |
| `REPLACE_MAX_WORD_OVERLAP` | `identity-body.ts` | 0.50 | replaced by words: at most this share of old words survive, in order | the table above; threads 7 and 8 |
| `REPLACE_MAX_COSINE` | `identity-body.ts` | 0.85 | replaced by meaning: cosine of the old and new search vector | thread 10 |
| `SHORT_BODY_MAX_LINES` | `identity-body.ts` | 3 | bodies longer than this are judged by meaning when a vector is known | thread 10 |
| `JUDGEABLE_MIN_WORDS` | `identity-body.ts` | 6 | a smaller body is never flagged | stopwords dominate below it |
| `BODY_TEST_MAX_CELLS` | `identity-text.ts` | 4,000,000 | largest word comparison made in full | thread 7 |
| `RENAME_MIN_KEPT` | `identity-rename.ts` | 0.90 | renamed in place: share of the old body that survives the title's substitution | thread 11 |
| `CAMPAIGN_MIN_DOCS` | `identity-rename.ts` | 2 | documents that must share one title substitution | thread 3 |
| `CAMPAIGN_MIN_TITLE_KEPT` | `identity-titles.ts` | 0.50 | share of the longer title a substitution must leave standing | thread 3 |
| `RELOCATION_MIN_RATIO` | `identity-relocation.ts` | 0.95 | share of the old content found, in order, in its new home | see below |
| `RELOCATION_MIN_CHARS`, `RELOCATION_MIN_WORDS` | `identity-relocation.ts` | 25, 4 | the old content must be this distinctive | see below |

The relocation match uses ordered word containment, not a bag of words. A
loose word-overlap heuristic gave a false-positive rate of about 22% over the
live atlas, matching shared boilerplate such as "Completed Instances
Directory" and "Failed Invocations". 0.95 is used, not 0.90, so that a real
word substitution between near-duplicate template documents ("Fluid" against
"Securitize") falls below the bar while a subword typo still counts.

The word matching is one implementation, in
`scripts/lib/ordered-containment.mjs`, shared with the HTML-era history
curation. A change there changes the gate.

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

### 5. Embeddings — ternlight rejected; Qwen3 adopted for longer bodies (thread 10)

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

**Qwen3 is now measured** (2026-09-29, `bun
scripts/aux/identity-cosine-distribution.ts --qwen`, 12,374 bodies, vectors
cached in `.cache/identity-bakeoff/qwen-cosine.json`), on the real corpus
rather than the 32-row synthetic residual.

**The question it was kept open for no longer exists.** The veto was meant to
rescue cosmetic edits wrongly flagged. After thread 7 the gate flags **0 of
2,544** real cosmetic edits, so there is nothing to rescue. The 15 it used to
flag scored `word = 1.000` and were lost in routing, before any similarity
measure was asked.

What the gate still flags among real edits is 195 `semantic` ones. There a
veto does separate, and Qwen does it better than ternlight:

| veto when | Qwen: real edits spared | Qwen: swaps lost | ternlight: spared | ternlight: lost |
|---|---|---|---|---|
| cos > 0.85 | 83 of 195 | 37 of 2,387 | 12 | 5 |
| cos > 0.90 | 37 of 195 | 4 of 2,387 | 6 | 1 |
| cos > 0.95 | 12 of 195 | 0 of 2,387 | 1 | 0 |

**The claim above that a stronger embedding should do worse is wrong for
Qwen3.** It was inferred from ternlight. Head to head on the same 9,526 pairs
(`bun scripts/aux/identity-embedding-vs-word.ts`):

| measure alone | real edits ranked above sibling swaps (AUC) | above unrelated swaps |
|---|---|---|
| line overlap | 0.650 | 0.661 |
| word containment | 0.977 | 0.993 |
| Qwen3 cosine | 0.970 | 0.999 |

Alone, the word measure is still the better of the two: at 10% of sibling
swaps missed it flags 251 of 6,983 real edits, Qwen 620. But the two agree only
in part (correlation 0.56 over real edits), so a rule that asks both does
better than either. Each rule below was scored on two disjoint halves of the
pairs; both halves are shown.

| rule | real edits flagged | sibling swaps missed | unrelated missed |
|---|---|---|---|
| shipped: line <= 0.15 and word <= 0.50 | 2.7% / 2.9% | 11.9% / 12.3% | 1.6% / 2.4% |
| word <= 0.50 alone (thread 8) | 3.2% / 3.4% | 10.9% / 11.7% | 1.6% / 2.3% |
| word <= 0.60 and Qwen <= 0.85 | 1.8% / 2.2% | 14.1% / 11.1% | 1.3% / 1.6% |
| shipped, or Qwen <= 0.70 | 3.2% / 3.3% | 10.1% / 9.2% | 0.4% / 1.1% |

So on this mixed sample Qwen buys either about a quarter fewer flags on real
edits at about the same misses, or 2 to 3 points fewer sibling misses for half
a point more flags. No rule flags a
cosmetic edit. This sibling sample is mostly one-line bodies, which is why its
miss rates are far below the 49% of the 4-to-20-line band in thread 7.

**On bodies of 4 to 20 lines the embedding is the best measure, alone.**
`bun scripts/aux/identity-embedding-vs-word.ts --band mid`: 782 real edits,
and every live body in the band paired with up to three of its siblings (2,673
swaps) and with unrelated bodies (1,500).

| measure alone, 4-20 lines | real edits ranked above sibling swaps (AUC) | semantic edits only |
|---|---|---|
| line overlap | 0.838 | 0.772 |
| word containment | 0.964 | 0.922 |
| Qwen3 cosine | 0.992 | 0.985 |

| rule, 4-20 lines | real edits flagged | sibling swaps missed | unrelated missed |
|---|---|---|---|
| shipped: line <= 0.15 and word <= 0.50 | 4.3% / 4.3% | 50.1% / 49.9% | 1.3% / 0.7% |
| word <= 0.50 alone (thread 8) | 4.9% / 4.9% | 13.5% / 12.9% | 0.5% / 0.0% |
| Qwen <= 0.80 alone | 0.8% / 1.5% | 8.0% / 10.2% | 0.0% / 0.0% |
| Qwen <= 0.85 alone | 2.6% / 4.3% | 5.5% / 6.7% | 0.0% / 0.0% |

`Qwen <= 0.80` beats the shipped rule and the word-only rule on both columns
at once. A rule search over 220 combinations of the three measures, chosen on
one half and reported on the other, found nothing without the embedding that
comes close, and with it the best rules at low flag rates are the embedding
alone. The reason is the size: a longer body gives the embedding a subject to
hold on to, which an edit keeps (p05 0.885) and a sibling does not (p50
0.538). On one-line template siblings that subject is nearly the same, which
is why the mixed sample above shows a smaller gain.

The counts behind the flag rates are small — 3 and 6 real edits of 391 — so
the rates are good to about a point, not a tenth. The swaps it still misses
are template siblings: parameter lists that differ in one token a line.

What stands between this and shipping:

- **The flagged real edits are not known to be wrong flags.** The gate reaches
  the body test only after a title change, `atlas_history` stores no title,
  and an edit that rewrites the title and most of the body may deserve the
  badge.
- **The swaps are synthetic**, and the thresholds were chosen on this corpus.
  The one known real swap, the Ozone fixture, is a one-line body, so no real
  swap exists to check the 4-to-20-line result against.
- **It needs a network call** at preview build time, for the few documents
  that pass the title gate, with a fallback to the shipped rule when the call
  fails. The module itself has no IO today.

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

### 7. The real-corpus result, and the residual it exposed — DONE

`bun scripts/aux/identity-real-corpus.ts` scores `bodyWhollyReplaced` — the
shipped function, which at the time of this table routed by size — against 2,544
real human-labelled cosmetic edits (`change_kind` ∈ lint/typo) pulled from
`/api/history/batch` with their real diffs.

| | cosmetic edits wrongly flagged |
|---|---|
| pre-fix (`lineOverlap` on every body) | **52.00%** (1323/2544) |
| routed by size | **0.59%** (15/2544) |
| routed by size, bodies ≤3 lines | **0.00%** (0/2106) |
| routed by size, bodies >3 lines | **3.42%** (15/438) |

So the real false-accusation rate was 52%, not the 87% the synthetic
population estimated, and the first fix took it to 0.59%.

**Every one of the 15 survivors is the SAME DEFECT, one size up.** They are
4-to-16-line documents, and all 15 score `word = 1.000` — the word measure
knows the body is fully intact. They are flagged only because
`SHORT_BODY_MAX_LINES = 3` routes them to `lineOverlap`, and a lint pass that
re-indents a bullet list (`        ◦` → `    -`) changes *every* line, so the
shared-line ratio collapses to 0.000–0.143 exactly as it did for one-liners.
Titles include "Reward Payment", "Rate Limit IDs", "stUSDS Risk Parameters".

**Fixed 2026-09-29.** `bodyWhollyReplaced` no longer routes on size. It asks
both measures of every body and flags only when both say replaced:
`lineOverlap <= 0.15` **and** word containment `<= 0.50`.

The miss cost could not be measured with what existed: the bakeoff's positives
are one-line bodies only. `bun scripts/aux/identity-long-body.ts` builds the
multi-line ones — a live body paired with an unrelated body, and with a
sibling under the same parent — in three size bands, and scores every
candidate on both sides.

| | routed (before) | both (shipped) | word only |
|---|---|---|---|
| real cosmetic edits flagged (2,544) | 15 | **0** | 0 |
| real semantic edits flagged (4,439) | 254 (5.72%) | **195 (4.39%)** | 231 (5.20%) |
| sibling swaps missed, 1-3 lines | 7.9% | 8.0% | 7.9% |
| sibling swaps missed, 4-20 lines | 48.3% | 49.1% | 13.3% |
| sibling swaps missed, >20 lines | 7.0% | 7.0% | 2.6% |
| unrelated swaps missed, 4-20 lines | 1.1% | 1.1% | 0.0% |

Asking both measures can only remove flags, so the cost is the difference
between the first two columns: 1 more sibling swap missed in 1,000 short
bodies, 8 more in 1,000 mid-sized ones, none elsewhere. The >20-line band rests
on only 23 live bodies.

**The cost cap was a second, separate defect, also fixed.** Past ~632 words a
side `orderedWordContainment` answers 0 for *any* change at all, not only for
punctuation: 10 real edits hit it, and 5 of them scored `word = 0.000` against
a true value of 0.928-1.000. One is a one-line, 690-word body, so the shipped
short-body branch was flagging it. The body test now uses `bodyWordsKept`,
which runs the same comparison in full up to `BODY_TEST_MAX_CELLS` (2,000
words a side; the largest real edit, 1,223 x 1,290 words, takes 48ms) and
leaves anything larger to the line measure. `orderedWordContainment` keeps its
cap, which is right for the relocation link it was written for.

A third candidate, comparing lines by their words so that a changed glyph or
indent no longer breaks a line match, spared 14 of the 15 and is not needed
once the word measure has a say.

Scope of the corpus, stated because it bounds every number above: only entries
whose stored diff reconstructs a whole body are usable (build-history trims to
changed lines ± context with `…` between hunks and caps at 20 lines), which
dropped 78 of 7,136; `atlas_history` stores no title, so this measures the
**body test** only — which is the right target, since the gate reaches it only
once a title has changed.

### 8. The line measure misses half the mid-sized sibling swaps — OPEN, a decision

Found while measuring thread 7, and older than it: on bodies of 4 to 20 lines
the line measure misses **48%** of sibling swaps, before and after the fix.
Template siblings share their table header, their separator row and their
lead-in line ("The Risk parameters are:"), and three shared lines in ten clear
the 0.15 bar. In that band `line` sits at p50 0.100 and p75 0.400.

Word containment alone (`word <= 0.50` on every body) misses 13.3% there. It
is not a free win, which is why it did not ship with thread 7:

- it **adds** flags where the gate has none today, and a wrong flag is the
  costly direction. On real semantic edits it flags 231 of 4,439 against the
  shipped 195;
- the threshold is inherited from short bodies. Swept over long bodies, 0.45
  to 0.55 is flat on real edits (37-38 of 357 flagged) and 0.40 starts to miss
  unrelated swaps.

What it still misses is mostly beyond any content measure: sibling parameter
lists that differ in one token per line ("Supply cap: 500,000,000 USDG" against
"Supply cap: 500,000 WETH") score 0.71-0.83.

The decision is whether catching 36 more sibling swaps in 100 is worth 36 more
flagged semantic edits in 4,439. **Read thread 5 first**: on this band the
Qwen3 embedding alone misses fewer swaps than the word measure and flags fewer
real edits, so word-only is the better answer only if a network call is ruled
out. Both numbers come from
`bun scripts/aux/identity-long-body.ts`; `--samples` prints examples of each.

### 9. How far a real edit moves a document's embedding — a description

Asked out of curiosity, recorded because the numbers place every threshold
above in context. `cos(before, after)` over the 6,983 real edits, beside two
populations that are not edits. `bun scripts/aux/identity-cosine-distribution.ts
[--qwen]`; per-pair scores land in `.cache/identity-bakeoff/cosine.json`.

| population | n | ternlight p05 | p50 | p95 | Qwen3 p05 | p50 | p95 |
|---|---|---|---|---|---|---|---|
| edit, `lint` | 1,450 | 0.980 | 1.000 | 1.000 | 0.984 | 0.997 | 0.999 |
| edit, `typo` | 1,094 | 0.989 | 0.997 | 0.999 | 0.993 | 1.000 | 1.000 |
| edit, `semantic` | 4,439 | 0.592 | 0.938 | 1.000 | 0.765 | 0.953 | 0.999 |
| not an edit, sibling | 1,045 | 0.137 | 0.481 | 0.817 | 0.425 | 0.693 | 0.870 |
| not an edit, unrelated | 1,498 | -0.006 | 0.163 | 0.423 | 0.285 | 0.435 | 0.618 |

- A cosmetic edit barely moves the vector: at least 97% of lint and typo edits stay
  above 0.95 on both models.
- The two models rank lint and typo in opposite order. Ternlight's tokenizer
  discards most whitespace and punctuation, so 84% of lint edits score 0.999
  or more. Qwen reads the markup and scores a typo fix higher than a lint pass.
- Semantic edits have a long lower tail and siblings a long upper one, and the
  two overlap. No single cut separates them: on Qwen, `cos <= 0.85` puts 11.0%
  of real edits below it and leaves 7.5% of siblings above it.
- Qwen's floor is high. Two unrelated atlas documents score 0.435 at the
  median, so its usable range is about 0.4 to 1.0, not 0 to 1.
- Ternlight reads the first 128 tokens only. An edit past that point scores
  exactly 1, which inflates its long-body rows.

### 10. Reusing the search vector, and what real retitles showed — BUILT

Preview semantic search will store one vector for each changed document. The
gate would like to reuse it, since embedding every changed document a second
time for the gate alone doubles the calls. But threads 5 and 9 measured the
raw **body**, and search stores something else
(`src/server/retrieval/embed-units.ts`, policy `kv_records_breadcrumbs`):
title plus link-stripped body for most documents, and a folded key:value text
under a breadcrumb for the rest. `bun scripts/aux/identity-search-vector.ts`
scores both on the same pairs.

Its negatives are new, and they are the gate's true input: **every document
in the atlas git history that kept its UUID across a commit while its title
changed** — 316 judgeable ones over 37 of 178 commits. Its swaps take siblings
by **document number**, not by `parentId`.

**Reuse works.** The search vector ranks real retitles above swaps as well as
the body vector does:

| real retitles ranked above sibling swaps (AUC) | body vector | search vector |
|---|---|---|
| bodies of 1 to 3 lines (214 retitles) | 0.866 | 0.859 |
| bodies of 4 to 20 lines (70 retitles) | 0.969 | 0.965 |

The title lowers every score a little — by 0.027 at the median on short
bodies and 0.004 on longer ones — and lowers swaps about as much, so the
ranking holds and only the cut moves. **A threshold must be chosen on search
vectors, not carried over from body vectors.**

**One exception: 940 of 11,584 documents are not stored as themselves.** A
group anchor's vector covers its folded children, and some single documents
carry a breadcrumb. 32 of the 316 real retitles are of that kind, and in 10
the shape differed between the two sides, which makes the two vectors texts of
different kinds. One scored 0.545 with a byte-identical body. For these the
gate should use the shipped rule and no vector.

**What the real retitles showed, which the earlier threads could not:**

| rule | retitles flagged, 1-3 lines | siblings missed | retitles flagged, 4-20 lines | siblings missed |
|---|---|---|---|---|
| routed by size (before thread 7) | 9.8% (21/214) | 34.3% | 10.0% (7/70) | 78.6% |
| shipped body test | 9.8% (21/214) | 34.5% | 5.7% (4/70) | 80.8% |
| word <= 0.50 alone (thread 8) | 9.8% (21/214) | 34.3% | 8.6% (6/70) | 32.7% |
| word <= 0.70 alone | 15.0% (32/214) | 22.7% | 10.0% (7/70) | 21.8% |
| search <= 0.70 alone | 12.6% (27/214) | 45.2% | 0.0% (0/70) | 61.5% |
| search <= 0.80 alone | 23.4% (50/214) | 20.7% | 4.3% (3/70) | 27.0% |
| search <= 0.85 alone | 36.0% (77/214) | 9.7% | 8.6% (6/70) | 17.8% |
| shipped, or search <= 0.80 | 26.2% (56/214) | 14.9% | 7.1% (5/70) | 23.6% |

| real retitles ranked above sibling swaps (AUC) | line | word | search vector |
|---|---|---|---|
| bodies of 1 to 3 lines | 0.613 | 0.884 | 0.859 |
| bodies of 4 to 20 lines | 0.844 | 0.947 | 0.965 |

- **On bodies of 4 to 20 lines the embedding is the best single measure.**
  `search <= 0.80` flags 3 of 70 real retitles and misses 27.0% of swaps; the
  word measure at its best comparable point flags 6 and misses 32.7%. With 70
  retitles the difference is three documents, so it is an indication and not
  a proof.
- **On bodies of 1 to 3 lines the word measure is better**, and no cut on the
  vector beats the shipped rule on both columns. A one-line sibling is too
  close in meaning.
- **Thread 7's rule holds on true siblings.** Against the routed gate it flags
  3 fewer real retitles in the mid band for 2.2 points more misses, and changes
  nothing in the short band.
- **The miss rates in threads 5, 7 and 8 are too low.** Those scripts took
  siblings by `parentId`. The heading depth is capped at 6 and 10,435 of 11,584
  documents sit at that cap; of those, 600 have a `parentId` that is their
  document-number parent. So only 13-14% of the "sibling" pairs were true
  siblings; the rest share a more distant ancestor. On true siblings the shipped test misses 35% of short
  swaps and 81% of mid-sized ones, not 8% and 49%. Every comparison
  BETWEEN rules in those threads was made on one population and still stands;
  the absolute rates do not.
- **"Retitles flagged" is not a false-flag rate.** The retitles are unlabelled,
  and reading the ones the gate flags shows both kinds. "Sky Ecosystem
  Emergency Response" → "Discord" and "RWA Instance Contract" → "Basin Factory
  Contract" are real repurposings, in upstream main. "Launch Agent 4 Details"
  → "Obex Details" is a rename the gate should have spared, and it is a known
  open defect: the body keeps exactly 9 of its 18 words (0.50, and the test is
  `<=`), and the rename replaces three of the title's four words, so
  `titleSubstitution` yields no key and no campaign can form. "Launch Agent 6
  Details" → "Osero Details" fails the same way. The whole shipped
  gate flags 22 of the 316.

That last point is also the best lead in this document: **upstream history
contains real repurposed UUIDs**, so a labelled set of real positives can be
built by reading the few dozen retitles any rule flags (`--samples` prints
them). Every miss rate above rests on synthetic swaps until someone does.

**The mid-sized ones are now read, and they set the bar.** Of the 70 real
retitles of 4 to 20 lines, 11 score 0.95 or less on the search vector:

| search cosine | what it is | how many |
|---|---|---|
| 0.713 to 0.833 | a procedure step holding a different step (upstream 93f7f49 reordered a procedure) | 5 |
| 0.846 | a procedure cut down to a one-sentence directory stub | 1 |
| 0.905 to 0.923 | a rename (LayerZero → SkyLink, Support Facilitators → Core Facilitator), four times, and one content edit | 5 |

The five at the top are real repurposed UUIDs. A bar of 0.80 misses two of
them; **0.85 catches all five**, and the one further document it flags is
described truthfully by "rewritten". The lines-and-words rule flagged two of
the five. The five share one commit, so they are one event, not five
independent ones.

**What was built** (`src/server/preview/embeddings.ts`, `REPLACE_MAX_COSINE` in
`identity.ts`):

- The preview build embeds every row that differs from the live store and
  writes `embeddings.json` into the bundle, in the row shape of
  `atlas_doc_embeddings`. Rows are matched by content hash, so unchanged text
  costs nothing. Preview search can read the same file.
- The gate judges a retitled body of more than 3 lines by the cosine of its
  old and new vector, bar 0.85. Shorter bodies, documents stored as a group,
  and any preview without vectors keep the lines-and-words rule.
- The old side comes from the live store by content hash, and is embedded
  only when the preview's base is behind live main.

Replayed end to end against the real store and provider
(`bun scripts/aux/identity-replay.ts`), upstream 93f7f49 as a preview of its
parent: 520 rows embedded in 11 seconds, a 3.0 MB file, and the gate flags 10
documents where lines and words flagged 7. The three it adds are the three
repurposed steps the old rule missed. The cosines it computes from the live
store's vectors match the measurement script's for the same pairs, so the
stored vector and the measured one are the same thing.

Two properties to know. `diff.json` for one sha now depends on whether the
provider answered when the bundle was built; a bundle built without vectors
is judged by lines and words, silently apart from a log line. And
`embeddings.json` is written but not yet read from disk or served: it is not
on the preview allowlist, and preview search will need an entry there and a
reader (`decodeVector`).

### 11. The entity rename — DONE

The false flag thread 10 found: "Launch Agent 4 Details" → "Obex Details". The
body names the agent four times in one sentence, so exactly 9 of its 18 words
survive, and the bulk-rename rule cannot help because the rename replaces
three of the title's four words and yields no key.

`renameScore` applies the title's own substitution to the old body and
measures what then survives. At `RENAME_MIN_KEPT` (0.90) or more the document
was renamed in place and is spared, unless its old content demonstrably moved.
It needs no second document to agree.

`bun scripts/aux/identity-rename-check.ts`, over the pairs the body test calls
replaced:

| spared at >= 0.90 | |
|---|---|
| real retitles | 2 of 29, both entity renames |
| sibling swaps | 0 of 1,846 |
| cousin swaps (same title, another agent) | 0 of 1,444 |
| unrelated swaps | 1 of 2,944 |

The two renames score 1.000 and the next real retitle 0.537. At 0.80 the rule
starts to spare swaps between one-sentence templates ("The party 'Sky'
comprises…" holding "The party 'Grove' comprises…", 0.833), which is why the
bar is 0.90. The whole gate now flags 20 of the 316 real retitles, from 22.

## Ordering

**1, 3, 4, 5, 6-groundtruth, 7, 10 and 11 are done.** The gate judges longer
bodies by the search vector (thread 10). What is left:

- **8** — whether long bodies should be judged on words alone. It now matters
  only where the gate has no vector: a preview built without an API key, and
  the 8% of documents stored as a group.
- **Short bodies** miss 35% of true sibling swaps and no measure tried here
  does better. The real retitles of 1 to 3 lines are unread; labelling them is
  the next measurement, and it is reading, not building.

**2** is a corroborator at best; do not build it as a gate.

Three ideas in **6** are checked and dead — don't re-derive them: the churn
prior (points the wrong way), the `change_kind` reuse (classifies #346
semantic), and the fingerprint-lineage lookup (a preview has no rows in these
tables, and the base snapshot already answers the present-tense question in
memory).

Whatever is picked up next, **measure it before building it**. Thread 3 was
built on reasoning and measured afterwards; the measurement happened to come
back clean, which does not make the order right.
