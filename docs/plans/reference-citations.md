# Reference-style citations for chat answers

> **Status (2026-08-03): shipped per model, not globally.** The prompt asks for
> reference style only for models on `CHAT_REFERENCE_CITATION_MODELS` (defaults
> to the strong chain); every other model is prompted inline. See
> "Rollout decision" below — it supersedes the framing in this Overview.

## Overview

Move the chat answer's citation format from inline-only `[Doc Title](/atlas/<uuid>)`
to markdown **reference-style** links, with the definition block at the **top** of
the answer:

```markdown
[spark-rate]: /atlas/a1b2c3d4-1111-2222-3333-444455556666
[keel-accord]: /atlas/b9c8d7e6-9999-8888-7777-666655554444

The Spark supply rate is [5%][spark-rate] as of today, set under the
[Keel Accord][keel-accord].
```

The inline form is **not** deprecated. The prompt asks for reference style; the
pipeline accepts both, permanently. A model that emits inline links mid-answer
produces a correct, fully-checked answer — just without the extra guarantees the
reference form buys. This is a tolerance requirement, not a migration.

## Why

Four measured problems, all addressed by the same change.

**1. UUID transcription is the dominant citation failure.** `citation-repair.ts`
exists solely because models cannot reliably copy 36-char UUIDs out of long tool
results; it near-miss-matches, prefix-matches, and title-matches to rescue them.
Under the inline form a doc cited five times is five independent chances to
garble the UUID. Under reference style each UUID is written **once**, in a
definition block, adjacent to its siblings — the easiest possible copying
context.

**2. Value claims cannot be bound to a source.** `findUntracedNumbers` asks only
whether a figure appears *anywhere* in the turn's evidence — it cannot
distinguish "5% appears in some retrieved doc" from "5% appears in **the cited**
doc". (It also skips integers ≤ `SMALL_COUNT_MAX` = 20, so a bare "5%" is never
examined at all.) Reference links make `[5%][spark-rate]` natural to write, which
makes per-doc value grounding checkable in pure code.

**3. Truncation destroys all links at once.** A `lengthCapped` answer loses its
tail. With definitions at the top they survive whatever gets cut; the prose that
did arrive keeps working links.

**4. The streaming gate is per-link and fragile.** `stream-link-gate.ts` holds
token text from `[` until a link closes, judging each link individually. With the
citation table arriving first, the whole set can be validated **once**, before any
prose reaches the user — and one repair fixes every use of that doc.

## Verified behaviour

Rendering was tested directly against the real `AtlasMarkdown` component
(`react-markdown` + `remark-gfm`).

| case | result |
|---|---|
| resolved reference link | `<a href="/atlas?id=a1b2…">5%</a>` — the existing `a` interceptor catches it by href, **no renderer change needed** |
| definitions at the **bottom**, mid-stream | renders literal `[5%][spark-rate]` for the entire answer until the block arrives |
| definitions at the **top**, mid-stream | resolves live, the moment the label's `]` lands |
| `extractSources` on a reference-only answer | returns `[]` — the Sources cluster goes empty |

Definitions-first streaming, token by token:

```
t1  The Spark supply rate is [5%][spark-             ← raw, ~1 label's width
t2  The Spark supply rate is <a …>5%</a> as of
t3  …as of today, set under the <a …>Keel Accord</a>.
```

The raw window is one label wide, comparable to the hold `stream-link-gate`
already introduces. remark strips definition nodes from output, so the block
itself never renders.

The link gate passes both `[text][label]` and `[label]: /atlas/<uuid>` through
**unmodified** (in its `after` state it sees `[` or `:` instead of `(`, flushes
raw, and resumes). So nothing is corrupted today — reference links are simply
ungated, which is what §"Streaming and the gate" changes.

## Measured: model compliance (2026-07-28)

Three runs each on `google/gemma-4-31b-it` (default tier) and `openai/gpt-5-mini`
(strong tier), with four real atlas docs supplied as a tool result and the draft
citation rules in the system prompt. **Two of the four docs share the exact title
"Proportional Linear Scale - Element Annotation"**, to exercise label collision.
Harness: `scratchpad/citetest.ts`.

| | gemma-4-31b-it | gpt-5-mini |
|---|---|---|
| definition block first | 3/3 | 3/3 |
| definitions emitted | 4/4 docs, 3/3 runs | 4/4 docs, 3/3 runs |
| **invalid UUIDs** | **0** | **0** |
| same-title collision disambiguated | 3/3 | 3/3 |
| value used as link text | 3/3 (heavy) | **0/3** |
| malformed citations | 2/3 runs | 0/3 |

**The central hypothesis holds.** 24 UUID usages across the six runs, zero
transcription errors, because each UUID is written once in a block instead of
repeated inline. Both models disambiguated the identical-title collision unasked —
gemma by suffixing `-1`, gpt-5-mini semantically
(`proportional-linear-scale-activity` / `-communication`), which is the better
output. Mixed-format tolerance was exercised for real: one gemma run emitted two
inline links alongside its reference links.

**Value-as-link-text does not come for free.** gemma adopted it naturally
(`[less than 95%][voting-activity-metrics]`, `[95% down to 75%][…]`,
`[5% for every percentage point drop][…]`). gpt-5-mini used it **zero** times in
three runs, reverting to doc-title link text and leaving figures in plain prose.
The single prompt example was not enough. Since the strong tier handles the
hardest questions — where value grounding matters most — the per-doc value check
would get no coverage there as currently worded. **The prompt needs an explicit
directive**, not an example, if that check is to earn its place.

## Measured: full bakeoff after rollout (2026-08-03)

`pnpm eval:bakeoff`, 14 queries × the four deployed models (default, both
approved fallbacks, strong tier), judge `gpt-5.6-terra`, atlas `4101dc75`. 55
successful runs, 475 citations. The report is `.cache/eval-bakeoff.json`; the
bakeoff now runs `normalizeAndRepair` before grading, because a reference answer
contains no inline citation for any checker to see.

**Citation integrity — the central hypothesis, confirmed at scale.**

| across 475 citations | count |
|---|---|
| invalid citation UUIDs | **0** |
| bare / truncated `/atlas/…` hrefs | **0** |
| citations repaired by `citation-repair` | **0** |
| citations stripped (unrepairable) | **0** |
| invalid doc numbers | 0 |
| doc_no mismatches | 1 (glm-5.2) |

Not one garbled UUID in the whole grid. `citation-repair.ts` — written because
models cannot copy 36-char UUIDs — did nothing at all.

**This does not isolate reference style as the cause.** The run was HEAD-only, no
old-prompt baseline, and two of the four models wrote mostly inline links
(adoption 29% and 64% below). So what is measured is "UUID garbling is absent on
these four models in both formats", which is stronger than the plan predicted but
is not evidence for the causal claim that reference style *reduces* garbling. An
A/B against the inline prompt is still the only thing that would establish that,
and it was deliberately skipped.

**Format adoption is model-dependent, and the default tier is the weak one.**

| | gemma-4-31b-it (default) | gpt-5-mini (strong) | glm-5.2 | haiku-4.5 |
|---|---|---|---|---|
| reference style used | 29% | 93% | 69% | 64% |
| definition block first | 0% | 93% | 15% | 0% |
| definitions / run | 2.4 | 6.0 | 7.9 | 4.9 |
| citations / run | 4.0 | 11.7 | 13.4 | 5.8 |
| value used as link text | 13% | 7% | 1% | 16% |
| hard failures / run (after the fix below) | 0.79 | 0.21 | 0.23 | 0.43 |
| mean judged score | 0.72 | 0.80 | 0.76 | 0.61 |

Every remaining hard failure is concentrated in two runs: gemma's
`multisig-security` (11 `[text][label]` uses with **no definition block at all** —
the predicted undefined-label degradation, all 11 de-linkified and reported), and
haiku's `did-you-know` (6 real value misattributions, independently confirmed by
the judge: "290 is total responsibilities, not JanSky's; blurb 9 cites the wrong
document"). Both are true positives.

**One false-positive class found and fixed.** gemma writes a doc's own UUID as
link text (`[7ac692f1-9829-41d8-…](/atlas/7ac692f1-…)`, 7 of its 56 citations).
`citationValues` mined the digit runs out of it — `692`, `9829`, `41`, `053302` —
each short enough to occur incidentally in some other retrieved doc, and reported
them as figures misattributed to the cited doc: **36 spurious hard failures from
a single run**, enough to force a full-transcript recovery replay in production.
`citationValues` now strips UUIDs before mining, exactly as it already stripped a
leading doc_no. Recomputing the grid offline from the saved tool results: 36 → 0
spurious, haiku's 6 true catches preserved.

**Streaming placement is the real cost of low adoption.** `blockFirst` overstates
the problem — what matters is whether any use streams before its definition, since
until then remark renders literal `[text][label]`. Measured on raw answers
(`eval-bakeoff` now records `usesBeforeBlock`): gemma put the block on line 2
under a one-line intro for one query (harmless, no use precedes it) but at the
**bottom** for another, with 11 uses ahead of it across a table — visible bracket
junk for the whole stream, resolving only at completion. `definition-block-gate.ts`
degrades correctly in both cases (first real line isn't a definition → straight to
the inline gate, no stall), so this is a rendering nuisance, not a hang.

### Two failure modes to handle (both confirmed by direct render)

**1. Multi-label citation.** gemma, 2/3 runs, when a claim is genuinely supported
by two sibling docs:

```
[95% down to 75%][proportional-linear-scale-element-annotation, proportional-linear-scale-element-annotation-1]
```

Not valid CommonMark. Renders as literal text:
`<p>the range is [95% down to 75%][a, b] overall.</p>`. The intent is
unambiguous, so the normalizer should split the label list on commas and emit
consecutive links; the prompt should also state one label per citation, cite
twice for two sources.

**2. Bare shortcut bracket.** gemma, 2/3 runs: `a range of [20 percentage points]
applies` — brackets with no label at all. Renders literally, brackets visible.
The normalizer must strip bracket-only spans that resolve to no definition, since
they are emphasis gone wrong rather than citations.

Neither appeared on gpt-5-mini. Both produce visible junk in the answer, so both
must be handled in the normalizer regardless of prompt wording.

## Rollout decision (2026-08-03)

**Reference style is prompted per model, not globally.** `CHAT_REFERENCE_CITATION_MODELS`
(config, defaults to `CHAT_MODEL_STRONG`) is the allowlist; `citationStyleFor()`
in `model-router.ts` is the single decision point, and `chat.ts` routes the tier
*before* building the prompt so the format follows the model that will read it.
Everything downstream — normalization, repair, the gate, the checks, the Sources
cluster — still accepts both forms from every model, permanently. This is prompt
wording only.

The rule is keyed on the **model**, not the tier, for two reasons: format
compliance is a property of the model (swapping `CHAT_MODEL_STRONG` for a model
that can't hold the format should not silently keep asking for it), and the evals
must reproduce production's choice for any candidate they run — `eval-bakeoff`
calls the same `citationStyleFor()`.

Inline is the default because it is the form every measured model follows. The
reference-style prompt also now states the block must precede any heading or
intro sentence, and forbids labelling a definition with the UUID itself.

Verified live (4 cells, 2 queries × both tiers): gemma emits inline only — no
definition block, no undefined labels, no ungrounded values — and gpt-5-mini
emits the block first in both runs with nothing streaming ahead of it.

### Re-measured after the split (2026-08-04, hand-graded)

Full grid re-run with the per-model prompts, `--no-judge`, graded by hand against
each query's rubric (`.cache/eval-bakeoff-grades.json`; the run stopped 11 cells
short on an OpenRouter credit exhaustion, so haiku has only 4 runs and is not
comparable).

| | mean | support | complete | honest | hard/run | cites/run | format |
|---|---|---|---|---|---|---|---|
| glm-5.2 | **0.925** | 0.96 | 0.98 | 0.92 | 0.15 | 14.3 | inline |
| gemma-4-31b-it | 0.856 | 0.93 | 0.83 | 0.78 | **0** | 7.7 | inline |
| gpt-5-mini | 0.786 | 0.89 | 0.67 | 0.87 | 0.21 | 12.1 | reference |
| haiku-4.5 (4 runs — not comparable) | 0.72 | 0.79 | 0.66 | 0.70 | 0 | 9.0 | inline |

haiku's four surviving cells are three of the field's easiest enumeration
queries plus one it failed outright, so its row is a biased sample, not a
ranking. glm is 13/14. Only gemma and gpt-5-mini ran the full set.

**The split helped both models that moved.** Same models, same queries, prompt
the only variable:

| citations | 08-03 (all reference) | 08-04 (inline) |
|---|---|---|
| gemma | 56, **7/14 runs uncited** | 108, 6/14 uncited |
| glm | 174, **4/13 runs uncited** | 186, **0/13 uncited** |
| gpt-5-mini (control, unchanged) | 164, 1 uncited | 170, 2 uncited |

glm's uncited answers went to zero and its hard failures with them; gemma nearly
doubled its citation volume and posted **zero** hard failures across 14 runs. The
control did not drift, so this is the prompt, not run-to-run noise.

**What the split did not fix.** gemma still ships 6 of 14 answers with **no
citation at all** — and they are exactly the synthesis answers (primitives
structure, multisig security, roles, individuals, organizations, quarterly
timeline) where a reader most needs sources. The facts in them spot-check correct;
they are simply unverifiable as delivered. `uncitedParagraphs` sees this and is a
soft signal only. That is the next thing to fix for the default tier, and it is a
prompt/model question, not a format one.

**Reference style is not what holds gpt-5-mini back.** It has the best citation
discipline in the field (93% adoption, block first, every threshold in the
multisig answer bound to its own doc and value-checked) and the worst
completeness: it twice concluded the atlas lacks something it holds — no transfer
records (gemma and glm both built ~20-row ledgers from the same atlas) — and once
refused a clear question to ask clarifying ones. That is under-retrieval, and it
scored the same way under the old all-reference prompt, so the format is not the
cause.

### Found while grading, now fixed: agent snippets are verbatim

Not a citation-format issue, but it surfaced through this eval's
`findUngroundedQuotes` hits and is more consequential than anything above.

`buildSnippet` (`src/server/retrieval/search.ts`) runs **`compactProse`** over
every snippet it returns. This predates the citation work — every
`atlas_search` / `atlas_query` result the chat has ever returned has carried it.
The pass strips `the|a|of|an|and|or|for|in|on|to|at|by|with|from`
and abbreviating words (`communication`→`Comms.`, `information`→`Info.`,
`document`→`Doc.`) to fit more content per byte. It feeds `atlas_search`
(`tools.ts:146`) and `atlas_query` (`query.ts:310`) — the two tools the system
prompt pushes hardest.

So the model's most common view of a document is text the atlas does not contain:

| | text |
|---|---|
| atlas | "Core GovOps manages **the** overall dispute resolution process, including establishing **communication** channels **for** dispute resolution, communicating **with the** parties, **and** gathering **and** analyzing **information** relating **to the** dispute." |
| snippet the model got | "Core GovOps manages overall dispute resolution process, including establishing **Comms.** channels dispute resolution, communicating parties, gathering analyzing **Info.** relating dispute…" |

Three consequences, all observed in this grid:

1. **Users are shown mangled quotes.** glm's roles-positions answer quotes
   `Comms.` and `Info.` — strings that appear nowhere in the atlas.
2. **Repairing the grammar is punished.** A model that restores the dropped
   stopwords produces a quote that matches no evidence text, and
   `findUngroundedQuotes` hard-fails it — which in production forces a full
   transcript replay. Five of glm's hard failures this run were exactly this.
3. **Meaning is distorted.** Dropping `of`/`for`/`to` in governance prose changes
   claims: "responsible **for** the Agent" → "responsible Agent", "transfer **to**
   Y" → "transfer Y".

**Fixed** by splitting the two audiences rather than changing one for both.
`buildAgentSnippet` (same module) returns a verbatim window — no word dropped,
abbreviated or reordered, only whitespace runs collapsed, both ends pulled back
to word boundaries so the text is quotable. `atlas_search` (`tools.ts`) and
`atlas_query` (`query.ts`) use it. `buildSnippet` keeps compacting, unchanged,
for search-result display, where density is what a human scanning hits wants.

Measured on the doc that produced the mangled quote: the agent snippet is now a
literal substring of the atlas, and the exact quote that hard-failed glm scores
0 ungrounded instead of 1. Cost, over 800 docs: **-17% content words per
snippet** (31.6 → 26.1) at essentially the same character budget (238 → 230) —
compaction was buying far less density than it appeared to, because it spent the
saved characters on a wider window it then truncated anyway.

## The format contract

**Definition block.** First thing in the answer, before any prose. One definition
per line, no blank lines within the block, terminated by a blank line.

**Labels are slugs** derived from the document's title, or its doc_no when the
title is ambiguous: lowercase, non-alphanumerics collapsed to `-`
(`Spark Supply Rate` → `spark-rate` is acceptable; a truncated-but-recognisable
slug is fine). The label is load-bearing: it is what lets repair recover a doc
whose UUID is garbled, exactly as link text does today for inline citations.

**Link text is free.** It may be the doc title, a quoted phrase, a value, a date,
or an address. `[5%][spark-rate]`, `[three signers][keel-multisig]`, and
`[Keel Accord][keel-accord]` are all valid.

**Every cited doc must appear in the definition block.** A label used but never
defined is a defect (see "Degradation").

## Normalization: the implementation shortcut

The entire checking layer keys on the inline shape — `CITATION_SRC`,
`extractCitations`, `findBareAtlasLinks`, `findDocNoMismatches`, `MD_LINK_SRC`,
`normalizeForMatch`, `findUngroundedQuotes`, `findLowOverlapCitations`,
`repairCitations`, and the frontend's `ATLAS_LINK_RE`.

**Do not teach each of them the new form.** Add one pure function that expands
reference links into canonical inline form, and run it first:

```ts
// src/server/chat/verify/citation-normalize.ts
export function expandReferenceLinks(answer: string): {
  content: string;                       // canonical inline form
  definitions: Map<string, string>;      // label → href, as declared
  undefinedLabels: string[];             // used but never defined
  unusedLabels: string[];                // defined but never used
}
```

It must also repair the two measured malformed shapes, since both otherwise ship
as visible brackets: split a comma-separated label list into consecutive links,
and strip bracket-only spans that match no definition.

Everything downstream keeps working unchanged. This collapses the blast radius
from "every regex in the verification layer" to one module plus the prompt, the
Sources cluster, and the gate.

Normalization must be **idempotent** and must leave inline links untouched, so an
answer mixing both forms — the expected real-world case — normalizes cleanly.

## Component changes

### `system-prompt.ts`
Replace the citation rules with the reference-style contract. State the definition
block goes first, that labels are title/doc_no slugs, that link text is free, and
that inline `[Title](/atlas/<uuid>)` remains acceptable if a citation is decided
mid-sentence. Keep the existing "UUID copied verbatim from this turn's tool
results" rule — it applies to the definition block now.

### `citation-repair.ts`
Repair operates on the **definition block**, not on each use. `createLinkJudge`'s
resolution ladder is unchanged (exact → near-miss → truncated-prefix → text
match); the "text" it matches on becomes the **un-slugified label** rather than
the link text. One repaired definition fixes every use of that doc — a strict
improvement on today's per-link repair.

For inline links appearing alongside, today's path applies as-is.

### `stream-link-gate.ts`
New responsibility: buffer the definition block (it is the first thing to stream,
and is small), validate and repair the whole citation table before releasing it,
then let prose stream unheld. Reference links in the prose need no per-link gating
because their targets were already validated. Retain the current per-link gate for
inline links, which can still appear mid-prose.

### `verify-checks.ts`
No changes beyond consuming the normalized content — that is the point of the
normalization layer. `findLowOverlapCitations` benefits automatically: link text
is stripped before scoring, so free-form link text neither helps nor hurts it.

### `markdown.tsx` / `Sources.tsx`
`extractSources` must read the definition block (or, more simply, run the same
normalization and then scrape the canonical form). Separately and worth doing
regardless: **`Sources.tsx` should take each chip's title from
`docs.json` (`b.docs[uuid].title`), not from link text.** It already loads that
bundle to resolve `doc_no`. Under the new format link text is often a value, so
trusting it would render chips labelled "5%".

## New check: per-doc value grounding

Reference citations make this checkable, and it is the sharpest wrong-doc signal
available in pure code. For a citation whose **link text is a value** — a number,
percentage, date, or on-chain address — assert that the literal occurs in the
target doc's content.

Treat a miss as a **hard failure**, on the same reasoning as
`findUngroundedAddresses`: a value cannot be paraphrased or synthesised, so
citing a doc that does not contain it is a misattribution, not a stylistic
variance. Normalize thousands separators and percent forms before comparing, and
skip values that are plainly computed (a total the answer derives from cited
parts) — mirror `findUntracedNumbers`'s existing soft-signal reasoning for those.

This complements rather than replaces `findLowOverlapCitations`: overlap scores
prose sentences, value-grounding scores citations whose text *is* the claim.

## Degradation

Ranked by likelihood.

**Undefined label** (model uses `[text][label]` without declaring it). Most likely
failure. Repair by matching the label against docs retrieved this turn; if that
resolves uniquely, synthesise the definition. Otherwise **strip to plain text** —
never leave raw `[text][label]` brackets in a shipped answer. Count a stripped
citation as a hard failure exactly as `repairedChecks` does today.

**Definition block emitted at the bottom.** Renders correctly; only streaming is
degraded. Accept silently — do not fail an otherwise-correct answer over block
placement.

**Model ignores the format entirely** and emits inline links. Fully supported.
No warning, no penalty.

**Truncation mid-definition-block.** A half-written definition line is a parse
failure for that label only; its uses fall to the undefined-label path.

## Validation before rollout

- **Golden eval, both formats.** Run `pnpm eval:golden` and compare the citation
  validity rate, since the whole premise is that reference style reduces UUID
  garbling. Expect fewer `invalidCitations` and fewer repair-strips.
- **Normalization property tests.** Idempotence; inline-only unchanged; mixed-form
  answers; undefined and unused labels; a definition block at top vs bottom.
- **Streaming test.** Extend the direct-render harness used above to assert that
  a definitions-first partial answer resolves links before the answer completes.
- **Sources cluster.** Assert chips show real doc titles, not link text, for both
  formats.

## Sequencing

1. `expandReferenceLinks` + property tests. Inert until anything calls it.
2. Wire normalization into the orchestrator ahead of repair and checks. No prompt
   change yet — verifies the no-op path on today's inline answers.
3. `Sources.tsx` title fix + `extractSources` via normalization.
4. Prompt change. This is the switch; everything before it is preparation.
5. Gate rework (validate the citation table up front).
6. Per-doc value grounding check.

Steps 1–3 are safe on their own and independently valuable. Step 4 is the only
one that changes model behaviour, and it is a one-line revert if the eval regresses.

## Open questions

- **Does an up-front definition block constrain the model's writing?** It must
  commit to its citation set before composing prose. It has just finished
  retrieval so it knows what it read, but under-declaring is the predictable
  failure and is why the undefined-label path must degrade gracefully.
- **Label collisions** across docs with similar titles — un-slugified matching
  must preserve `titleIndex`'s existing ambiguity handling (a label matching two
  docs resolves to neither).
- ~~**Do small models follow reference format reliably?**~~ **Answered** — see
  "Measured: model compliance". Both tiers comply; zero invalid UUIDs.
- ~~**Label collisions** across docs with similar titles.~~ **Answered** — both
  models disambiguated identical titles unasked, 6/6. `titleIndex`'s ambiguity
  handling still governs repair when a label matches two docs.
- ~~**How hard should the value-as-link-text rule be?**~~ **Answered, negatively.**
  The explicit directive shipped, and it barely moved: 1–16% of citations carry a
  value (gpt-5-mini 7%, up from 0/3 under the example alone). The per-doc value
  check therefore runs on thin coverage — 6 catches in 55 runs, all on one model —
  and it cost one false-positive class to get there. It earns its place (those 6
  were real wrong-doc attributions nothing else caught), but it is not the primary
  wrong-doc defence the plan hoped for. Wording the directive harder is the next
  lever if the check is to carry more weight.
- ~~**Does an up-front definition block constrain the model's writing?**~~
  **Answered.** No under-declaration problem: only 1 run in 55 used labels it
  never declared. But adoption is 29–93% and the block leads the answer only
  0–93% of the time, so an up-front block is the exception outside gpt-5-mini —
  the streaming win the format was designed for is only reliably collected on the
  strong tier.
- **Should the default tier keep reference style?** New. gemma adopts it in 29% of
  turns, never leads with the block, uses UUIDs as labels (defeating label-based
  repair), and produced the one undefined-label failure in the grid — while citing
  a third as often as the models that adopted the format. Either the prompt names
  the block placement far more forcefully, or default-tier routing is revisited.
