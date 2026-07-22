# Concept Catalog — audit plan & triage verdicts

Analysis of `docs/library/concepts.md` (the /library Concepts tab) with one
question per section: **leave alone, scrutinize, or rewrite?** Written
2026-07-22 for the user to decide against. The DR-onboarding saga (three
user-caught errors, all traced to relaying agent output without reading source)
is the motivating precedent: this catalog was built the same way in places.

## The rubric — four evidence tiers

Every claim in the catalog has one of four provenances; the verdicts follow
mechanically from the tier, not from how plausible a claim sounds:

- **T1 — Script-censused**: computed by our own scripts over docs.json /
  relations.json / glossary / processes.json. Re-runnable, byte-grounded.
  → *Leave alone* (re-run per atlas bump).
- **T2 — Source-read**: I read the doc's verbatim content in-session.
  → *Leave alone*.
- **T3 — Agent-derived, since corroborated**: subagent claim later verified
  (UUID check, content read, or census). → *Leave alone, keep the check.*
- **T4 — Agent-derived, unverified**: relayed from a subagent report without
  reading source. → *Scrutinize; rewrite if checks fail.* This tier produced
  every error found so far.

## Spot-checks already run (2026-07-22) — calibration for the verdicts

| Claim (section) | Result |
|---|---|
| 10 Ecosystem Accord UUIDs (D1) | ✅ 10/10 resolve to claimed doc_nos |
| Safe Harbor contract address (D7) | ✅ present verbatim at A.2.11.1.2.1/.2.2.2 |
| SSR BEAM bounds 200–3000 bps (Ep3) | ✅ verbatim at A.3.1.2.2.2.1 |
| Solana SkyLink 5M USDS/day (Ep8) | ✅ verbatim at A.4.2.2.2.3.2.2 |
| "~15+" transitionary measures (D10) | ⚠ was an uncensused guess presented as census — actual: 20 (fixed) |
| Ranked-Delegate rank-loss rule (D6) | ❌ **INVERTED** — tenet says loss of rank after triggering is *inconsequential*; catalog claimed a rank-loss penalty (fixed, with correction note) |

Calibration read: the instruments agent's *pointers* are excellent (10/10
UUIDs), its *numbers* are decent, but its *characterizations of rules* can be
exactly backwards. That is the risk profile the plan below targets.

## Verdicts by section

### Leave alone (T1/T2 — censused or source-read)

- **A. Meta-concepts** (A1–A7): doc-type counts, glossary, NR gaps, overlay
  spreads — all censused. The ghost-type list (A1) is a provable set difference
  (30 spec'd types vs 12 occurring types).
- **B. Lifecycle** (B1–B7): title-template counts, entity/instance censuses,
  Omni contents (read). 
- **C. Procedural** (C1–C6): title censuses, processes.json, cite-hub counts.
- **E. Quantitative** (E1–E5): all censused; E5's unknown RRC expansion is
  honestly flagged.
- **F. Entity layer, G. Duties, H. Registries, I. Cite hubs**: entity/edge/
  registry-liveness censuses; duty analysis is our own 322-edge sample (note
  in-doc that it's a sample of 854).
- **Part II indexes**: derived views of the above; II.5 cross-check is
  interpretive but low-stakes.
- **Part III ghost layer**: censused (payment registries, 0-USD budgets,
  budget-docs-vs-types).

### Scrutinize (T3/T4 — targeted checks, keep unless a check fails)

Priority order = damage-if-wrong × cheapness-to-check:

1. **Ep9 formula transcriptions** (LGD, Smart Contract Risk Rating, Lindy
   factor, stUSDS rate, SKY Borrow curve) — agent-copied math, transcription
   risk is the highest-stakes residue in the catalog. Check: diff each formula
   against the source doc's LaTeX (script: grep the 54 A.3.2 math docs + A.4.4).
2. **Ep4/Ep8 numeric parameters** — Smart Burn kicker/splitter values, "45% of
   Step 3", PSM tin/tout/buf (800M unverified), Avalanche/Plasma "initially
   unlimited". Check: content-grep each value at its claimed doc.
3. **D3 AEP machinery numbers** — 240M SKY ratification minimum, 2-week
   duration, >1% agent-token submission threshold. Check: read A.1.12.2.6 and
   the per-agent submission requirement docs.
4. **D5 spell details** — Protego contract, Standby Spell process. Check: read
   A.1.10.5.2–.3.
5. **D6 remaining items** — 6-month delegate terms, conflict-of-interest
   disclosure (now ⚠-flagged in the doc). Check: read the Spark delegation
   framework docs (they live in Spark's Omni tree).
6. **D8 "exactly 1 dispute precedent"** — check the Dispute Resolutions Active
   Data content.
7. **D1 accord anatomy** ("Key Details + Substantive Terms" per accord) —
   pointers verified; structure claim not. Cheap subtree title check.
8. **D2 mutual-exclusion rule** (Root Edit + Executor Accord cannot both be
   deactivated, A.2.2.1.2.4.2.1) — read the doc.
9. **D7 IPFS URI** — grep it.

### Rewrite (structural, not just spot-fix)

1. **Dn1–Dn9 normative families**: the taxonomy is useful but it is the suspect
   agent's *frame* with our corrected numbers bolted on. Rewrite as a
   census-first section: derive each family from a scripted detection pass
   (title patterns + duty_for/edge data we already have), quote one exemplar
   per family from source, and drop any family we can't mechanically detect.
   The "justice pipeline" synthesis is ours and worth keeping — but label it
   explicitly as interpretation, not Atlas text.
2. **Ep1–Ep9 prose**: keep the structure (it survived spot-checks well) but
   after the value-verification pass (#1–2 above), rewrite surviving claims to
   quote-or-cite form, matching the discipline now used in the DR onboarding
   doc. Values that fail verification get corrected inline with a note.
3. **Add epistemic-status labels throughout**: every group gets a `[T1]`…`[T4]`
   tag (or ✅/⚠ markers) so a reader can see at a glance which statements are
   byte-grounded vs agent-reported. The catalog's credibility depends on
   making its own uncertainty visible.

### Process changes (so this audit doesn't rot)

- **`scripts/aux/verify-concepts.mjs`**: turn the spot-checks into a standing
  script — UUID resolution, value greps, title censuses — runnable per atlas
  bump; wire its output into the LOG. The catalog then degrades loudly, not
  silently, when the Atlas moves.
- **Standing rule (already in LOG, applies here)**: agent reports are leads,
  not sources. Nothing enters the catalog above T3 without a read or a census.
- **Corrections stay visible**: keep in-place correction notes (as done for
  D6) rather than silently rewriting — the catalog is scholarship, and its
  error history is part of the record.

## Suggested execution order

1. ~~Fix D6 inversion + transitionary count~~ (done with this commit).
2. Run the Ep9/Ep4/Ep8 value + formula verification sweep (checks 1–2) — one
   session, script-driven; fix failures inline.
3. Checks 3–9 (mostly single-doc reads) — batchable in one pass.
4. Dn rewrite as census-first (the one real rewrite; ~a session).
5. Epistemic labels + verify-concepts.mjs last, so labels reflect the
   post-verification state.
