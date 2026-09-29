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

| measure | t | ordinary edit flagged | real swap missed | siblings missed |
|---|---|---|---|---|
| word (shipped) | 0.50 | 2.0% | 5.4% | 9.3% |
| **idf** | **0.40** | **0.9%** | **5.0%** | **7.0%** |
| idf | 0.30 | 0.2% | 8.5% | — |

At t=0.40 it **dominates the shipped measure on both axes** — less than half
the false flags *and* fewer missed swaps. The three #346 docs score 0.62–0.81,
still well clear.

To ship it: document frequency can be built in-process from the base
snapshot, which the preview build has already parsed, so `identity.ts` stays
no-IO if the DF map (or an `idf(token)` function) is passed in as an argument
rather than imported. Scratch implementation is in this session's notes —
it is ~20 lines, the same DP as `orderedWordContainment` with `+idf(w)` in
place of `+1`. Re-measure before picking the threshold; 0.40 is from one run.

### 2. Structural corroboration — probably the biggest single win

A content rewrite in place changes *only* content. A genuine repurposing
almost always disturbs something structural too: the doc moves to a different
parent, its type changes, its children are replaced by different UUIDs, or its
doc number moves. Requiring **content replacement AND at least one structural
change** would have silenced all three #346 docs (`renumbered` was empty for
them) at close to zero cost in recall.

Prerequisite: `SnapshotDoc` (`src/server/preview/snapshot.ts`) currently
carries only `id, doc_no, title, content, contentHash`. `parentId` and `type`
are available in both builders for free — `loadAtlasSource` yields them and
`docs.json` stores them — so widening the type is a two-line change in
`snapshotFromSrcDir` and `snapshotFromDocsJson`.

### 3. Corpus-level rename detection — targets #346's class exactly

The per-doc gate structurally cannot see that **all three #346 docs had the
same old title and the same new title**. Three UUIDs independently repurposed
to an identical new title is implausible; one rename campaign is obvious.

Detect a shared transformation across the changed set — identical
(oldTitle → newTitle) pairs, or the same substring substitution applied to
several docs — and suppress the swap for every member. Cheap, deterministic,
and it generalises to every future terminology pass.

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

If picking this up cold: **3** (corpus-level rename, cheapest and kills the
reported class outright) → **2** (structural corroboration, biggest accuracy
win) → **1** (IDF, already measured as a strict improvement) → **4** (copy) →
**5** (embeddings, only if the residual turns out to matter).
