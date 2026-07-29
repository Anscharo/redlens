# Concept Catalog — audit plan & triage verdicts

Analysis of `docs/anatomy/concepts.md` (the /anatomy Concepts tab) with one
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

1. ~~**Dn1–Dn9 normative families**~~ — **done 2026-07-27** (census-first
   rewrite; see "Dn rewrite outcome" below).
2. **Ep1–Ep9 prose**: keep the structure (it survived spot-checks well) but
   after the value-verification pass (#1–2 above), rewrite surviving claims to
   quote-or-cite form, matching the discipline now used in the DR onboarding
   doc. Values that fail verification get corrected inline with a note.
3. **Add epistemic-status labels throughout**: every group gets a `[T1]`…`[T4]`
   tag (or ✅/⚠ markers) so a reader can see at a glance which statements are
   byte-grounded vs agent-reported. The catalog's credibility depends on
   making its own uncertainty visible.

### Dn rewrite outcome (2026-07-27)

Each family was re-derived by a detection pass actually run over
`public/docs.json` + `public/relations.json`; a family kept its place only if a
pass found it, and every surviving family now carries a verbatim exemplar read
from `vendor/next-gen-atlas/content/**`.

| Family | Verdict | Signature | Count |
|---|---|---|---|
| Dn1 Duties | survived | `duty_for` edges (relations.json), grouped by role + source scope | 854 edges / 635 docs / 8 roles |
| Dn2 Prohibitions | survived | title `/Prohibit/` + the existing content census | 11 title / ~52 content |
| Dn3 Suspension | survived, **signature replaced** | title `/Suspen/` minus lifecycle status buckets | 5 (was mis-stated as 140+136) |
| Dn4 Derecognition | survived | title `/Derecogni/` or `^Swift Action` + `listed_in` registries | 14 (+11/+9 registry rows) |
| Dn5 Escalation & precedence | **demoted** to a labeled 4-doc pointer list | none general — title hits are 1+1+3 across three senses; content precedence regex returns 13 unrelated docs | — |
| Dn6 Conduct standards | survived, **narrowed** | title `/Operational Security/` or "Err On Side Of Caution" | 12 (Usage Standards ×33 dropped — multisig layer) |
| Dn7 Adjudication & proof | survived | title `/Adjudicat/` or "Standard of Proof" | 5 (13-doc subtree) |
| Dn8 Alignment/misalignment | survived | title `/Universal Alignment/` or `/Misalign/` | 22 |
| Dn9 Edit restrictions | survived, **narrowed** | title `/Edit Restriction/` | 10 (ADC claim dropped) |

Three inherited claims were false and are corrected in place: Dn1's "all 854
sourced from A.1" (real spread A.1 347 · A.2 245 · A.6 181 · A.3 49 · A.4 32),
Dn3's signature (it counted the B2 lifecycle machine), and Dn6's Usage Standards
attribution. The justice-pipeline chaining is kept but relabeled **our
interpretation, not Atlas structure**, with the doc-level links that *are* Atlas
text listed separately. A second, structurally parallel enforcement pipeline
(A.3.2.2.7 capital-requirement breaches → penalties → conservatorship) was found
during the pass and recorded.

Seven of the title signatures are now a standing census
(`normative-title-families` in `src/lib/conceptsCensus.ts`, rendered inline via
`:::census`), so they re-run per atlas bump. Dn1 stayed a documented one-off:
it reads `relations.json`, and `conceptsCensus.ts` is docs-bundle-only by design.

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

## T3/T4 value-verification sweep (2026-07-27) — checks #1–9 results

Byte-level verification against `vendor/next-gen-atlas/content/**` at the
checked-out atlas commit (4101dc7). Same format as the spot-checks table;
every ❌/⚠ row is corrected inline in concepts.md with a visible note.

| Check / claim (section) | Result |
|---|---|
| #1 SCRR = min[CAP,(SR+CCR)·LAF·AF] (Ep9) | ✅ verbatim at `00fd9362` A.3.2.2.1.2.2; CAP currently 30 |
| #1 Lindy Adjustment Factor "log-age discount" (Ep9) | ✅ `227eff62` A.3.2.2.1.2.2.4 — max(0, 1 − ln(1+λ·AGEeff)/ln(1+λ·max)); exact formula now quoted |
| #1 LGD (Ep9) | ✅ formula located (`c9bd4928` A.3.2.2.1.1.1.1.1.2) — but the catalog's chain "PD→LGD→EAD→RWA→required capital" was ❌ **conflated two models**: Lending Markets is PD→LGD→R→K→RRC (EAD only in the final step); RWA belongs to the Real World Assets process (fixed, with note) |
| #1 stUSDS rate "over SSR+borrow+utilization" (Ep3) | ✅ `7e51d5a7` A.4.4.1.3.2 — gloss omitted the −Rfactor·f(Utilization) term; exact formula now quoted |
| #1 SKY Borrow piecewise utilization curve (Ep3) | ✅ `05e97d4d` A.4.4.1.3.5.1.2 — two-slope around Target Utilization; quoted |
| #2 Smart Burn "Step 3, 45%" (Ep4) | ⚠ **incomplete** — source (`5ce73730` A.2.3.1.2.4) splits Step 3 Capital 45% SKY-buyback-to-stakers / 45% USDS staking rewards / 10% buyback-and-burn (fixed, with note) |
| #2 kicker/splitter values (Ep4) | ✅ `ddb90fee` A.3.5.2: khump −200M USDS, kbump 6,000 USDS, hop 13,787 s, splitter 100/0, burn 100% (values now quoted) |
| #2 SPLITTER_MOM exempt from GSM delay (Ep4) | ✅ verbatim at `5247c795` A.1.10.3.2.8 |
| #2 PSM tin/tout 0% + buf 800M (Ep8) | ✅ `8694e11a` A.3.3.2.7.1.1.2 — unit is DAI; "per Accord terms" for the Grove transition was unsupported (softened to the ALM article's own sentence, `39473e1a`) |
| #2 Solana SkyLink 5M USDS/day (Ep8) | ✅ verbatim at `8414b48b` A.4.2.2.2.3.2.2 (re-confirmed) |
| #2 Avalanche/Plasma "initially unlimited" (Ep8) | ❌ **wrong vs current source** — Avalanche is 0 USDS/day (`6d550b28`), Plasma 5M USDS/day (`527a2195`) (fixed, with correction note) |
| #3 AEP: 240M SKY min, 2 weeks, binary (D3) | ✅ verbatim at `13e6da57` A.1.12.2.6 (Minimum Positive Participation) |
| #3 blocked AEPs cannot resubmit unchanged (D3) | ✅ Action Tenet `523bfc8f` A.1.12.2.1.7.2.0.4.1 (must be edited before resubmission) |
| #3 ">1% agent-token submission threshold" (D4) | ⚠ off-by-boundary — source says "at least 1% of the circulating token supply", in per-agent Root Edit instances (Keel `98f59541`), not the A.2.2.6.2 spec (fixed) |
| #4 Protego + Standby Spells (D5) | ✅ `13cdbb75` A.1.10.5.3 / `5e40b575` A.1.10.5.2 — both quoted; Emergency Drop Spells live under the Protego subtree |
| #5 6-month delegate terms + COI disclosure (D6) | ✅ but scope-qualified — Spark's framework: `c612d4e4` A.6.1.1.1.3.1.3.4.3 (fixed 6-month calendar-half-year terms), `d08b9b32` /.4.1 (COI collection at onboarding), `16eb44b8` /.3.4 (abstain only for disclosed conflicts) |
| #6 exactly 1 dispute precedent (D8) | ✅ `c48614bb` A.2.8.1.2.0.6.1 lists a single entry — Spark/Grove, 2025-09-02 |
| #7 accord anatomy "Key Details + Substantive Terms" (D1) | ✅ 10/10 subtrees have exactly "Accord Key Details" + "Accord Substantive Terms"; caveat: Accord 2 is titled just "Prime Program", so the title-template signature misses it |
| #8 Root Edit/Executor Accord "mutual exclusion" (D2) | ❌ **mischaracterized** — `a4797404` A.2.2.1.2.4.2.1.2 prohibits deactivating *either*, ever ("must have active … at all times"); not a mutual exclusion (fixed, with correction note) |
| #9 Safe Harbor IPFS URI (D7) | ✅ verbatim at `0064ee74` A.2.11.1.2.2.3.1 (bafkreiernns2f…); contract address at `0f541963` A.2.11.1.2.2.2 |

Calibration held: pointers and raw numbers survived well (all UUIDs/values
located); the failures were again *characterizations* — a rule's shape (D2), a
formula chain's structure (Ep9), and values gone stale vs source (Ep8
Avalanche/Plasma).

## Suggested execution order

1. ~~Fix D6 inversion + transitionary count~~ (done with this commit).
2. ~~Run the Ep9/Ep4/Ep8 value + formula verification sweep (checks 1–2)~~
   (done 2026-07-27 — results table below).
3. ~~Checks 3–9 (mostly single-doc reads)~~ (done 2026-07-27 — same sweep).
4. ~~Dn rewrite as census-first (the one real rewrite; ~a session).~~ (done
   2026-07-27 — see "Dn rewrite outcome" above.)
5. Epistemic labels + verify-concepts.mjs last, so labels reflect the
   post-verification state.
