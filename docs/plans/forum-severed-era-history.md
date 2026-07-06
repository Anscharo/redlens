# Reconstructing the severed-era Atlas history from forum proposals (Option 1)

Status: PLANNED (2026-06-24); **enumeration step BUILT 2026-06-25** (§1 — script
+ checked-in manifest); facilitator context folded in 2026-07-01 (see
`atlas-prehistory-mips.md`, "Facilitator accounts"); **corpus fetched + parser
feasibility measured 2026-07-06 (§1.5 below) — implementation now specced as
stage 3 of `pre-git-history.md`**. Depends on findings in
`atlas-prehistory-mips.md`. Sibling to `html-era-history.md` (the git-based
HTML-era pipeline).

**Goal.** Recover per-document change history for the **severed HTML era**
(≈2024-09 → 2025-05-28 — the pre-truncation `next-gen-atlas` window that is
garbage-collected from GitHub) from the **public forum Atlas Edit proposals**,
and splice it onto the earliest recoverable HTML commit so it joins the existing
timeline.

**Scope / non-goals.** This produces **human-language change history** (ideal for
the reader history panel and the chat/timescale consumer), **not** byte-exact
source reconstruction. The proposals are *proposed* (≈ratified) edits, not
commit-exact diffs. We label everything `provenance='forum'` and surface it as
explicitly approximate.

## 0. Why this works

The forum has a **continuous weekly series** of Atlas Edit Cycle proposals
running back to **2024-09-13** (`#25083`) — blanketing the entire severed era and
continuing through today. Each proposal post contains, per cycle:
- the **edits in human language** — a summary list + detailed before/after
  content per change (e.g. `#25590`, 2024-11-25, ~73 KB, eleven edit sets);
- **Powerhouse doc UUIDs** in the links (the early-Powerhouse namespace —
  verified separate from #117, but stable *within* the severed era), which give
  a ready-made per-doc identity key;
- occasional **Notion** page IDs (drafting source).

So the severed era's change history is publicly reconstructable even though its
git objects are gone — and it is now **bracketed by two exact HTML snapshots**: the
**2024-09-02 genesis** (≈1,068 docs, recovered from the IPFS CID in poll #25010 —
see `atlas-prehistory-mips.md`) at the start, and the first git commit `4e931dfd`
(2025-05-28, ≈4,676 docs) at the end. The forum cycles narrate the ≈4.4× growth
between them.

## 1. Source — Discourse tag feed (enumeration BUILT)

The enumeration is implemented and the work-list is checked in:
- **Script:** `scripts/aux/atlas-history/enumerate-atlas-proposals.mjs` (offline; not in
  `pnpm build`). Run: `node scripts/aux/atlas-history/enumerate-atlas-proposals.mjs`.
- **Manifest:** `scripts/aux/atlas-history/atlas-edit-proposals.json` — one entry per proposal
  with `{id, date, title, kind, is_cycle_proposal, window, posts_count, tags,
  url, raw_url, repo_file?, ratified?}`, plus a `repo_aep_files[]` block.

How it enumerates (union, deduped by topic id):
- Tags **`atlas-edit-weekly-proposal`** (id 1469) + **`atlas-edit`** (1465),
  paginated (`/tag/<tag>.json?page=N`). Captures the weekly series.
- Search safety-net (`/search.json?q=…`) for `Atlas Edit Cycle/Weekly/Monthly`
  **and `AEP`**, filtered to `/atlas edit|^aep[\s-]?\d/i`. This catches the
  early-2025 **monthly AEP experiment** (`AEP-1…AEP-11`), whose titles don't
  contain "Atlas Edit" and so are missed by the tags alone.
- Cross-links each **committed** AEP file
  (`vendor/next-gen-atlas/Atlas Edit Proposals/AEP-*.md`) to its forum topic,
  attaching `repo_file` + `ratified` (the AEP preambles carry ratification
  status the forum topics lack — a bonus authoritative source for the monthly
  series).

Current capture (2026-06-25): **85 topics, 84 cycle proposals — 29 in the
severed window (2024-09-13 → 2025-05-24), 55 in overlap; 11 AEP files resolved.**
The 29 severed cycles are the concrete reconstruction work-list.

- **Window of interest: 2024-09-13 → 2025-05-28** (the 29 severed cycles). After
  2025-05-28, git is authoritative (§5 overlap rule); the 55 overlap proposals
  are kept for calibration (§6) and optional prose summaries.
- Per topic, the reconstruction then fetches `GET /raw/<id>/1` (the proposal
  markdown — `raw_url` in the manifest) to parse. Ratification is via on-chain
  polls, not in-thread (no Discourse polls on these topics); amendments/
  withdrawals show up as replies (`posts_count` > 2 flags discussion to check).
- **Cadence note:** the severed series has genuine gaps (the `atlas-edit-weekly-
  proposal` tag is exhaustively captured, so a missing week = no proposal that
  week, not missed data): late-Dec 2024 (year-end) and the weekly↔monthly
  transition. The monthly AEPs fill early-2025; the Dec-2024 and 2024-09-30/10-07
  gaps are worth a manual spot-check during reconstruction.

## 1.5 Measured reality check (2026-07-06) — corpus in hand, model revised

All 29 severed-window proposals were fetched (392 KB total, sizes 1.2–90 KB;
raws checked into `scripts/aux/atlas-history/severed-proposals/`) and run
through a first-pass parser (`scripts/aux/atlas-history/prototypes/
parse-forum-coverage.mjs`, stats in `recovered/forum-coverage.json`). Findings
that change this plan:

- **Three format generations, not one.** (1) *Sep–Nov 2024*: `**Add Document:
  A.x - Title**` headers with `%%…%%` fenced content, no edit-set `###`
  sections; (2) *Nov 2024–Feb 2025*: the `###` edit-set + `**Verb**` + prose
  shape §2 modeled; (3) *Mar–May 2025*: edit sets whose bodies are **full
  nested document trees** (`- **Title** *(Type)* - content`, with `*(Core)*` /
  `(*Core*)` marker variants) — near-complete per-doc content inline; the
  first-pass regex already extracts **453 doc bullets**. The parser needs all
  three; generation 3 is *richer* than "human-language diffs" — it's the
  documents themselves.
- **Multi-post continuations exist.** `#26262` (90 KB) says "split into two
  posts" — the manifest's `raw_url` (`/raw/<id>/1`) misses the tail; fetch
  `/raw/<id>/2..n` when post 1 signals continuation.
- **Powerhouse UUIDs are too sparse to be the identity key.** Only **32**
  distinct phUuids across all 29 proposals, vs 189 distinct doc_nos and 418
  bullet titles. §4's "key by phUuid when present" stays true but is the
  exception; `(docNo-prefix, normalized title)` is the spine.
- **The weekly cycles are NOT the whole severed-era story.** Of the 2,530
  severed-born docs alive today, **1,649 (65%) are Agent Scope Database rows** —
  operational data added by Agent launches (the 11th `<h1>` section, absent
  from genesis), never proposed through edit cycles. Of the remaining **881
  core docs**, ~1/3 are covered by the primitive parser (104 bullet-title hits
  + 184 loose mentions); the largest uncovered cluster is the **A.2
  Primitives/Agent-framework buildout** (~419 docs), narrated in design posts
  (`#26047` "Sky Primitives: The building blocks of the Sky Agent Framework",
  2025-02-25; `#25031` Launch Season, 2024-09-06) and the giant Apr–May 2025
  cycles rather than doc-by-doc. Consequence: **forum snippets are a partial
  overlay** — every severed-born doc gets an honest interval-birth event, and
  snippets attach where coverage exists; Agent Scope DB rows get era-level
  provenance (launch-operations label + design-post links), not per-doc prose.
- **On-chain dating is already solved** — `atlas-onchain-polls.json` (21 polls,
  IPFS CIDs, dates) covers ratification ordering for exactly this window.

## 2. Per-proposal data model

```
cycle      = { topic_id, date, author, url }
editSet    = { name, verb, targets[], beforeRef?, afterContent }
verb       ∈ { Add, Replace, Delete, Move/Renumber, Update }     // bold markers in text
target     = { docNo?, title, phUuid?, phUrl? }                  // from the doc reference + powerhouse link
```

A proposal = an intro **Summary** bullet list naming the edit sets, then one
`###` section per edit set with `**Replace** …` / `**Add** …` markers, doc
references like `A.1.4.9 - Adjudication Process (Core)`, Powerhouse links
carrying `docNo` + `phUuid`, and the new prose body.

## 3. Parsing approach

Two stages, deterministic-first:
1. **Structured extraction** — regex the `**Verb**` markers, `A.\d[\d.]*` doc
   numbers, and `sky-atlas.powerhouse.io/<docNo>_<slug>/<phUuid>` links to pull
   `{verb, docNo, title, phUuid}` per edit set.
2. **Body capture** — the prose under each edit set becomes the change content
   (the human-language diff). Where structure is too author-variable to segment
   cleanly, fall back to storing the whole edit-set prose as a single `modified`
   event against the referenced doc(s).

Accept that this is fuzzier than git diffs; that's the cost of the era being
gone. Tag every emitted event `provenance='forum'`.

## 4. Identity & bridging

- **Within the severed era**, key each edit by its **early-Powerhouse UUID**
  when the link provides one (stable across the era — verified). Else key by
  `(docNo, title-path)`.
- **Bridge to the recoverable timeline** at the *earliest HTML commit we have*,
  **`4e931dfd` (2025-05-28)** — match each still-living severed-era doc to its
  node there by `docNo` + title + content (same matcher as
  `html-era-history.md` §4.2). From `4e931dfd`, the existing HTML-era pipeline
  already carries identity forward to the #117 `uuid4`. **So forum→`4e931dfd` is
  the only new bridge; everything downstream is reused.** (We do *not* bridge
  forum directly to #117.)
- **Second content anchor at the *start*.** The **2024-09-02 genesis HTML** is now
  in hand, so the window has a known doc set at *both* ends. Match forum cycles
  against genesis (start) as well as `4e931dfd` (end): genesis fixes which docs
  predate the severed era vs. are born during it, and gives graveyard docs that
  existed at genesis but died before 2025-05-28 a real content snapshot to hash —
  sharper synthetic UUIDs than prose-only.
- Docs that died before 2025-05-28 → deterministic **synthetic v5 UUID** (same
  scheme as `html-era-history.md` §4.3), tagged graveyard.

## 5. Output & integration

> **Superseded (2026-07-06).** Decision: forum-derived data does **not** merge
> into `atlas_history` / the frozen history artifact at all — proposals are
> pre-ratification text and don't map 1:1 to state changes, so emitting them as
> events would fabricate change types/dates that downstream consumers (chat
> included) would repeat as fact. It lands in its own `forum_doc_context` table,
> surfaced via a per-doc **`/forum-era/:id`** page linked from the history
> panel's severed-era birth entry ("N governance proposals … appear to reference
> this doc"). The only forum→history path is a **curated** birth-date upgrade.
> See `pre-git-history.md` stage 3. The bullets below record the pre-revision
> design for context.

- Emit the **same event shape** as the html-era artifact (per-UUID
  `added`/`modified`/`removed`/`moved`, with date, summary prose, source forum
  URL, and `phUuid`), `era='forum-severed'`, `provenance='forum'`.
- Merge into the **frozen history artifact** (`html-era-history.md` §7.1) keyed
  by the bridged UUID. These events sort **below** `4e931dfd`'s `commit_seq`
  (there are no git commits here — assign a dedicated pre-git ordering by cycle
  date; see Open Questions).
- **Overlap rule (critical):** the proposal series continues past 2025-05-28
  into the git-tracked era. For cycles **on/after 2025-05-28, git is
  authoritative** — generate events *only* from git; optionally attach the
  matching forum prose as a human "summary" on those events, but never emit
  duplicate forum events. **The forum is the sole source only for < 2025-05-28.**

## 6. Fidelity & verification

- **Proposed vs ratified.** Cross-check each proposal's ratification (AEP-style
  preamble "Ratification Poll URL" / on-chain poll, and/or the edit appearing in
  the next era's atlas). Flag unratified / amended / withdrawn cycles (signaled
  by replies in-thread).
- **Calibrate on the overlap window.** For cycles where we have **both** forum
  prose **and** git diffs (2025-05-28 → present), run the parser and compare its
  output against the real git diffs. This is a free accuracy harness — tune the
  parser there before trusting it on the severed-only window.
- **Reconcile counts at both ends.** Doc numbers/titles in the *first* cycles
  (Sept 2024) should reconcile against the **genesis snapshot** (≈1,068 docs); the
  *last* pre-truncation cycles against the `4e931dfd` snapshot (≈4,676 docs).
  Replaying the forum edits from genesis forward should roughly reproduce the
  growth curve between the two.
- **Anchor on-chain.** Severed-era Atlas Edit polls are recorded on-chain via
  `createPoll` (emitter `0xF9be…`; see `atlas-prehistory-mips.md`): 21 in
  2024-09→2025-05, each carrying the poll's **IPFS hash + `makerdao/community` URL**,
  with vote tallies on `0xD3A9FE…`. Use it to (a) get authoritative cycle *dates* +
  ordering (resolves the pre-git `commit_seq` question, §8 Q1), (b) ratify-filter via
  the tally, and (c) pull the poll markdown (IPFS/GitHub), which links to the edited
  atlas docs + the forum thread. Permanent and public; the literal HTML diff still
  comes from the genesis/forum reconstruction.

## 7. Effort / risk

- **Medium.** The parser is the only real risk (author-variable markdown); the
  overlap window de-risks it as a test harness. Roughly a few days including
  calibration.
- **Clearly second-class data.** Label `provenance='forum'` end-to-end and render
  it distinctly in the UI ("reconstructed from governance proposals — approximate").

## 8. Open questions

1. ~~**Pre-git `commit_seq` ordering**~~ — **resolved in `pre-git-history.md`**:
   reserved negative seq blocks per era for the (non-forum) pre-git events;
   forum rows don't enter `atlas_history` at all, so they need no seq.
2. ~~**UI treatment**~~ — **resolved (2026-07-06)**: forum material renders on a
   dedicated `/forum-era/:id` page (snippets + links to originals + match-basis
   badges); the history panel carries only a suspicion-tier pointer line on the
   severed-era birth entry.
3. **Overlap prose** — do we also ingest post-2025-05-28 proposal prose as
   human summaries on git events (nice-to-have), or skip it?
4. **Backfill before the forum floor** — the weekly series starts 2024-09-13, just
   ~11 days after the **2024-09-02 genesis** (now recovered), so the seam at the
   *start* of the HTML era is effectively closed. Earlier strata (the 2023 GAIT
   design era; MIP101 to 2024-08-12) are design/MIP history, not HTML edit cycles —
   out of forum-reconstruction scope (Tier 3). Accept 2024-09-02 as the era floor.

This path is independent of recovering the literal git objects. A facilitator
account (`atlas-prehistory-mips.md`, "Facilitator accounts", 2026-07-01)
suggests the pre-truncation repo itself is now low-value to chase — it was
reportedly made private over a sensitive-info leak, with the replacement
expected to carry everything else — so this reconstruction is likely the
*ceiling* for the severed window, not a placeholder for a fuller recovery. A
Powerhouse op-log export (Tier 2) remains the one source that could still
supersede it, if a contact surfaces one.
