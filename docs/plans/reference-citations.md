# Reference-style citations for chat answers

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
- **How hard should the value-as-link-text rule be?** gpt-5-mini ignored the
  example entirely. An explicit directive ("when a claim is a number, percentage,
  date, or address, make that value the link text") should be tried and
  re-measured before committing to the per-doc value check, since that check is
  worthless without the behaviour it depends on.
- **Does an up-front definition block constrain the model's writing?** Still open,
  though six runs produced no under-declaration — every doc used was declared.
