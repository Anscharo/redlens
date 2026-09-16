# Corpus detector vetoes

**Date:** 2026-09-16
**Detector:** `template-divergence` (`scripts/lib/mistakes-corpus.mjs`)
**Question:** of the template divergences the detector reports across the eight Prime Agent artifacts, which are the artifacts legitimately differing rather than the template drifting?
**Method:** read each divergent sentence in every artifact it appears in, at atlas SHA `d64eca48`. The detector's own output is the claim under review; the Atlas text is ground truth.

This note exists because `rejectedIn` must point at the review that actually argues a veto. These sixteen are detector output and are not discussed in the contradiction false-positives note, which covers a different pass.

---

## Bottom line

**Sixteen of the detector's 36 findings are vetoed.** None is the template drifting. They fall into three kinds:

1. **The artifacts really are different.** Each Prime names its own executor agent, its own relayer multisig, its own protocol deployment. A detector that compares the same slot across artifacts will always surface these, because that is what the slot holds.
2. **Structural difference by design.** Some Primes hold a named Liquidity Layer; others reference the Allocation System Primitive directly.
3. **Wording with no difference in meaning.** Singular vs plural, "subdocuments" vs "documents", "Instances of the Primitive" vs "Primitive Instances".

The twenty that survive are divergences in what a sentence *says*: a link routed to a different document, a threshold stated against a different base, a possessive written without its apostrophe, an emergency-protocol clause present in half the artifacts.

## Verdicts

| Finding | Why it is not drift |
|---|---|
| `2.2.1.2.1.1.1#amatsu` | Amatsu and Ozone are different Operational Executor Agents. Spark, Grove and Keel use one; Skybase, Obex, Pattern, Osero and Launch Agent 7 the other. |
| `2.2.1.2.1.1#amatsu`, `2.2.1.2.1.1.2#amatsu`, `2.2.1.2.1.2#amatsu`, `2.2.1.2.1.3#amatsu` | The same executor-agent split, in the four sibling documents of that Instance. |
| `2.6.1.1#allocation`, `2.6.1.3#allocation`, `2.6.1.4#allocation` | Spark, Grove, Keel and Obex hold a named Liquidity Layer; Skybase, Pattern, Osero and Launch Agent 7 point at the Allocation System Primitive. A structural difference between the agents, not a wording slip. |
| `2.6.1.2.1.2.2.2.4#prime`, `2.6.1.2.1.2.2.1.4#prime`, `2.6.1.2.1.2.2.1.4#primary` | Relayer multisigs are named per agent — Core Operator Relayer Multisig, Prime Secondary Relayer Multisig, or plain Relayer Multisig. Each artifact names its own. |
| `2.6.1.3.1.1.1.2#maple` | SparkLend and Maple USDC are different protocol Instances. Each artifact names its own deployment. |
| `2.6.1.3#coverage` | An extra clause about RRC Framework coverage, which only the artifacts with covered Instances need. |
| `2.6.1#of` | "Instances of the Allocation System Primitive" vs "Primitive Instances". Phrasing. |
| `2.3.2#instances` | Singular vs plural in a directory blurb. |
| `2.6.1.3.1.1.1.2.4#documents` | "subdocuments" vs "documents" for the same containment relation. |

## What this says about the detector

Every veto above is a **false positive by construction**, not a bug: the detector's job is to notice that one slot reads differently across artifacts, and an agent naming its own executor is exactly that. The signal survives anyway because the vetoes are recorded — `suppressRejected` keys on `(uuid, category, quote)`, so each stays out of later runs until the Atlas rewrites that sentence, at which point a human should look again.

Two limitations are worth stating rather than discovering:

- **A three-way split is reported as two rows** against the majority reading, not one row describing the split.
- **ALL-CAPS tokens are masked as the agent's own**, so a slot where one artifact says `SKY` and another says `USDS` compares equal. That is the price of masking token symbols, which is what makes any comparison possible at all.
