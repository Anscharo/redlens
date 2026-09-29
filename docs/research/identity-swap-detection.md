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

### 1. IDF-weighted lexical overlap — measured, Pareto-better, not yet shipped

**This is the most promising thread and it needs no network.** The plain word
LCS counts every matched token as 1, so stopwords dominate. But the
discriminating token in the hard sibling case is the *entity name* (`Keel` vs
`Obex`) — rare, and therefore nearly weightless today. Weight each matched
token by its inverse document frequency over the corpus instead.

Measured over the same populations:

| measure | t | ordinary edit flagged | real swap missed | hard siblings missed |
|---|---|---|---|---|
| word (shipped) | 0.50 | 2.0% | 5.4% | 9.3% |
| idf | 0.40 | 0.9% | 5.0% | 9.3% |
| **idf** | **0.45** | **1.7%** | **4.0%** | **7.5%** |

**idf at 0.45 dominates the shipped measure on all three columns** — fewer
false flags, fewer missed swaps, and better on the hard sibling case that
every similarity approach struggles with. idf at 0.40 also dominates on the
first two while tying on siblings, if you want the lower false-flag rate. The
three #346 docs score 0.62–0.81, still well clear either way.

Compare only at *matched* false-flag rates — the arms are not comparable
threshold-for-threshold, and an earlier version of this note mistakenly
credited idf's 0.50 sibling number (7.0%) to its 0.40 row. Down at the very
low end (≤0.4% false flags) the unweighted measure is still competitive; the
gain is in the middle of the range, which is where a usable operating point
sits.

To ship it: document frequency can be built in-process from the base
snapshot, which the preview build has already parsed, so `identity.ts` stays
no-IO if the DF map (or an `idf(token)` function) is passed in as an argument
rather than imported. Scratch implementation is in this session's notes —
it is ~20 lines, the same DP as `orderedWordContainment` with `+idf(w)` in
place of `+1`. Re-measure before picking the threshold; 0.40 is from one run.

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

### 4. Make the un-corroborated case descriptive rather than accusatory

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

## Ordering

**3 is done.** Of what is left: **1** (IDF — measured, dominates the shipped
measure, only needs a DF map threaded in) → **4** (copy, pure risk reduction
and independent of everything else) → **5** (embeddings, only if the residual
turns out to matter). **2** is a corroborator at best; do not build it as a
gate.
