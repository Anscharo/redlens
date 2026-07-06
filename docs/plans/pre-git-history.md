# Pre-git history: true origins for every atlas doc

Status: PLANNED (2026-07-06). Data collection + feasibility measurement DONE (all
numbers below are measured, not estimated — see "Collected data"). Successor /
implementation plan for the research in `atlas-prehistory-mips.md` (eras 1–3a)
and `forum-severed-era-history.md` (the severed-window reconstruction). Builds on
the shipped HTML-era pipeline (`html-era-history.md`, `scripts/htmlhist/`).

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
3. **Severed-era births with forum context** — docs born between genesis and the
   first git commit get an honest interval birth ("first appeared between
   2024-09-02 and 2025-05-28"). Where the Atlas Edit cycle proposals cover them,
   we say so — but the forum material itself **never enters the history table**
   (decided 2026-07-06: proposals are pre-ratification text and don't map 1:1 to
   state changes; emitting them as events would fabricate change types and dates
   that downstream consumers, chat included, would repeat as fact). It lives in
   its own context table; the history panel links to a **new per-doc forum-era
   page** that shows the matched posts with snippets and links to the originals.
4. **Git-era docs stay exactly as they are.**

## Measured landscape (2026-07-06)

Today's atlas (10,370 docs) by birth era, measured end-to-end (genesis parse →
`matchNodes` bridge to `4e931dfd` → frozen html-era artifact → `docs.json`):

| Born | Count | First-entry treatment |
|---|---|---|
| At/before genesis (2024-09-02) | **613** | "Present at genesis"; 179 of them also "Proposed in MIP N" (strong content trace ≥0.5/≥0.25 containment); +79 more have a title-level hit only (curation candidates) |
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
  #25010 IPFS CID (693,903 bytes, matches the documented size). **Commit this**:
  it is the single unrecoverable-elsewhere anchor (the ecosystem's IPNS pinning
  already lapsed once).
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
- Resolve root rows → uuids through the frozen html-era artifact's added-events
  at the root commit (same join the measurement used: `(docNo|title)` with
  stable-order disambiguation — 3,823/4,019 resolve; the remainder are
  merged-into rows that have no own uuid).
- Emit per bridged-and-alive uuid: an `added` event, `era='genesis'`,
  date `2024-09-02`, source = the IPFS CID + gateway URL.
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
- Match each genesis doc (shingle containment ≥0.25 = trace; ≥0.5 = strong).
  Record best file + best § + both scores. **Title-hit alone never locks** — it
  produced generic-title false positives ("Cycle Breakdown", "Override
  Mechanism"); title-hits go to a curation hint list only.
- Date each matched § via `git log --reverse -S` in a mips clone (cached
  `.cache/mips/`); fallback ratification date 2023-03-27.
- Emit per traced, alive uuid: an `added`-shaped origin event, `era='mip'`, the
  §-citation, score, date, and a GitHub URL to the section in
  `sky-ecosystem/mips` (line-anchored where derivable).
- Docs whose genesis ancestor died before git: attach the MIP origin to the
  synthetic tombstone uuid (29 docs) — history for the graveyard, zero UI cost.

### Stage 3 — severed-era forum context (approximate; independent cadence)

`prehist:forum`
- Input: the 29 raw proposals (checked in) + `atlas-edit-proposals.json` +
  `atlas-onchain-polls.json` (ratification dates/ordering — already enumerated,
  21 polls with IPFS CIDs).
- **Parser must handle three format generations** (measured):
  1. *Sep–Nov 2024*: `**Add Document: A.x - Title**` headers + `%%…%%` fenced
     content blocks; no nested bullets.
  2. *Nov 2024 – Feb 2025*: `###` edit-set sections, `**Verb**` markers, prose
     bodies (the `#25590` 73 KB shape the old plan §2 modeled).
  3. *Mar–May 2025*: edit-set sections whose bodies are **full nested doc trees**
     (`- **Title** *(Type)* - content`) — effectively complete document content
     inline; a first-pass regex already extracts **453 doc bullets** with titles
     + types + bodies. Tolerate `*(Core)*`/`(*Core*)`/`**(Core)**` variants.
- **Multi-post continuations**: at least `#26262` (90 KB) says "split into two
  posts" — fetch `raw/<id>/2..n` when post 1 signals continuation (the manifest's
  `raw_url` only covers post 1).
- Identity keying, revised: **Powerhouse UUIDs are too sparse to key on** — only
  32 distinct phUuids across all 29 proposals vs 189 docNos and 418 bullet
  titles. Key edits by `(docNo-prefix, normalized title)` against the root/
  genesis node sets; phUuid is a bonus corroborator when present, not the spine.
- **Output is a context artifact, not history events** (`public/forum-context.json`
  → its own Postgres table, see "Ordering / storage"). One row per
  (doc, proposal, edit-set) match, keyed to the bridged uuid:
  `{ docId, topicId, postNo, cycleDate, editSetName, verb?, matchBasis, confidence,
  snippet, forumUrl, pollTx? }` — `cycleDate` from the on-chain poll (fallback:
  post date), `matchBasis` ∈ title-exact | docno+title | phuuid | mention,
  snippet = the doc's bullet body or edit-set prose (clamped ~500 chars).
  **Zero rows in `atlas_history`** — no fabricated change types, no diffs.
- A high-confidence match (title-exact inside an *Add Document* edit set +
  ratified poll) may **upgrade the stage-1 interval birth to a dated birth — via
  the curation queue only**, never automatically. That upgrade is the single
  sanctioned path from forum data into the history table, and it lands as a
  human-locked decision with `method='human'`.
- **Where a birth can't be pinned to a cycle, leave the interval birth from
  stage 1** — the honest default. Measured expectation: ~1/3 of the 881 core
  severed-born docs get cycle coverage with the primitive parser; format-gen-1
  handling + multi-post + design-post enumeration lift this, but **the Agent
  Scope Database rows (1,649) will never be cycle-covered** — they were
  operational data added by Agent launches, not proposed edits. Give them a
  distinct interval label ("added during Agent launch operations") and link the
  framework design posts (`#26047` "Sky Primitives", 2025-02-25; `#25031`
  Launch Season, 2024-09-06) at the era level, not per-doc.
- Keep the old plan's overlap rule: **forum is a source only before 2025-05-28**;
  the 55 overlap-window proposals are calibration data for the parser (compare
  parsed edit-sets against real git diffs), nothing else.

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
- **Forum context gets its own table** (own migration, mirroring the
  artifact-row shape above):

  ```sql
  CREATE TABLE forum_doc_context (
    doc_id      text NOT NULL,      -- bridged atlas uuid (real or synthetic)
    topic_id    int  NOT NULL,      -- forum topic
    post_no     int  NOT NULL DEFAULT 1,
    edit_set    text NOT NULL DEFAULT '',
    cycle_date  date,               -- on-chain poll date (fallback: post date)
    verb        text,               -- Add/Replace/… when parsed
    match_basis text NOT NULL,      -- title-exact | docno+title | phuuid | mention
    confidence  real,
    snippet     text,
    forum_url   text NOT NULL,
    poll_tx     text,               -- on-chain ratification tx when matched
    PRIMARY KEY (doc_id, topic_id, edit_set)
  );
  ```

  Synced by the same worker path as other artifacts (own `sync:*` step, per the
  separate-sync-scripts convention). Served by a small endpoint
  (`/api/forum-context/:docId`, plus an unfiltered listing for the index page).

## UI treatment

- `NodeHistory` currently hides html-era entries behind a "View HTML Era Edits"
  toggle with a disclaimer. Pre-git entries nest one level deeper under it (or
  a sibling "Before git history" group) with **per-era badges + disclaimers**:
  - `era='mip'`: neutral-exact tone — "Proposed in MIP104 §14.3 · 2023-11-06"
    with the mips-repo link. Method badge like html-era's ai/human.
  - `era='genesis'`: exact tone — "Present at Atlas v2 genesis · 2024-09-02"
    linking the IPFS snapshot.
  - `era='severed'` interval births: plain text, no false precision. When the
    context table has rows for the doc, the birth entry gains one line —
    *"N governance proposals from this window appear to reference this doc"* —
    linking to the forum-era page. Suspicion-tier language ("appear to
    reference") is deliberate; the history panel itself never renders forum
    prose.
- **New page: `/forum-era/:id`** (route name TBD) — the per-doc forum-era view.
  Lists every matched proposal for that doc, newest-last: cycle date + title,
  edit-set name, verb + match-basis badge (title-exact / docno+title / phuuid /
  mention — the reader can judge match strength), the snippet excerpt, a link to
  the original forum post, and the on-chain ratification poll (tx + IPFS doc)
  when matched. Header carries the standing disclaimer: proposals are
  pre-ratification text from a window with no surviving git history. A bare
  `/forum-era` index listing the 29 cycles themselves (date, title, size,
  edit-set count, link) is a cheap nice-to-have and doubles as the calibration
  browse view.
- The existing first "Added" row at `4e931dfd` stays (it *is* the first git
  observation) but when older origin events exist below it, render its label as
  "First git snapshot" instead of "Added" — that one-word change removes the lie
  without touching event data.
- The reader keeps the current default collapsed state; pre-git material is
  opt-in disclosure, same philosophy as the HTML-era toggle.

## Curation / verification

- Reuse the htmlhist curation loop shape only where signal quality demands it:
  the 16 ambiguous + 28 containment genesis→root cases, and the 79 title-only
  MIP hints (a human either promotes them to `era='mip'` or drops them). This is
  a **couple hundred decisions total**, not another 10k-row campaign.
- Calibrate the forum parser on the 55 overlap proposals against real git diffs
  before trusting severed-only output (unchanged from the old plan — still the
  right harness).
- The 0.05–0.25 containment band (79 weak matches) stays unshipped until a
  human or model pass reviews it; thresholds are cheap to revisit because the
  lineage JSON records raw scores.

## Phasing & effort

1. **Phase A — genesis + MIP origins** (stages 1+2): mostly porting the
   prototypes to `scripts/prehist/` + the seq/merge plumbing + the two UI
   labels. Everything hard is already measured to work. ~2–3 days. Ships the
   headline feature ("Proposed in MIP", "Present at genesis") for 613 docs.
2. **Phase B — forum context** (stage 3): parser v2 across the three format
   generations + multi-post fetch + overlap calibration + the `forum_doc_context`
   table/endpoint + the `/forum-era/:id` page + the one-line pointer on severed
   birth entries. ~3–4 days. Ships forum context for ~300–500 core docs, honest
   intervals for the rest.
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
2. **`change_type` vocabulary** — keep `added` + era-based rendering (current
   lean, zero migration) vs a new `proposed` change type (cleaner semantics,
   needs enum/CHECK migration + FE plumbing). Lean: era-based rendering.
3. ~~**Snippet storage**~~ — **resolved (2026-07-06): forum material stays out
   of `atlas_history` entirely.** Own `forum_doc_context` table + `/forum-era/:id`
   page; the history panel only carries a suspicion-tier pointer line. The sole
   forum→history path is the curated birth-date upgrade (stage 3).
4. **Do we commit the severed-proposals corpus?** 392 KB of third-party forum
   text in-repo makes the pipeline reproducible if the forum dies/moves; the
   alternative is fetch-on-demand + the manifest. Lean: commit (same argument as
   the genesis snapshot, and it's small).
