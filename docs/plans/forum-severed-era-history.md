# Reconstructing the severed-era Atlas history from forum proposals (Option 1)

Status: PLANNED (2026-06-24); **enumeration step BUILT 2026-06-25** (§1 — script
+ checked-in manifest). Depends on findings in `atlas-prehistory-mips.md`.
Sibling to `html-era-history.md` (the git-based HTML-era pipeline).

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
git objects are gone.

## 1. Source — Discourse tag feed (enumeration BUILT)

The enumeration is implemented and the work-list is checked in:
- **Script:** `scripts/aux/enumerate-atlas-proposals.mjs` (offline; not in
  `pnpm build`). Run: `node scripts/aux/enumerate-atlas-proposals.mjs`.
- **Manifest:** `docs/plans/atlas-edit-proposals.json` — one entry per proposal
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
- Docs that died before 2025-05-28 → deterministic **synthetic v5 UUID** (same
  scheme as `html-era-history.md` §4.3), tagged graveyard.

## 5. Output & integration

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
- **Reconcile counts.** Doc numbers/titles referenced in the last pre-truncation
  proposals should reconcile against the `4e931dfd` snapshot.

## 7. Effort / risk

- **Medium.** The parser is the only real risk (author-variable markdown); the
  overlap window de-risks it as a test harness. Roughly a few days including
  calibration.
- **Clearly second-class data.** Label `provenance='forum'` end-to-end and render
  it distinctly in the UI ("reconstructed from governance proposals — approximate").

## 8. Open questions

1. **Pre-git `commit_seq` ordering** — how to order forum cycles below the first
   git commit (date-ordered integer block reserved below the minimum git seq?).
2. **UI treatment** — how reader/chat signal "approximate, proposal-derived"
   history vs exact git diffs.
3. **Overlap prose** — do we also ingest post-2025-05-28 proposal prose as
   human summaries on git events (nice-to-have), or skip it?
4. **Backfill before 2024-09-13** — the weekly series starts 2024-09-13; the
   Powerhouse render existed by 2024-08-29 and MIP101 ran to 2024-08-12. A
   ~1-month seam (Aug→Sep 2024) and the MIPs era (Tier 3) remain out of forum
   scope. Likely accept 2024-09-13 as the forum floor.

This path is independent of recovering the literal git objects; if a contact
later supplies the pre-truncation repo or a Powerhouse op-log
(`atlas-prehistory-mips.md` Tiers 1–2 / the data request), that *exact* source
supersedes this reconstruction for the same window.
