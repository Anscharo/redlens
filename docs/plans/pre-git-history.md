# Pre-git history: true origins for every atlas doc

Status: **Phase A IMPLEMENTED (2026-07-07)** — genesis + MIP origins ship from
`scripts/prehist/` (`prehist:genesis`, `prehist:mip`); Phase B (forum context) and
Phase C (MIP-era change history) remain planned. **Phase B method revised
2026-07-07 after a provenance measurement** (`recovered/forum-provenance-
measure.json`, `prototypes/measure-forum-provenance.mjs`): forum→doc association
is title-collision-heavy (56% of title matches hit >1 doc; title-only linking is
~75% false-positive on the collision tier), so the gate moves to 8-word
body-shingle containment and the shippable output is **~76 trustworthy per-doc
links**, not the ~300–500 the first draft implied — see stage 3. Data collection
+ feasibility measurement DONE 2026-07-06 (all numbers below are measured, not
estimated — see "Collected data"). Successor / implementation plan for the research in
`atlas-prehistory-mips.md` (eras 1–3a) and `forum-severed-era-history.md` (the
severed-window reconstruction). Builds on the shipped HTML-era pipeline
(`html-era-history.md`, `scripts/htmlhist/`).

## Product goal

Today the oldest history entry a doc can have is **"Added" at the first git
commit `4e931dfd` (2025-05-28)** — which is wrong for the ~35% of the atlas that
is older than the git repo. Replace that false floor with each doc's true origin:

1. **"Proposed in MIP \<N\>"** — docs whose verbiage traces to the MIP-era Atlas
   (MIP101 + the five scope BMAAs in `makerdao/mips`, 2023-02 → 2024-09). First
   entry becomes e.g. *Proposed in MIP104 §14.3 — 2023-11-06*, linking to the
   section in the (public, frozen) mips repo.
2. **"Present at Atlas v2 genesis"** — docs alive in the recovered genesis
   snapshot (IPFS, 2024-09-02). An **exact** fact, not a reconstruction: the doc
   existed on day one of Atlas v2, ~9 months before git history starts.
3. **Severed-era interval births** — docs born between genesis and the first git
   commit get an honest interval birth ("first appeared between 2024-09-02 and
   2025-05-28"). The forum association/linking work is explicitly **deferred to
   Phase B** (2026-07-07 decision: not enough time to do it correctly today).
   When it happens, forum material still **never enters the history table**
   (decided 2026-07-06: proposals are pre-ratification text and don't map 1:1 to
   state changes; emitting them as events would fabricate change types and dates
   that downstream consumers, chat included, would repeat as fact). It will live
   in its own context table; the history panel may link to a new per-doc
   forum-era page only for body-corroborated matches.
4. **Git-era docs stay exactly as they are.**

## Measured landscape (2026-07-06)

Today's atlas (10,370 docs) by birth era, measured end-to-end (genesis parse →
`matchNodes` bridge to `4e931dfd` → frozen html-era artifact → `docs.json`):

| Born | Count | First-entry treatment |
|---|---|---|
| At/before genesis (2024-09-02) | **613** | "Present at genesis"; **231** of them also "Proposed in MIP N" (content containment ≥0.05 — the Gate-4-calibrated auto-lock line, measured 98.4% strict precision; was 179 at the pre-calibration ≥0.25 threshold) |
| Severed era (2024-09-02 → 2025-05-28) | **2,530** | Interval birth + forum snippets where covered. **1,649 of these are Agent Scope Database rows** (Agent-launch operational data, not cycle-proposed); the 881 core docs are the forum-snippet audience |
| Git HTML era (root → #117) | 3,104 | unchanged (existing reconstruction) |
| Markdown era (post-#117) | 4,123 | unchanged |

Other load-bearing measurements:

- **Genesis parses with the existing converter as-is.** `parseHtmlToNodes` on the
  recovered IPFS HTML yields **890 nodes** across 10 sections (no Agent Scope
  Database section yet), scopes `A.0`–`A.5`.
- **Genesis→root bridge is strong.** `matchNodes(genesis, root, {seedHop,
  recoverByContent})` matches **756/890 (85%)** — 641 of them tier-1 exact
  content. The 134 without a locked bridge = **118 genuinely unmatched (died
  inside the severed era; 29 of them MIP-traceable — a datable graveyard) + 16
  ambiguous**, plus 28 containment (split/absorb) candidates — the ambiguous +
  containment go to curation.
- **MIP attribution works by content, not structure.** The v1→v2 renumbering is
  *not* mechanical (content moved across artifacts, e.g. GSM Pause Delay:
  MIP113 §10.1 → A.1.9; scope order changed). 8-word shingle **containment**
  against the six v1 artifacts gives clean §-level citations (many at 1.0).
  Attribution per MIP (score ≥0.25, genesis docs): MIP101→39, MIP104→65,
  MIP106→84, MIP107→9, MIP108→15, MIP113→22, adjacent MIPs (102/109)→3.
  The large no-match mass is *real*: Annotations/Tenets/Type Specs/Needed
  Research (the GAIT-designed supporting-doc strata) and v2-new content like the
  A.1.4 adjudication cluster ("adjudication" appears nowhere in the mips repo).
- **"Proposed in" dates are real dates, not one blanket date.** `git log
  --reverse -S<section title>` over the mips clone dated **160/160** matched MIP
  sections, spread **2023-02 → 2024-08** (median 2023-05..08). Fallback for the
  undatable: MIP ratification 2023-03-27.
- **All six v1 artifacts are still `Status: Accepted`** in the frozen mips repo —
  the "orphaned still-active legacy MIPs" housekeeping gap Retro flagged is
  confirmed (nothing was ever marked Obsolete at the v2 cutover).

## Collected data (in-repo, `scripts/aux/atlas-history/`)

- `recovered/genesis-2024-09-02.html` — the genesis snapshot fetched from the
  #25010 IPFS CID (693,633 bytes; **sha256 byte-verified against the CID digest
  2026-07-06** after stripping a Cloudflare-injected honeypot anchor — see the
  README gotcha; stage-3 IPFS poll-doc fetches must do the same
  strip-and-verify). **Commit this**: it is the single unrecoverable-elsewhere
  anchor (the ecosystem's IPNS pinning already lapsed once).
- `recovered/mip-corpus.json` — 1,076 sections extracted from the 13 atlas-track
  MIPs (6 core + 7 adjacent), final frozen state.
- `recovered/mip-genesis-lineage.json` — per-genesis-doc records: MIP attribution
  (file + §-level + scores), root bridge result, resolved uuid, seam, alive-today.
- `recovered/mip-section-dates.json` — first-appearance date per matched MIP §.
- `recovered/forum-coverage.json` — per-proposal parse stats + coverage summary.
- `severed-proposals/*.md` — raw markdown of all **29** severed-window Atlas Edit
  cycle proposals (392 KB; fetched 2026-07-06 from `forum.skyeco.com/raw/<id>/1`).
- `prototypes/*.mjs` — the five measurement scripts (extract corpus, measure
  lineage, date sections, fetch proposals, parse+coverage). They ran against a
  scratch clone of `sky-ecosystem/mips` and scratch paths; parameterize when
  promoting to a real pipeline.

## Pipeline design

New self-contained script family `scripts/prehist/` (mirroring the `htmlhist`
pattern: off the `pnpm build` chain, own `prehist:*` entry-points, one shared
runbook). Emits **one frozen artifact `public/history-pre-era.json`** with the
same envelope discipline as `history-html-era.json`, upserted into Postgres
`atlas_history` by `build:history` exactly the way html-era rows already are.

### Stage 1 — genesis anchor (exact; ships alone)

`prehist:genesis`
- Parse `recovered/genesis-2024-09-02.html` with `parseHtmlToNodes` (unchanged).
- Bridge to `4e931dfd` via `matchNodes` (settings above). Persist the 756-pair
  bridge + the ambiguous/contained queues in the artifact for later curation.
- Resolve root rows → uuids by **re-running the html-era seed threading**
  (ride-along decision below) rather than the `(docNo|title)` order-heuristic
  join the measurement prototype used — the heuristic resolved 3,823/4,019 but
  assumes event order matches node order for colliding keys; re-threading
  removes the assumption. The unresolved remainder are merged-into rows with no
  own uuid.
- Emit per bridged uuid: an `added` event, `era='genesis'`, date `2024-09-02`,
  source = the IPFS CID + gateway URL. "Bridged" includes docs that died
  *during the git era* — they already have uuids (real or html-era synthetic)
  and history rows; the genesis origin attaches the same way (the 613 in the
  landscape table counts only alive-today docs; the artifact covers the dead
  bridged ones too, same zero-UI-cost argument as MIP-on-tombstones).
- Emit for every root-added uuid *not* bridged to genesis: a **severed-born
  marker** (`era='severed'`, interval `2024-09-02 → 2025-05-28`), and classify
  `agentDb: true` for Agent Scope Database rows (1,649 vs 881 core).
- Graveyard (genesis docs with no root match — 118, plus whatever curation
  rejects from the 16 ambiguous): synthetic v5 uuids (`syntheticUuid`, same
  namespace scheme as htmlhist §4.3), `removed` event inside the severed
  window. These only surface in search/history browsing of dead docs — same
  policy as html-era tombstones.

### Stage 2 — MIP origins (near-exact; ships with stage 1 or right after)

`prehist:mip`
- Corpus: the six v1 artifacts core, the seven adjacent atlas-track MIPs
  (102/103/105/109–112) as secondary. Extraction regex per prototype.
- Match each genesis doc by shingle containment. **Auto-lock ≥ 0.05** (Gate-4
  calibrated: 60/61 strict precision across 74 labeled docs; low score = heavy
  rewriting, not wrong attribution). Record best file + best § + both scores;
  every event carries them. **Title-hit alone never locks** — it produced
  generic-title false positives ("Cycle Breakdown", "Override Mechanism") and
  one measured wrong-MIP attribution; title-hits go to a curation hint list
  only.
- Date each matched § via `git log --reverse -S` in a mips clone (cached
  `.cache/mips/`); fallback ratification date 2023-03-27.
- Emit per traced, alive uuid: an `added`-shaped origin event, `era='mip'`, the
  §-citation, score, date, and a GitHub URL to the section in
  `sky-ecosystem/mips` (line-anchored where derivable).
- Docs whose genesis ancestor died before git: attach the MIP origin to the
  synthetic tombstone uuid (29 docs) — history for the graveyard, zero UI cost.

### Stage 3 — severed-era forum context (approximate; independent cadence)

`prehist:forum`

**Method — measured, precision-first (revised 2026-07-07; evidence
`recovered/forum-provenance-measure.json`, script
`prototypes/measure-forum-provenance.mjs`).** The central correction to the
original design: **title matching is only a candidate *generator*, never the
gate.** The gate is **8-word body-shingle containment — the exact Gate-4
machinery** — because title-alone is *measurably* wrong most of the time on the
matches that need adjudicating. A per-doc forum link ships only for the
trustworthy tier below; everything else is era-level context or the stage-1
honest interval, never a per-doc claim.

Measured over the **2,524 severed-born-alive docs**:

- **Title evidence is thin and collision-heavy.** Only **438 (17%)** have any
  forum title match at all. Of those, **56% (246) collide with >1 current doc of
  the same title** — the direct mis-attribution mechanism (`Sky Primitives`
  matches 10 current docs, `Operational Executor Agent` 9, `Treasury Management`
  4). **275 of the 438 are prose-mention only** (title appears as a substring
  somewhere) — the weakest and largest tier; 129 of those have titles under 20
  chars (pure substring-collision fuel).
- **De-collision proves the risk is real, not theoretical.** Shingling each
  colliding bullet's *body* against its same-titled candidates: of 92 colliding
  bulleted docs, only **14** have this doc as the clear body-winner, and **69
  (75%) actually match a *sibling* better** — i.e., naive title-linking would
  mis-attribute them. **75% is the measured false-positive rate of title-only
  linking on the collision tier.**
- **The trustworthy subset is small and date-concentrated: 76 docs** = **62**
  (reproduced as an explicit edit-set doc-bullet ∩ globally-unique title ∩ not
  present at genesis) **+ 14** (colliding bullets rescued by a clear
  body-containment win: abs ≥ 0.10, margin ≥ 0.05 over the runner-up sibling).
  **52 of the 62 come from a single proposal `#26262` (2025-04-11)**, the rest
  from `#26291`/`#26209` (Apr 2025) plus one Nov 2024 doc. Only the
  format-gen-3 mega-proposals that inline whole doc subtrees as titled nodes
  produce trustworthy per-doc links; the early severed era (Sep 2024–Feb 2025)
  yields essentially none *by forum text* (see the poll-IPFS lever below for the
  only path into that window).

Pipeline consequences:

- **Candidate generation — parser must handle three format generations**
  (measured):
  1. *Sep–Nov 2024*: explicit `**§Add new document: A.x - Title**` /
     `**§Delete document and all subdocuments: …**` headers (note the real
     wording — a `§` sigil, "new", inconsistent `document`/`Document` case; the
     old spec's `**Add Document:**` shape does not occur in the corpus) +
     `%%…%%` fenced content blocks; no nested bullets.
  2. *Nov 2024 – Feb 2025*: `###` edit-set sections, `**Verb**` markers, prose
     bodies (the `#25590` 73 KB shape).
  3. *Mar–May 2025*: edit-set sections whose bodies are **full nested doc trees**
     (`- **Title** *(Type)* - content`) — effectively complete document content
     inline; a first-pass regex extracts **453 doc bullets** with titles + types
     + bodies. Tolerate `*(Core)*`/`(*Core*)`/`**(Core)**` variants. **This is
     the only generation that yields trustworthy per-doc links.**
- **Multi-post continuation is now provenance-relevant, not just completeness.**
  `#26262` is the "split into two posts" case and we have parsed only post 1;
  its post 2 almost certainly extends the Risk Capital tree and the trustworthy
  count (est. 76 → ~80–90). Fetch `raw/<id>/2..n` driven off the manifest's
  `posts_count` (deterministic), not a phrase-sniff on "split into two posts".
- **The gate = body-shingle containment.** For every title candidate, shingle the
  forum bullet/edit-set body and score containment against the doc's
  genesis/root content. Unique-title bullets pass automatically (no sibling to
  lose to); colliding bullets must **win de-collision** (this doc's body-score is
  the clear max) or they are dropped, not linked. Store the containment as
  `confidence`; the score, not the `match_basis` label, is the trust signal.
- **On-chain poll IPFS docs: promote from dating source → content spine.**
  `atlas-onchain-polls.json` (21 polls, CIDs, `tx`, dates) covers the *whole*
  window including the early part forum text can't reach. Each poll doc is
  content-addressed + on-chain-ratified — an immutable second primary source,
  strictly better than the (mutable, editable) Discourse post. Fetch **and
  freeze/commit** the 21 poll docs (same reproducibility discipline as the
  genesis HTML; the ecosystem's IPNS pinning already lapsed once), shingle them,
  and use them to (a) corroborate every forum match against the *ratified* text,
  (b) reach early-window docs that forum prose misses, and (c) read the vote
  tally (tally contract `0xD3A9FE…`, poll emitter `0xF9be…`) for a real
  `ratified` flag — **`poll_tx` presence ≠ ratified.**
- **Output is a context artifact, not history events** (`public/forum-context.json`
  → its own Postgres table, see "Ordering / storage"). One row per
  (doc, proposal, edit-set) match, keyed to the bridged uuid — schema below.
  **Zero rows in `atlas_history`** — no fabricated change types, no diffs.
- **Per-doc links ship only for `match_tier ∈ {unique-bullet, decollided-bullet}`
  (the 76).** The **prose-mention tier (275) never becomes a per-doc link** — it
  is FP-prone by construction; keep it only as *era-level* context (design-post
  links per cluster), if at all.
- A trustworthy-tier match (bullet + body-containment win) **that also lands in a
  ratified poll** may **upgrade the stage-1 interval birth to a dated birth — via
  the curation queue only**, never automatically. That upgrade is the single
  sanctioned path from forum data into the history table; it lands as a
  human-locked decision with `method='human'`. Note the tightening is modest:
  the trustworthy docs cluster in Apr 2025, so "born on/before the cycle date"
  narrows the interval by only ~6 weeks — real, but not dramatic.
- **Where a birth can't be pinned, leave the stage-1 interval** — the honest
  default for the ~2,450 uncovered. **The Agent Scope Database rows (1,649) will
  never be cycle-covered** — operational data added by Agent launches, not
  proposed edits. Give them a distinct interval label ("added during Agent
  launch operations") and link the framework design posts (`#26047` "Sky
  Primitives", 2025-02-25; `#25031` Launch Season, 2024-09-06) at the era level,
  not per-doc.
- **Powerhouse UUIDs are too sparse to key on** — 32 distinct phUuids across all
  29 proposals (only 8 of 29 proposals carry any powerhouse link), and they are
  a namespace that doesn't join to today's `docs.json` uuids anyway. phUuid is a
  bonus corroborator when present, never the spine.
- **Overlap rule** (unchanged): **forum is a source only before 2025-05-28**; the
  55 overlap-window proposals are the parser/gate calibration set (Gate 5 below),
  nothing else.

### Stage 3b — git-era agent commits have identifiable forum sources (sweep 2026-07-06)

A quick sweep (commit date − 14 days, per agent-doc commit cluster; script
`prototypes/sweep-agent-forum.mjs`, results `recovered/agent-forum-sweep.json`,
107 candidate topics) shows the git-era Agent Scope DB commits map cleanly onto
recurring forum series the enumeration never captured:

- **"[\<spell date\>] Proposed Changes to \<Agent\> for Upcoming Spell"** — per-agent
  (Spark, Grove, Keel, Obex, Prime) spell-cycle proposals; dates line up with the
  instance-config/ALM commits (e.g. "[June 12, 2025] Proposed Changes to Spark" →
  PR #10; the Oct 30 Spark/Grove posts → PRs #89/#90/#91).
- **Launch announcements / technical scopes** — "Introducing Grove" (2025-06-25 →
  PR #22 window), "Introducing Keel: Solana's Capital Engine" (2025-10-07 → PR #66,
  the Launch Agent 2→Keel rename), "Technical Scope: Launch of the Agent 4
  Allocation System", "Technical Scope of the Kicker launch".
- **SAEP-xx** ("Spark Atlas Edit Proposal" — SAEP-02, SAEP-03): an agent-scoped
  atlas-edit series entirely absent from the weekly-cycle tags.
- **"Sky Agent Framework Overhaul"** (2025-08-04 → PR #34 window).

Consequence: the `forum_doc_context` table should be **era-agnostic** — git-era
commits keep their exact history, but a context row "this commit's changes were
proposed in \<post\>" is just as valuable there, and the [−14d, commit] window +
title-series matching is a workable attachment heuristic. The severed-era root
snapshot itself gets little from a 2-week window (its agent mass accumulated
Feb–May 2025); that window is served by the design-post links from stage 3.

### Stage 1c — curated AEP upgrades: IMPLEMENTED (2026-07-07, ahead of Phase B)

The "Ordering / storage" section below anticipated exactly this: *"A high-
confidence match... may upgrade the stage-1 interval birth to a dated birth —
via the curation queue only, never automatically... it lands as a human-locked
decision with `method='human'`."* Built early, in a small, tightly-scoped form,
independently of the full Phase B forum-context system:

- **Corpus**: the atlas repo carries its own formally-numbered proposal series,
  `vendor/next-gen-atlas/Atlas Edit Proposals/AEP-1.md` … `AEP-11.md` — distinct
  from the ~84 informal, undated-status "Atlas Edit Weekly/Monthly Cycle
  Proposal" forum posts Phase B's stage 3 targets. Each AEP file has real front
  matter: `AEP#`, `Status` (`Accepted` | `Rejected` | `Rejected-Misaligned` |
  `Formal Submission`), `Date Proposed`, `Date Ratified`, `Forum URL`, and a
  `List of Edits` section naming the specific docs it **adds** (as opposed to
  merely references as surrounding context — e.g. AEP-1's preamble links its
  parent container A.1.10.1.6 as *where* three docs were added; only the three
  named additions are match candidates, never the parent).
- **Scope, deliberately narrow (2026-07-07 decision)**: only `Accepted` AEPs are
  eligible — a rejected AEP proposed no real change, so it structurally cannot
  be matched to a doc (`apply-aep-upgrades.mjs` hard-throws if its input ever
  contains a non-`Accepted` entry). Of the 11 files, only **AEP-1** (ratified
  2025-02-24) and **AEP-11** (ratified 2025-06-23) are `Accepted`; the other 9
  are out of scope, permanently (not "later" — a rejected proposal has nothing
  to attribute).
- **AEP-1** (ratified inside the severed window): its three newly-added docs —
  "Governance Facilitators' Role in Adding Housekeeping Items In Executive
  Votes" (now titled "Core Facilitator's Role...", renamed since), "Definition
  Of Housekeeping Items", "Process for Adding Housekeeping Item In Executive
  Vote" — matched cleanly by title against current `docs.json` (doc_no prefix
  `A.1.11.1.5.1.x`), and independently corroborated: each doc's *own*
  `atlas_history` row already recorded its earliest event as a real `added`
  (birth), never a modify, confirming these are genuine new-doc introductions,
  not edits to something pre-existing. **Shipped**: their generic "First
  appeared somewhere in the severed era" placeholder is replaced (not merely
  supplemented) with *"Present in Atlas Edit Proposal 1" · 2025-02-24*,
  `method='human'`. **Links the AEP file in the git repo** (`vendor/next-gen-
  atlas/Atlas Edit Proposals/AEP-1.md`, pinned to `4e931dfd` — the file's only
  commit, so root and "current" are identical) — not the forum thread; the
  forum URL is still recorded in `aep-upgrades.json` as provenance but isn't
  the clickable link (corrected 2026-07-07: the proposal *text* the doc
  actually descends from lives in the repo, the forum post is just where it
  was originally discussed).
- **AEP-11** (ratified 2025-06-23, *after* root) — its whole doc subtree (11
  docs under A.2.7/A.5.2, matched via the same title technique) was added in a
  single real git commit (`403ed53`) dated **exactly** the ratification date —
  about as strong a corroboration as this technique produces. **Deliberately
  not touched**: since root (2025-05-28) predates ratification, these docs
  already have fully correct, exact git history (real commit, real diff, real
  date) — there's no false-floor gap to close, only a "this PR implemented
  AEP-11" annotation to add on top of an already-correct event, which doesn't
  fit this mechanism (built to *replace* a placeholder, not annotate a correct
  one) and isn't worth a new mechanism for one doc-set. Documented here as a
  confirmed, deferred nice-to-have, not a gap.
- **Implementation**: `scripts/prehist/aep-upgrades.json` (hand-curated, small —
  one entry per Accepted AEP, listing its matched docIds) +
  `scripts/prehist/apply-aep-upgrades.mjs` (`prehist:aep`). Idempotent
  find-and-replace by docId (never blind-append), but **must run last** — after
  both `prehist:genesis` and `prehist:mip`, which would otherwise regenerate the
  generic placeholder this script replaces. The old generic row (different
  `commit_sha`, so an upsert alone would sit *alongside* it rather than replace
  it) is tracked in the artifact's `supersedes` array and `DELETE`d
  automatically by `build:history` — no manual DB step (see `apply-aep-
  upgrades.mjs`'s exported pure `applyAepUpgrades` + `scripts_tests/
  apply-aep-upgrades.test.ts`, which caught a real bug: an early version
  re-recorded a self-referential supersede entry on every re-run).

### Stage 1d — corroborating the 16 ambiguous / 28 contained / 24 sub-threshold (2026-07-07)

Follow-up dig into the three "deferred to curation" buckets Gate 2 and Gate 4
left behind — not a new stage in the pipeline sense, but real findings that
changed `genesis-bridge.mjs`'s locked set:

- **3 of the 16 ambiguous pairs confirmed by domain knowledge, not scoring**:
  `A.3.2 "Stars Credit Line Borrow Rate Risk Limits"` → `"Agents..."`, its
  sibling `"Stars Credit Line Borrow Rate"` → `"Agents..."`, and `A.1.9 "Spark
  Star"` → `"Spark Agent"` — all the same v1→v2 rebrand ("Star" tier renamed
  "Agent"), confirmed by a human who knows the domain, not by a score crossing
  a line. Added as `CONFIRMED_AMBIGUOUS` (same pattern as `ADJUDICATED_LOCKS`,
  but promoting `m.ambiguous` entries matchNodes never even proposed as
  pairs — a different code path, since ambiguous items aren't in `m.pairs` at
  all). The other 13 stay unresolved ("will need to corroborate more" —
  correctly left alone, not force-closed).
- **The 28 "contained" bucket stress-tested — only 2 survive**: the ORIGINAL
  seedHop check (matchNodes tier 4) asked "is ≥60% of this root doc's content
  found somewhere in genesis" and took the single best-coverage match as "the
  parent," with no check for whether that parent was unique. Re-running every
  one of the 28 through `findContainer` (already in `ordered-containment.mjs`,
  built for exactly this — ≥90% order-preserving containment, ≥1.3× size, and
  **null the instant a second container also qualifies**) rejected 26 of 28.
  All 7 "Element Annotation" + 2 "Responsible Provision of Evidence" + 2
  "Research Track" + 1 "Systematic basis of adjudication..." instances were
  rejected — confirmed boilerplate-template collisions (the same titles repeat
  verbatim across dozens of unrelated docs; high coverage was coincidental
  reuse of shared prose, not a real split). The genuinely unique survivors:
  **"SparkLend Risk Parameters Current Configuration"** ← genesis's "Current
  Configuration", and **"Sky Core Governance Responsibility For Virtual
  Revenue Share Prior to Launch of SPK"** ← genesis's "Spark Protocol-Aave
  Revenue Share". Wired into `computeGenesisBridge` as tier `confirmed-split`;
  same zero-UI-cost treatment as any other locked pair.
- **24 sub-threshold MIP hints (score 0.007–0.049) — analyzed, not yet acted
  on**: cross-checked each against two independent signals: (1) title-hit — a
  distinctive substring of the doc's own title (≥8 chars) found verbatim
  inside the SAME best-matching MIP file's raw text; 8 of 24 hit. (2) expected
  scope→MIP domain (A.0→101, A.1→113, A.2→106, A.3→104, A.4→107, A.5→108) —
  most A.1.x hits landed on MIP101 instead of the "expected" 113, but this
  isn't noise: MIP101 ("Immutable Alignment Artifact") is thematically about
  facilitator conduct/alignment broadly, and every one of those docs IS an
  alignment-conduct topic ("Facilitators Must Err On Side Of Caution",
  "Rejecting A Proposal For Misalignment", "Whistleblower Bounty") just filed
  under A.1 (Governance) instead of A.0 (Scope-general) today. **Not
  promoted**: combining title-hit with a weak-but-nonzero content score in the
  same MIP is a materially different signal than the "title-hit alone" Gate 4
  measured and explicitly rejected (one wrong-MIP case in that calibration) —
  changing the auto-lock policy on an uncalibrated combined signal needs its
  own evidence pass, not a judgment call made in passing.

### Gate 5 — title-hit + content combined signal: CALIBRATED AND SHIPPED (2026-07-07)

The evidence pass the note above asked for. **Full population, not a sample**:
exactly 8 genesis-bridged docs in the whole corpus have both title-hit=true
and 0 < mipScore < 0.05 in the same MIP — every one of them reviewed with real
side-by-side genesis-vs-MIP-section text (`gate5-titlehit-combined-
calibration.json`), same TRUE/PARTIAL/FALSE definitions as Gate 4:

| Doc | MIP§ | Score | Label |
|---|---|---|---|
| Launch Project | 108§9 | 0.036 | TRUE |
| Incentive Slack | 101 | 0.010 | TRUE |
| Whistleblower Bounty | 101§2.6.6 | 0.015 | PARTIAL (same mechanism, scope broadened) |
| Interim Facilitators | 113§7.1.3 | 0.029 | TRUE |
| Policyholder Management | 106§10.2.1.2 | 0.042 | TRUE |
| Review Process | 106§11.5 | 0.032 | TRUE |
| Core Facilitators | 101§2.7.2.3 | 0.032 | TRUE |
| Parameter Reconfiguration Methodology & Frequency | 104§9.1.3.6 | 0.022 | TRUE (identical section title) |

**7/8 strict TRUE, 1 PARTIAL, 0 FALSE, 0 wrong-MIP** (Wilson 95% LB 52.9%
strict / 67.6% lenient — wide because n=8, but n=8 is not a sample of a larger
unreviewed population here, it's every case this rule will ever touch). The
key finding versus Gate 4's rejected "title-hit alone": requiring the title-hit
and the content score to agree on the **same** MIP filters out exactly the
wrong-MIP failure mode Gate 4 measured — zero wrong-MIP cases here.

**Shipped**: `build-mip.mjs` now locks when title-hit AND `mipScore > 0` agree
on the same MIP (title-hit pointing at a *different* MIP than the best content
score still never locks — outside this calibration). 8 additional MIP-traceable
docs; `method: 'ai'` on these events (reviewed individually, not purely
threshold-crossed) reuses the existing method badge — no new UI plumbing. 16 of
the 24 sub-threshold hints remain unpromoted (no title-hit, or a disagreeing
one).

### Ordering / storage

- `atlas_history.commit_seq` for pre-git events: a reserved negative block —
  `era='mip'` → -30000 + rank(date), `era='genesis'` → -20000,
  `era='severed'` → -10000 + rank(date; curated dated births rank by their poll
  date). Git-era rows keep their existing positive seqs; the read query already
  orders by `commit_seq`.
- `commit_sha` for pre-git rows: a stable synthetic tag (`mip:<n>:<sec>`,
  `genesis:bafkreih7…`, `severed:<window|topicId>`) — the upsert conflict key
  `(doc_id, commit_sha, change_type)` keeps working unchanged.
- New `era` values (`'mip'`, `'genesis'`, `'severed'`) flow through the existing
  columns (migration 009 added `era`; the server SELECT already returns it).
  **`atlas_history` gets no new columns** — snippets/sources don't belong there.
- `committed_at` per era (pinned): `era='mip'` → the §'s first-appearance date
  (fallback: ratification 2023-03-27); `era='genesis'` → `2024-09-02`;
  `era='severed'` interval births → **NULL** (no known date is the honest
  value; `eventToRow` already emits `e.date ?? null`, and ordering rides on the
  baked negative `commit_seq`, never on the date). The FE renders the constant
  window ("between 2024-09-02 and 2025-05-28") from the era label, not from a
  stored date. A curated birth-date upgrade (stage 3) *sets* `committed_at` to
  the poll date and re-ranks the seq.
- The artifact `public/history-pre-era.json` is **committed to git**, exactly
  like `history-html-era.json` (verified: `.gitignore` only ignores the
  `public/history/` directory, which doesn't match; extend the gitignore's
  committed-artifacts comment block, lines ~30–32, when the artifact lands).
- **Forum context gets its own table** (own migration, mirroring the
  artifact-row shape above):

  ```sql
  CREATE TABLE forum_doc_context (
    doc_id       text NOT NULL,      -- bridged atlas uuid (real or synthetic)
    topic_id     int  NOT NULL,      -- forum topic
    post_no      int  NOT NULL DEFAULT 1,
    edit_set     text NOT NULL DEFAULT '',
    match_tier   text NOT NULL,      -- unique-bullet | decollided-bullet | prose-era
    match_basis  text NOT NULL,      -- title-exact | docno+title | phuuid | mention
    containment  real,               -- 8-word body-shingle score = the trust signal
    verb         text,               -- Add/Replace/… when parsed
    ratified     boolean,            -- from the on-chain vote tally (NULL = unknown)
    ratified_date date,              -- on-chain poll close date (NULL if no poll matched)
    posted_date  date,               -- forum post date (always known)
    snippet      text,
    forum_url    text NOT NULL,
    poll_tx      text,               -- on-chain ratification tx when matched
    poll_cid     text,               -- content-addressed ratified poll doc (the immutable spine)
    post_version int,                -- Discourse post version at fetch (post is mutable)
    PRIMARY KEY (doc_id, topic_id, edit_set)
  );
  ```

  Deltas from the original shape, all forced by the measured findings:
  `match_tier` (only `unique-bullet`/`decollided-bullet` rows get a per-doc link
  in the UI; `prose-era` is era-level, never a per-doc claim); `containment`
  replaces a vibes `confidence` — it *is* the body-shingle score the gate ran on;
  `ratified`/`ratified_date` split out from the old conflated `cycle_date`
  (**`poll_tx` presence ≠ ratified** — read the tally), with `posted_date` kept
  separately so a curated birth upgrade never dates off a mere draft-post date;
  `poll_cid` records the immutable ratified source; `post_version` flags that the
  captured Discourse text may post-date the cycle. Synced by the same worker path
  as other artifacts (own `sync:*` step, per the separate-sync-scripts
  convention). Served by a small endpoint (`/api/forum-context/:docId`, plus an
  unfiltered listing for the index page).

## UI treatment

**IMPLEMENTED (2026-07-07), superseding this section's original design in a few
places — corrections found during actual browser verification, not just spec:**

- `NodeHistory` hides reconstructed entries (every era in `RECONSTRUCTED_ERAS`:
  html/mip/genesis/severed — not just html) behind one **"View Reconstructed
  History"** toggle (generalized from "View HTML Era Edits"), each block
  preceded by its own disclaimer (`HistoryDisclaimers.tsx`). Sort key is
  `commitSeq` (not date-string — a severed interval birth has no date at all,
  and an empty string sorts as "smallest," which is chronologically backwards).
  - `era='mip'` / `era='genesis'` / a curated `severed` upgrade: the redundant
    "added" chip is **suppressed** (`EntryRow`'s `hideChangeLabel`) — the
    summary text alone ("Proposed in MIP104 §14.3", "Present at Atlas v2
    genesis", "Present in Atlas Edit Proposal 1") already says what happened;
    showing "added" next to it was noise a real browser check caught. Method
    badge (ai/human) shows for any `RECONSTRUCTED_ERAS` member, not just html.
  - `era='severed'` interval births: plain text, no false precision — *unless*
    a **curated AEP upgrade** (stage 1c) applies, in which case the generic
    placeholder is fully replaced by the dated, sourced, `method='human'`-
    badged fact. The context-table/forum-era-page design below (Phase B) is
    the *other*, broader path to a similar upgrade — not yet built.
  - The link at the row's end is gated on `isGitSha` (a real 7–40-hex commit
    sha) — a synthetic tag (`mip:104:14.3`, `genesis:bafkreih7…`) links
    `sourceUrl` instead ("source →"), never a dead
    `github.com/.../commit/<synthetic-tag>` URL.
- **Phase B, not required for Phase A go-live: new page `/forum-era/:id`**
  (route name TBD) — the per-doc forum-era view.
  Lists every matched proposal for that doc, newest-last: cycle date + title,
  edit-set name, verb + a **`match_tier` badge** (`unique-bullet` /
  `decollided-bullet` / `prose-era` — the reader can judge match strength at a
  glance), the body-**containment** score, the snippet excerpt, a link to the
  original forum post, and the on-chain ratification poll (tx + IPFS doc, +
  ratified/not from the tally) when matched. Header carries the standing
  disclaimer: proposals are pre-ratification text from a window with no surviving
  git history. A bare `/forum-era` index listing the 29 cycles themselves (date,
  title, size, edit-set count, link) is a cheap nice-to-have and doubles as the
  calibration browse view.
  - **The history-panel pointer line is gated to the trustworthy tiers.** Only a
    doc with a `unique-bullet` / `decollided-bullet` row gets the "N governance
    proposals reference this doc → forum-era page" line on its severed-birth
    entry. A doc whose *only* forum context is `prose-era` gets **no** per-doc
    pointer — its context, if surfaced at all, is the era-level cluster link, not
    a claim about that specific doc. This is the UI consequence of the measured
    75% FP rate on the collision/prose tiers: the pointer is a promise the doc
    *was* in that cycle, and we only make it where the body corroborated it.
- The existing first "Added" row at `4e931dfd` stays (it *is* the first git
  observation) but when older origin events exist below it, render its label as
  **"committed"** instead of "Added" (changed from the original "First git
  snapshot" wording per direct feedback — shorter, matches the lowercase
  added/edited/removed/moved convention). One real bug found and fixed here:
  the root-sha match constant was 8 characters (`"4e931dfd"`) but every commit
  hash in this pipeline is truncated to 7 (`gitCommitSeq`, `buildEvents`, …) —
  an 8-char `startsWith` check against a 7-char hash can never match, so the
  relabel silently never fired until the length was corrected.
- The reader keeps the current default collapsed state; pre-git material is
  opt-in disclosure, same philosophy as the HTML-era toggle.

## Curation / verification

- Reuse the htmlhist curation loop shape only where signal quality demands it:
  the 16 ambiguous + 28 containment genesis→root cases, and the 79 title-only
  MIP hints (a human either promotes them to `era='mip'` or drops them). This is
  a **couple hundred decisions total**, not another 10k-row campaign.
- **Gate 5 — forum matcher calibration (blocks Phase B ship; the forum analogue
  of Gate 4).** The severed-only output must not ship until the body-containment
  gate has a *measured* precision, exactly as MIP did. Harness: the **55
  overlap-window proposals (2025-05-28 → present) have both forum prose AND real
  git diffs** — run the full parser + de-collision against them and score each
  emitted per-doc link as correct/incorrect vs the git-diff ground truth. Deliver
  a `gate5-forum-calibration.json` with per-tier precision (`unique-bullet`,
  `decollided-bullet`, and the rejected `prose`/collision tiers as negative
  controls) and lock the `MIN_ABS`/`MARGIN` thresholds to whatever holds ≥ ~95%
  strict precision on the trustworthy tiers. Until that number exists, the
  measured 75% FP on the collision tier stands as the reason *not* to ship any
  title-only link.
- **De-collision is a required FP filter, not just a rescue** (measured: it
  rejected 69/92 colliding bulleted docs as sibling-better). Every colliding
  candidate runs through it and is dropped unless this doc is the clear
  body-winner; the reject list is retained in the measurement JSON as auditable
  evidence that the drop was correct.
- The 0.05–0.25 containment band (79 weak matches) stays unshipped until a
  human or model pass reviews it; thresholds are cheap to revisit because the
  lineage JSON records raw scores.

## Phase A pre-flight gates — ALL PASSED (2026-07-06)

Four items gated shipping, ranked by "if skipped, we ship lies". All four are
now closed with checked-in evidence (`scripts/aux/atlas-history/recovered/
gate*-*.json`); the build can start with no open questions.

1. **Genesis row delta — PASSED, no parser change needed**
   (`gate1-genesis-parse-audit.json`, script `prototypes/audit-genesis-parse.mjs`).
   The "≈1,068" was a `<dfn>`-occurrence overcount: genesis has **1,070 `<dfn>`
   occurrences but exactly 890 doc rows**, and the parser captures all 890. The
   180 non-node dfns are cross-reference citations inside row cells ("See A.1.2
   - … - Conflict Resolution") + every section's single header row (`tr =
   nodes+1` in all 10 sections, verified header text "Doc No / Name / Type /
   Content"). Root commit likewise: 4,785 dfn occurrences, 4,019 doc rows.
   Nothing is dropped; no doc is misclassified severed-born by parsing.
2. **Bridge corroboration — PASSED** (`gate2-bridge-corroboration.json`, script
   `prototypes/corroborate-bridge.mjs`). Every one of the 115 non-tier-1 pairs
   now has a second independent signal: tier-2/2.5 (structural) pairs
   corroborated by `sameDocScore ≥ 0.6` content containment (84), fuzzy tiers
   corroborated by exact-title (14) or containment (15); the 2 remaining pairs
   were individually adjudicated with recorded rationale (both real: a light
   rewrite + a same-slot content replacement), flagged `model-adjudicated,
   human-reviewable`. The 16 ambiguous + 28 contained stay in curation queues
   as designed. No genesis event ships from a single fuzzy signal.
3. **Presentation traps — VERIFIED and specced** (see the appendix "Gate 3:
   verified fix list" below — exact file:line for every trap, confirmed against
   the code, including one new load-bearing find: `history-db.ts:112` **nulls
   any non-git `commit_seq`**, which would silently discard the negative-seq
   design at ingestion). DB schema needs **zero migrations** for the new eras
   (no CHECKs; `commit_sha` is unbounded TEXT; `commit_seq` is signed INT).
4. **MIP threshold calibration — PASSED; auto-lock line moves 0.25 → 0.05**
   (`gate4-mip-calibration.json` — 74 labeled docs across six score bands with
   per-item labels + rationale, review sheets `calibration-sample.md` /
   `calibration-extra.md`). Measured precision: **25/25 at ≥0.25; 35/36 strict
   (97.2%) at 0.05–0.25; 60/61 (98.4%) combined ≥0.05**. Low containment means
   heavy rewriting, not wrong attribution — the 8-word shingle is high-precision
   even at score 0.05 (e.g. "Incentive Slack" is true lineage at 0.01). The one
   partial is a template-boilerplate shape (AEP parameters patterned on
   MIP102c2). Title-hits are confirmed unsafe to lock: one sampled title-hit
   attributed the WRONG MIP while content attribution was right. **Decision:
   auto-lock ≥ 0.05 with §-citation + score + method on every event; <0.05
   title-hits remain curation hints. Effect: 179 → 231 MIP-traceable docs**
   (corrected 2026-07-07 during Phase A implementation: the prior write-up said
   258, which didn't match `mip-genesis-lineage.json`'s own data — 231 is the
   real number, independently reproduced twice: once by re-deriving it from the
   committed measurement JSON, once by the production `scripts/prehist/
   genesis-bridge.mjs` + `build-mip.mjs` pipeline, both in agreement).
   Labels were produced by model judgment with per-item rationale recorded —
   spot-checkable from the review sheets; the known failure shapes
   (template-boilerplate, overly-narrow/coarse §-cites) are documented in the
   artifact.

Ride-along decisions (made 2026-07-06, apply during implementation): date
label reads "first appears in the MIP text under this name" (the `-S` dating
is blind to pre-rename life and same-string prose); forum `mention`-tier rows
hidden by default on the forum-era page; birth-date upgrades require an exact
Add-Document title match with no competing cycle and keep approximate framing;
resolve root-row→uuid by re-running seed threading instead of the
`(docNo|title)` order heuristic (silent sibling swaps); `committed_at` per era
pinned in "Ordering / storage" (severed intervals = NULL, window rendered from
the era constant); genesis events link the **ipfs.io gateway URL carrying the
CID** (self-verifying reference; the committed
`recovered/genesis-2024-09-02.html` is our own byte-verified fallback if the
gateway ever dies — don't build a serving route for it in Phase A); the
NodeHistory toggle label generalizes from "View HTML Era Edits" to cover all
reconstructed eras (tests assert it by name — see appendix).

## Phasing & effort

1. **Phase A — genesis + MIP origins (stages 1+2): DONE (2026-07-07).**
   `scripts/prehist/{genesis-bridge,build-genesis,build-mip}.mjs` +
   `prehist:genesis`/`prehist:mip`. Root-uuid resolution runs the REAL html-era
   thread (extracted into `scripts/htmlhist/run-thread.mjs`, verified
   byte-identical to the shipped `history-html-era.json`) rather than the
   `(docNo|title)` heuristic the ride-along decision flagged — reproduced Gate
   1/2's exact numbers (756 pairs/641 tier-1/118 tombstones/16 ambiguous/28
   contained, all 115 non-tier-1 pairs corroborated). All Gate-3 ingestion/read/
   FE/chat-tool fixes landed (`history-db.ts` seq fix + `source_url` column,
   `NodeHistory`/`EntryRow`/`ActorHistory` era-aware, `tools-history.ts`
   era/method/source_url). Current `public/history-pre-era.json`: **4,383 total
   events** = 876 genesis + 3,183 severed + 324 mip events over 876 bridged docs,
   with 3 AEP supersedes (not just the 613-alive-only
   subset counted in the landscape table — dead-later-in-git-era docs get
   origins too, same zero-cost argument as MIP-on-tombstones). Caught and fixed
   one real bug in the process: `eventToRow` computed `source_url` in its type
   but never mapped it — a unit test (`history-db.test.ts`) forced it out
   before it shipped. Also corrected a **write-up error** found during
   verification: Gate 4's "258 MIP-traceable docs" never matched
   `mip-genesis-lineage.json`'s own data — the real number is **231**,
   independently reproduced by both a direct re-derivation and the production
   pipeline; fixed everywhere it was quoted (this file, the gate JSON, memory).
   Ship checklist done: NodeHistory tests cover pre-git eras, `prehist:*`
   documented (`scripts/prehist/HISTORY.md` + CLAUDE.md), gitignore extended.
   `patch-notes.md` bullet deferred to the merge-to-main PR (this work is still
   on `ancient-history`, not yet public).

   **Real-browser verification round (same day) found and fixed 4 more bugs**
   no unit test could catch: (1) the html-era thread's known duplicate-uuid
   property (39% of rows are content-duplicates) meant `build-genesis.mjs`
   emitted the same `(doc_id, commit_sha, change_type)` twice — Postgres
   rejected it on upsert; fixed by deduping to `Map<docId, event>` before
   emitting (874→871 bridge rows, 3263→3070 severed-born). (2) The `ROOT_SHA`
   8-vs-7-char bug above. (3) `MIPS_REPO` was hardcoded to the `main` branch;
   the mips repo's default branch is `master` — every mip `sourceUrl` was a
   dead link until corrected. (4) `build-mip.mjs` appended mip events onto the
   existing artifact rather than replacing them, contradicting its own
   runbook's "idempotent" claim — fixed to drop prior mip events before
   appending fresh ones. Also added **stage 1c** (curated AEP upgrades, see
   above) the same day, ahead of Phase B.
2. **Phase B — forum context** (stage 3): parser v2 across the three format
   generations + multi-post fetch + the **body-shingle de-collision gate** +
   the **poll-IPFS content corroboration** + **Gate-5 overlap calibration** +
   the `forum_doc_context` table/endpoint + the `/forum-era/:id` page + the
   tier-gated pointer on severed birth entries. ~3–4 days.
   **Scope corrected 2026-07-07 by measurement** (`recovered/forum-provenance-
   measure.json`): ships **~76 trustworthy per-doc links** (unique-title bullets
   + de-collided bullets; est. ~80–90 once `#26262` post 2 is fetched), **not the
   ~300–500 the original write-up implied** — that figure silently counted the
   prose-mention + collision tiers, which are ~75% false-positive and stay
   era-level only. Everything else keeps the stage-1 honest interval. The 21
   on-chain poll IPFS docs are the only lever into the early severed window
   (Sep 2024–Feb 2025), which forum *text* cannot reach at per-doc granularity.
3. **Phase C (optional, later)** — MIP-era *change* history: the mips repo has
   626 commits across the six artifacts (MIP113 alone: 313) — per-section
   MIP-era edit events are reconstructable with the same shingle machinery if
   we ever want depth before 2024. Not needed for the origin feature.

## Open questions

1. **Where does the MIP origin event live for docs born *during* the severed
   era whose text still traces to a MIP?** (Content can flow MIP → cycle-added
   doc without a genesis ancestor.) Current answer: out of scope for Phase A
   (only genesis-bridged docs get MIP origins); a Phase B+ shingle pass over
   severed-born docs against the MIP corpus could add them.
2. ~~**`change_type` vocabulary**~~ — **resolved (2026-07-06): keep `added` +
   era-based rendering.** Zero migration, and the Gate-3 audit confirmed
   `toEntry` passes change_types through verbatim so a new type would need FE
   plumbing for no rendering benefit — the era already carries the semantics.
   (The Gate-3 appendix assumed this; recorded here so it's one decision, not
   two.)
3. ~~**Snippet storage**~~ — **resolved (2026-07-06): forum material stays out
   of `atlas_history` entirely.** Own `forum_doc_context` table + `/forum-era/:id`
   page; the history panel only carries a suspicion-tier pointer line. The sole
   forum→history path is the curated birth-date upgrade (stage 3).
4. ~~**Do we commit the severed-proposals corpus?**~~ — **resolved: already
   committed** (2026-07-06, `scripts/aux/atlas-history/severed-proposals/`;
   same reproducibility argument as the genesis snapshot).

Remaining genuinely open: **only #1** (MIP origins for severed-born docs), and
it is explicitly Phase B+ scope — nothing blocks Phase A.

## Appendix — Gate 3: verified presentation-trap fix list (2026-07-06)

Every claim below was verified against the code at the cited line. Scope of the
change being guarded: rows with `era ∈ {'mip','genesis','severed'}`, synthetic
`commit_sha` (`mip:101:2.14.3`, `genesis:bafkreih7…`, `severed:…`), negative
`commit_seq`. Define one shared concept: `RECONSTRUCTED_ERAS = {'html','mip',
'genesis','severed'}` and an `isGitSha(s)` = 7–40 lowercase hex check — most
fixes are applications of those two.

### Ingestion (fix FIRST — everything downstream depends on it)

- **`src/server/history-db.ts:112`** — `commit_seq: seqByCommit.get(e.commitHash)
  ?? null`. A synthetic sha isn't in the git-log map → **the baked negative seq
  is silently replaced with NULL** (no throw, no skip). Fix:
  `seqByCommit.get(e.commitHash) ?? e.commitSeq ?? null` (the pre-era artifact
  bakes its negative seqs; git-era rows keep sha-derived seqs). Note the
  markdown path's fallback `commitSeq: 1000 + startIndex + i`
  (`build-history.mjs:532`) is *also* currently ignored by this line — decide
  deliberately: keep ignoring it (git-derived seq is correct for md rows), only
  honor baked seqs for non-git shas.
- **`scripts/required/build-history.mjs:619–626`** — the html-era artifact merge
  block. The pre-era merge slots directly after it (before `sql.end()` at :628):
  read `public/history-pre-era.json`, map via a `preEraRows()` sibling of
  `htmlEraRows()` (`history-db.ts:141`), `upsertHistory`. `HISTORY_COLS`
  (`history-db.ts:15–23`) already carries era/seam/method — no column work.
  Two verified details: the merge block lives inside `if (!OUT_JSON)`
  (`:597`) — putting the pre-era merge in the same slot leaves the
  `--out-json` canary path untouched by construction. And the block comment at
  `:617` states commit_seq is "never trusted from the baked artifact" — that
  policy statement must be **rewritten**, not just bypassed: the new rule is
  *git shas → seq reconciled via `seqByCommit`; synthetic (non-git) shas → the
  baked seq is authoritative* (matching the `history-db.ts:112` fix above).
- **`src/server/history-db.ts:184–195` `readHistoryCursor`** — `MAX(commit_seq)`
  ignores NULL/negative rows: incremental cursor stays anchored on git. Safe
  as-is, no change.

### DB — zero migrations required (verified)

- `atlas_history` (`001_init_atlas.sql:63–83`): `commit_sha TEXT NOT NULL`
  unbounded, **no CHECK anywhere** on change_type/era, `committed_at` nullable,
  `commit_seq INT` signed nullable, PK `(doc_id, commit_sha, change_type)` —
  synthetic shas + negative seqs insert as-is.
- ~~Housekeeping only: the era-enum comment in `009_html_era.sql:1–6` is stale~~ —
  **done** (2026-07-07): extended to list mip/genesis/severed alongside html.

### Read API

- **`src/server/history.ts:92–99` and `:132–139`** — SELECTs return `era`,
  `method` but **not `commit_seq`** (nor seam/lineage fields). Add `commit_seq`
  to both SELECTs and to `toEntry` (`:62–85`) so the FE can order pre-git rows;
  seam/extracted_from/merged_into only if the UI decides to render them (out of
  Phase A scope).
- ORDER BY (`:98`/`:138`) `commit_seq DESC NULLS LAST, committed_at DESC NULLS
  LAST` — negatives sort below positives, above NULLs: already correct.
- `toEntry:66` passes unknown change_types through verbatim — keep emitting
  `added` for pre-git events (decided) and this never fires.

### Frontend

- **`src/components/history/NodeHistory.tsx`** — the central trap. `:101` sorts
  by date string only; `:102` `hasHtmlEra = some(era === "html")`; `:107` hides
  only `era === "html"` behind the toggle; `:108` disclaimer anchored on
  `era === "html"`; `:131` `PreMdFooter` fires on `!hasHtmlEra && pr === 117`.
  **An era='mip' row today renders as normal exact markdown history: always
  visible, no toggle, no disclaimer.** Fix: bucket on `RECONSTRUCTED_ERAS`
  membership; hide all reconstructed eras behind the existing toggle; per-era
  disclaimer blocks (the current `HtmlEraDisclaimer` at `:21–48` hard-codes
  #117/HTML language — wrong for mip/genesis/severed); sort key falls back to
  `commitSeq` when dates tie or are empty; `PreMdFooter` condition must treat
  "has any reconstructed era" as covered. Tests currently only exercise
  `era: "html"` (`NodeHistory.test.tsx:74–99`) — add pre-git-era cases.
  Also `:124`: the toggle label is the hard-coded string "View HTML Era
  Edits" — false advertising once mip/genesis/severed rows nest under it.
  Generalize (e.g. "View reconstructed history") and note the tests assert
  the button **by accessible name** (`NodeHistory.test.tsx:88`, `:102`) — they
  break on rename; update them in the same commit.
- **`src/components/history/EntryRow.tsx:66–74`** — commit link is
  `github.com/sky-ecosystem/next-gen-atlas/commit/${commitHash}` unconditionally
  → dead link + raw synthetic tag as label. Gate on `isGitSha`; render synthetic
  tags as plain text (mip events instead link to the MIP section on GitHub via
  their own source URL). `:23–34` — method badge requires `era === "html"`;
  broaden to `RECONSTRUCTED_ERAS` so mip/genesis provenance badges show.
- **`src/lib/history.ts:40`** — `era?: string` (open string): pre-git values are
  type-valid silently. Either narrow to a union (compiler surfaces every
  consumer) or leave open deliberately; add `commitSeq?: number`.
- **`src/components/radar/ActorHistory.tsx`** — no era filtering at all; commit
  link + `commitHash.slice(0,7)` at `:230–234` (synthetic tag renders as
  "mip:101"); merges by commitHash `:117–121` (same synthetic sha across docs
  collapses — acceptable), date-sorts `:133`. Minimum fix: `isGitSha` gate on
  the link + an era chip; or filter reconstructed eras out of the radar
  timeline entirely (product call).
- **`PreviewHistory.tsx:86`** renders `<NodeHistory/>` — inherits the
  NodeHistory fix, nothing separate.
- Curation reports (`CurationCommitStrip.tsx:8`, `CurationTimeline.tsx:52/61/68`)
  read offline curation artifacts, not `atlas_history` — untouched unless the
  authoring queue later adopts synthetic shas.

### Chat / MCP tools (same registry serves both — `tool-registry.ts:21`, `mcp.ts:31`)

- **`src/server/tools-history.ts:44–50`** (`atlas_history`) — SELECT lacks
  `era`/`method`: **the LLM cannot distinguish reconstructed rows from git
  commits**, and synthetic shas leak verbatim as `commit_sha`. Add era+method to
  the SELECT and the returned events; same for `atlas_recent_changes`
  (`:61–120`) and `atlas_pr` (`:123–138`).
- **`tool-registry.ts:122–133`** — `atlas_history` description says "Returns the
  git-log of changes" — becomes false once pre-git rows exist. Update the
  description to name the reconstructed eras and their meaning (the model
  hedges only if it's told).
- **`atlas_changed_between` (`tools-history.ts:141–219`)** — `slice(0,7)`
  sha-prefix lookups (`:145–157`) never match synthetic tags (fine — reject
  early with a clear error), but the `MIN/MAX(commit_seq)` window arithmetic
  breaks on NULL-seq boundary rows — guard.
- **`src/server/query.ts:47`** — `recent_commits` window `MAX(commit_seq) - N`
  can never reach negative-seq rows: acceptable (pre-git isn't "recent"), note
  in the tool description.

### Suggested implementation order

history-db seq fix → server SELECT + type → NodeHistory bucketing + EntryRow
link/badge → chat tool SELECT + descriptions → ActorHistory gate →
`atlas_changed_between` guards. Each step is independently shippable, **but
the artifact is the trigger**: `build:history` upserts every committed
artifact on each worker cycle, so the moment `history-pre-era.json` reaches a
deployed branch, pre-git rows enter that environment's DB. Therefore the
artifact must never merge *ahead of* the ingestion + server + FE fixes.
Same-PR is fine (one image ships worker + FE together); artifact-first is
not. Corollary: a rollback to a pre-fix image against a DB that already has
pre-git rows re-exposes the traps — if a rollback window matters, land the
fixes one deploy before the artifact.
