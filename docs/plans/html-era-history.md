# Pre-markdown (HTML era) per-commit atlas history

Status: PLANNED (not started). Researched 2026-06-24.

Goal: surface real per-commit, per-document change history for the **79 commits
before PR #117** ("Migrate To Markdown File", commit `22cc27b5`, 2025-11-21),
when the atlas was maintained as a single HTML file. Today those commits are
invisible in the history panel — `NodeHistory.tsx` only renders a static
`PreMdFooter` linking to a GitHub `compare` for the whole era. We want the same
treatment the markdown era gets: a converted-to-markdown snapshot at each
commit, a per-doc line diff against the previous commit, stored in
`atlas_history` and rendered by `EntryRow`.

**Three consumers** of this history, all keyed on the same UUID identity:
1. **Reader** — a document's history panel (`NodeHistory.tsx`), continuous
   through the #117 boundary.
2. **Radar** — an agent's history over time (agents are docs too — the Agent
   Scope Database section, §2b — so they thread back the same way).
3. **AI chatbot** — historic / timescale questions ("what did the atlas say
   about X in July 2025"). This one needs **point-in-time state**, not just
   diffs (see §9.1).

**This is computed once and frozen.** Everything pre-#117 is immutable git
history; the threading pass (§4) is the expensive part. We compute it a single
time and snapshot the result to a checked-in artifact, then never recompute
(§7.1). "Build once" means "freeze once," not "re-derive on every worker boot."

The load-bearing design constraint, per the request: **the human-language diff
is the product.** Everything below is in service of producing clean prose diffs
free of HTML/markup noise.

This plan also folds in `docs/plans/history-slot-reuse.md` (the UUID-era
slot-reuse cross-reference), because the HTML-era renumber detection and the
slot-reuse detection are the same machinery pointed at two eras — building one
without the other leaves the renumber story half-told. See
[§8 Slot-reuse](#8-slot-reuse-folded-in).

---

## 0. What we already have (baseline)

> **Claims re-verified 2026-06-25** against the live submodule + codebase. All
> structural numbers confirmed exact: anchors `4e931dfd`/`22cc27b5`/`7b43d159`;
> 8822 dfn rows at last HTML commit, 4676 at first; 11 invariant H1 sections;
> rich content 3036 `<code>` / 235 `<pre>` / 1902 `<li>` / 584 `<ul>` / 37 `<ol>`
> / 12 nested `<table>` / 106 `<a>`; #117 UUIDs = 7682 total / **7681 distinct** /
> all version-4. Code: `loadSnapshot`/`detectFormat`/`diffSnapshots`/
> `isMdMigration`, md5 contentHash, `gitCommitSeq` (full log), `MAX(commit_seq)`
> cursor, `UUID_RE.test` gate (`history.ts:85`), `PreMdFooter` stub all present;
> `008_preview_trust.sql` taken (use **009**); `jsdom` present, `turndown`/
> `node-html-parser` absent. Two open decisions resolved by measurement — see §12.

- `scripts/required/build-history.mjs` walks the atlas submodule's git log
  (`--reverse`, oldest-first) for commits touching `Sky Atlas/Sky Atlas.md` or
  `content/`. For each commit it builds a `Map<uuid, {doc_no,title,type,content,
  contentHash,path}>` snapshot, diffs it against the previous (`diffSnapshots`),
  and emits `added`/`modified`/`removed`/`moved` events.
- Format-aware loader `loadSnapshot(hash)` already handles **two** atlas
  representations: `monolithic` (single `Sky Atlas.md`) and `atomized`
  (`content/**/document.md`, post-PR #236). It dispatches on `detectFormat`.
- The HTML→markdown migration (PR #117) is currently special-cased: every doc
  shows up as `added` there, so `isMdMigration` re-tags them all `moved` to
  avoid a fake wave of creations.
- Storage: `atlas_history` keyed `(doc_id UUID, commit_sha, change_type)`.
  `commit_seq` is the topological position from `gitCommitSeq()`, which walks
  the **full** submodule log — **so HTML-era commits already have seq numbers
  below the migration.** Ordering across the boundary is free.
- Read path `/api/history/:nodeId` requires a UUID (`UUID_RE.test`). The panel
  is keyed entirely on UUID.
- `moved` events render as `movedFrom → movedTo` in `EntryRow` (today these are
  file paths; we will reuse them for `doc_no → doc_no` renumbers).

## 1. The crux: identity without UUIDs

Post-#117 docs carry a stable `<!-- UUID: … -->`. HTML-era docs have no UUID and
no single stable key: ~60% of rows have no parseable doc number (§2c), and where
a doc number exists it was renumbered freely between commits. Identity is
therefore **positional** — `(section, ancestor title-path, row order)` plus a
content hash — with content-based renumber/rename tracking. So:

1. **Within the HTML era**, the per-commit snapshot is keyed by positional
   identity, not UUID (there is none) and not bare doc_no (often absent, and
   temp names collide hundreds of times — §2c).
2. **A pure renumber** (`A.2.3` → `A.2.4`, same prose) must NOT read as
   `removed(A.2.3)` + `added(A.2.4)`. Per the request: when a doc's entire body
   disappears in a commit and the same body appears under a different doc_no,
   classify it as **"doc number changed"** (a `moved` event) and carry the
   identity forward. This is content-tracking, exactly analogous to git's rename
   detection.
3. **Bridging to the UUID era**: every surviving HTML-era doc must resolve to
   the UUID it received at the #117 migration, so its HTML-era entries attach to
   the same timeline the markdown-era entries already use and show up in the
   existing per-doc panel.

### Why the diff stays clean

Every HTML-era diff compares **converted-markdown(commit N) vs
converted-markdown(commit N−1)** — both sides run through the *same*
deterministic HTML→markdown converter. Conversion artifacts are byte-identical
on both sides and **cancel in the line diff**; only genuine prose changes
survive. This is what makes "the human-language diff is the product" achievable
without a perfect converter — we need a *stable* converter, not a *faithful*
one. (We deliberately do **not** try to make HTML-era output byte-match the
#117 markdown; see §6.)

## 2. Atlas HTML structure

Anchor commits:

- `4e931dfd4017a9b9d573dec1aac352e60f1bb02a` — **first commit** (2025-05-28,
  "first commit"). The compare URL `4e931dfd…22cc27b5` spans HTML-era start →
  markdown migration.
- `22cc27b561b166c8df33b5e9758e5f8b294fc5b4` — **"Migrate To Markdown File
  (#117)"** (2025-11-21). Deletes `Sky Atlas/Sky Atlas.html` (68 527 lines),
  adds `Sky Atlas/Sky Atlas.md` (40 020 lines). First UUID-bearing commit.
- `7b43d159` — last HTML-era commit before #117 ("Atlas Edit Weekly Proposal
  2025-11-17 (#115)", 2025-11-20).

**(a) HTML file path** — `Sky Atlas/Sky Atlas.html` (single file, the whole era).
**79 commits** touch it before #117 (80 including #117, which deletes it).

**(b) doc_no / title / type are encoded as table rows, not headings.**

- The body is **11 `<h1>` section tables** (Scopes, Articles, Sections & Primary
  Docs, Type Specifications, Annotations, Tenets, Scenarios, Scenario Variations,
  Needed Research, Active Data, Agent Scope Database). The `<h1>`s are the only
  headings in the file — there are no `<h2>`–`<h6>`.
- Each **document is a `<tr>`**, not a heading. Columns vary **per section**
  (schema below). A typical row: `<td><dfn>A.0.1 - …</dfn></td>` (doc-no/temp-name)
  · `<td>Name</td>` · `<td>Type</td>` · `<td>Content (rich HTML)</td>`.
- **Per-section column schemas** (the `<th>` sets are identical at commits
  1/20/40/60/79 — one format for the whole era, not a versioned one):

  | Section | Columns |
  |---|---|
  | Scopes / Articles / Annotations / Active Data | Doc No · Name · Type · Content |
  | Sections & Primary Docs / Tenets | Doc No (or Temp Name) · Name · Type · Content |
  | Type Specifications | Doc No (or Temp Name) · Name · Type · Type Overview · Components · Type Category · Doc Identifier Rules · Additional Logic |
  | Scenarios / Scenario Variations | Doc No · Name · Type · Description · Finding · Additional Guidance |
  | Needed Research | Doc No · Name · Type · Research Prompt |
  | Agent Scope Database | **Document Name · Agent Name · Doc Type** · Content |

  So "Content" is not always the prose column: Type Specs spread prose across
  five columns; Scenarios use Description/Finding/Additional Guidance; Needed
  Research uses Research Prompt; Agent Scope DB renames the first two columns.
  The converter must map columns **per section header**, then concatenate the
  prose-bearing cells (under stable section sub-headings, so the diff is
  meaningful) rather than assuming a single Content cell.

- **Content cells are rich HTML** (counts at `7b43d159`): 3036 `<code>`, 235
  `<pre>`, 1902 `<li>`, 584 `<ul>`, 37 `<ol>`, 106 `<a>`, 106 `<strong>`, 12
  nested `<table>`. So the §3 converter genuinely needs list/code/link/table
  handling — the turndown recommendation stands, and the determinism bar is real
  (nested tables + 3k code spans are the hazard).

**(c) Identity is positional; the migration bridge is many-to-many, not lossy.**

- At `7b43d159` there are **8822 document rows**. Only **3571 (40%)** begin with
  a parseable doc-no (`A.0.1`, `4.6`, `NR-1`, …). The header column is literally
  "Doc No **(or Temp Name)**" — the other **~60% are temp names or full
  title-paths**, e.g. `Proposal Passes`, `Slope 1`, or
  `4.6 - Token Transfers To Sky - Process for … - DssBlow2`.
- Temp names are **massively non-unique**: `Parameters` appears 129×,
  `Active Instances` 156×, `Hub Data Repository` 145×, `Primitive Hub Document`
  90× (the repeated primitive-hub sub-structure). **So the snapshot cannot be
  keyed on `<dfn>` text** — neither the doc-no (absent 60% of the time) nor the
  temp name (collides hundreds of times) is a usable key on its own. Identity
  must be **positional**: (section, ancestor title-path, row order) +
  contentHash, with renumber/rename detection by content (§4).
- **Short and non-unique rows are *the* dominant matcher hazard — measured by the
  threading prototype (2026-06-25), not a footnote.** Rows under ~8 words carry no
  shingles (can't fuzzy-match) and collide by temp-name (above), so a matcher that
  leans on content alone shunts them into false `removed`/ambiguous: the prototype
  over-reported deaths **10 922 vs the real ~852** and produced an **18 k** raw
  ambiguous queue, almost all of it boilerplate collision, *not* genuine prose
  ambiguity. The **only** thing that carries these rows is the **tier-2 structural
  key** (§4.2) — it is **load-bearing, not residual**. Getting it right is the
  single highest-leverage part of the matcher.
- The atlas **roughly doubled** across the era: **4676 rows at the first commit →
  8822 at the last.** Per-commit churn is large; expect heavy add traffic.
- **The node counts differ, but no content is lost — #117 regranulates, it
  doesn't delete.** `7b43d159` has 8822 HTML rows; `22cc27b5`'s markdown has
  **7682 UUID-bearing docs**. The counts differ because the migration **reshapes
  granularity**: it *splits* some HTML rows into several finer md docs and
  *merges* others into a shared md doc — but the prose is carried across, not
  dropped. Measured both directions (§4.1): **~89% of HTML prose survives into
  the md**, and genuinely-new / genuinely-deleted content at the seam is **≈0**.
  So the §4 bridge is a **many-to-many content map**, not a lossy projection. The
  ~1140 "extra" HTML rows are **`merged`** (content absorbed into a surviving md
  doc — recorded with a `merged_into` pointer and kept fully queryable), and
  ~280 md docs are **`split`** children carved out of an HTML parent (recorded
  with `extracted_from`). §5.2 therefore **keeps every row** (synthetic UUID +
  seam tag); nothing is silently dropped, and "deletion at #117" is the rare,
  surfaceable exception, not the bulk story.

So: §3 parses table cells (not headings), §1/§4 identity is positional, and §4's
content-fallback matcher is the common case rather than the exception. The
converter targets a single stable schema; the identity/bridge step — mapping
many HTML rows to many md docs *without losing content* — carries the real risk.

### 2.1 Structural consistency across the era

Across all 79 HTML-era commits (`Sky Atlas/Sky Atlas.html`, 2025-05-28 →
2025-11-20):

- **The 11-section skeleton is 100% invariant.** Every one of the 79 commits has
  the identical ordered H1 list (Scopes, Articles, Sections & Primary Docs, Type
  Specifications, Annotations, Tenets, Scenarios, Scenario Variations, Needed
  Research, Active Data, Agent Scope Database). No section was ever added,
  removed, renamed, or reordered. The doc-level `<style>` block and DOCTYPE are
  likewise stable.
- **The 11 top-level section table schemas never changed.** The §2(b) column
  table holds for the whole era.
- **The only `<th>`-set change in the entire era** was the addition of two
  columns — **"Exposure Type"** and **"Reference"** — at commit `d531de16`
  ("September 29 edit (#63)", 2025-10-02, commit 46/79). And it is **not** a
  top-level schema change: those columns belong to a **nested table inside one
  document's content cell** (`A.3.3 - Identify Exposure Types`, under Sections &
  Primary Docs). So even that lone delta is just ordinary prose-cell content, not
  a structural migration.
- Row count grew monotonically-ish 4676 → 8822 (≈ doubled); H1 count pinned at 11
  throughout.

**Converter implication:** the §3 parser needs exactly **one** top-level table
schema (keyed by section header) for the whole era — no schema-versioning, no
boundary-detection. It must render **nested tables inside content cells**
generically (12 such tables at the last commit), which GFM/turndown handles.

### 2.2 The HTML→markdown migration was a manual, out-of-repo conversion

There is **no HTML→markdown converter anywhere in the atlas repo's history.**

- **#117 ("Migrate To Markdown File", Adam Fraser, 2025-11-21)** is a single
  opaque commit: it *deletes* `Sky Atlas.html` and *adds* `Sky Atlas.md`, nothing
  else (`git show 22cc27b5 --name-status` → exactly `D … .html`, `A … .md`). The
  conversion ran **outside the repo**; no script, config, or notebook was
  committed with it.
- A blob-content search across **all** commits for the usual converters
  (`BeautifulSoup`, `html2text`, `turndown`, `markdownify`, `pandoc`,
  `from_html`, …) returns **nothing**. The only helper scripts ever in the repo:
  - `helpers/add_uuids/add_uuids.py` — added in **#136 (2025-12-03, ~2 weeks
    *after* the migration)**. Appends `<!-- UUID: <uuid4> -->` to any heading
    line that ends in `]` (i.e. `[Type]`) and lacks one. It is the *standing*
    UUID-assignment tool for new docs, **not** the migration tool, but it almost
    certainly mirrors the method used at #117 (see below).
  - `sync/{compose,decompose,hash}.py` — added in **#236 (2026-05-05)**, the much
    later *atomization* (md monolith ↔ one-folder-per-document). Unrelated to
    HTML→md.
  - `helpers/templates/Launch Agent Artifact Template.md` — a content template.
- **Fingerprint of the #117 markdown confirms the add_uuids.py method was used at
  migration:** all 7682 UUID comments are **version-4 (random)** — the
  version-nibble histogram is `7682 × '4'`, exactly what `uuid.uuid4()` emits.
  Not content-derived/deterministic.
- **The migration also renumbered, it didn't just convert.** HTML
  `<dfn>A.0.1 - Atlas Preamble - Definitions - Organizational Alignment</dfn>`
  (Core) became markdown `#### A.0.1.1.1 - Organizational Alignment [Core]`. The
  title-path was stripped out of the doc-no and a clean hierarchical doc-no
  (heading depth = doc-no depth) was synthesized. Prose in the content cell is
  preserved verbatim. So **doc-nos are not stable across the #117 boundary** —
  the §4 bridge cannot lean on doc-no equality and must fall back to
  content/title matching for most docs.
- **Data-quality note for the bridge:** 7682 UUID comments but only **7681
  distinct** — one UUID is duplicated at migration. A genuine uuid4 collision is
  astronomically improbable, so this is a hand copy-paste artifact. Any code that
  keys on `(doc_id)` must not assume #117 UUIDs are unique; de-dup defensively
  when seeding the bridge.

**External confirmation** — the official announcement
([forum.skyeco.com/t/atlas-migration-to-markdown/27448](https://forum.skyeco.com/t/atlas-migration-to-markdown/27448),
adamfraser on behalf of @atlas-axis, 2025-11-21, the same author/date as commit
`22cc27b5`) matches the git evidence:
- Done **"in collaboration with the Core Facilitator"** — a manual, collaborative
  effort. No tool, script, or conversion methodology is named (consistent with
  "no converter in the repo").
- The stated goal corroborates the renumber finding: the markdown version "now
  reflects the full hierarchical structure of the Atlas, with parent-child
  relationships expressed using **Markdown header levels and document numbers**,"
  applying "the **full formal Atlas document numbering specification**." So the
  clean hierarchical doc-nos (heading depth = doc-no depth) were *synthesized* at
  migration from the HTML title-paths — they are not carried over, reinforcing
  §2c (doc-nos are not stable across #117).
- Caveat from the post: a **"slight inconsistency in document numbering which we
  will resolve,"** plus Portal↔GitHub timing differences. So expect some doc-no
  noise *at and just after* the boundary — another reason the §4 seed match leans
  on content/title, not doc-no equality.
- Motivation was explicitly "much more amenable to **automation and AI
  integrations**" — i.e. exactly the consumers (reader/radar/chat) this plan
  serves.

**Net:** there is no automated HTML→markdown converter to reuse or reverse-
engineer — the §3 converter is the first deterministic one, and we own it
entirely. It targets a single, stable HTML schema (§2.1).

## 3. HTML reader + converter — `scripts/htmlhist/atlas-html.mjs` (NEW)

The single repo-structure-dependent module. Mirrors the contract of
`parseMonolithic` / `loadAtomizedAt` in `build-history.mjs`: given a commit
hash, return a snapshot of nodes keyed by **positional identity** (no UUID
exists, and doc_no is unreliable — §2c). Each node carries
`{doc_no?, title, type, content, contentHash, section, path}`.

```
loadHtmlAt(hash):
  raw = git show <hash>:'Sky Atlas/Sky Atlas.html'
  return parseHtmlToNodes(raw)

parseHtmlToNodes(html):
  - Parse with a deterministic HTML parser. We already ship jsdom (dev dep);
    prefer a lightweight streaming parse (e.g. node-html-parser) added as a
    build-only dep.
  - Walk the 11 <h1> section tables. For each <tr>, map columns by the section's
    header row (§2b) — first column is doc_no-or-temp-name (<dfn>), then Name,
    Type, and one or more prose cells. Derive a positional identity
    (section, ancestor title-path from the <dfn>'s " - " segments, row order).
  - Convert the prose cell(s) html → markdown with a deterministic converter
    (turndown, pinned config: ATX headings, '-' bullets, fenced code, no
    auto-trailing-whitespace), concatenating multi-prose-column sections under
    stable sub-headings. Render nested content-cell tables as GFM. Determinism >
    fidelity (§1).
  - content = trimmed markdown body; contentHash = md5(content)  [match the
    existing makeNodeEntry hashing so the diff core behaves identically].
```

Determinism checklist for the converter (each non-determinism = diff noise):
- Stable bullet/heading/emphasis markers (pin every turndown option).
- Collapse insignificant whitespace identically on both diff sides.
- Strip HTML attributes that don't carry prose (ids, classes, styling).
- No locale/timezone/random in the output.
- Add a tiny golden test: convert the same fixed HTML snippet twice → identical.

> Decision needed: turndown (mature, configurable, ~1 dep) vs a hand-rolled
> converter (no dep, but we own every edge case). Recommend **turndown pinned**
> — it's a build-only dependency, never shipped to the client.

## 4. HTML-era history pass — `scripts/htmlhist/history-html-era.mjs` (NEW)

Pure, testable. **Two passes: A) thread identity *backward* from #117; B) emit
diffs *forward* from the first commit.** Kept separate from the UUID-keyed
`diffSnapshots` so neither path grows conditionals for the other.

### 4.0 Why backward

The only ground-truth identity in the whole era — the real `uuid4`s — lives at
the **newest** end (minted at #117, §2.2). So thread *from* the anchor:

- **Forward** (the naive direction) would thread positional identity from commit
  1 and only learn each doc's UUID at the very end via an error-prone
  identity-match step; every mis-thread compounds *toward* the anchor.
- **Backward** starts *on* the anchor and carries real UUIDs back in time, so
  errors decay *away* from ground truth. It also **dissolves the forward bridge**
  entirely: at #117 every surviving doc already *is* its UUID, so there is no
  separate end-of-run resolution step.

The cost doesn't vanish — it concentrates in **one** step: the first backward
hop, #117 markdown (7682 UUID'd docs) → `7b43d159` HTML (8822 rows). That is the
*only* step that crosses the md↔html format boundary **and** is many-to-many
(~1140 HTML rows `merge` into surviving md docs, ~280 md docs `split` out of
HTML parents — content-conserving, §2c/§4.1; nothing dropped). Every *other*
backward hop is HTML→HTML through the same converter, where §1's
artifact-cancellation holds and **exact contentHash matches dominate**.

> **Prototype-validated (2026-06-25).** A throwaway backward-threader (real seed
> via cross-format containment + tier-1/2/3 backward) confirmed the shape end to
> end: tier-1 exact-content carried **99.6%** of all HTML→HTML pairs, and UUIDs
> seeded at #117 threaded **all the way back to the May-2025 genesis commit** for
> the bulk of docs. The seed hop is indeed the one hard step — exact/section
> matching scored ~0 across the format boundary; only inverted-index *containment*
> seeded it. The residual risk is short/non-unique rows (§2c, §4.2 tier 2), not
> the threading mechanism.

### 4.1 Pass A — backward identity threading

```
threadIdentities(htmlCommits /* newest→oldest */, mdAt117):
  // Seed: match #117 markdown docs onto the last HTML commit's converted-md,
  // SAME converter both sides (§1). This is the one hard, cross-format,
  // many-to-one match — see 4.2 matcher. Survivors carry their real uuid4.
  curr = convertMarkdownDocs(mdAt117)                 // 7682 nodes, each has uuid
  identity = Map<identityKey, { uuid, firstSeenSha }> // key = positional id (§2c)

  for commit in htmlCommits (newest→oldest):
    prevHtml = loadHtmlAt(commit.hash)                // converted-md nodes, no uuid
    pairs = matchNodes(prevHtml, curr)                // 4.2

    for {older, newer} in pairs:                      // identity flows newer→older
      id = identity.get(newer.key)                    // newer already resolved
      identity.set(older.key, id)                     // carry UUID back in time

    for older in prevHtml with NO pair:               // a doc that, going back,
      // ...has just "appeared": it exists here but not in the newer commit,
      // i.e. (going forward) it was DELETED before now. No UUID exists for it →
      // mint a deterministic synthetic one, ONCE, at this its-newest occurrence.
      id = { uuid: syntheticUuid(older), firstSeenSha: commit.hash }  // 4.3
      identity.set(older.key, id)

    curr = prevHtml

  return identity   // every HTML-era (commit, node) now maps to a stable UUID
```

Going backward the doc set *shrinks* (8822 → 4676), so most rows simply
*disappear* at their creation point — handled in Pass B. Rows that *appear*
going backward get synthetic v5 UUIDs and are tagged so consumers can filter
them (§7, §9).

**The seed is bidirectional, not just many-to-one — measured 2026-06-25.** The
#117 boundary both *merges* (many HTML rows → one md doc) **and** *splits* (one
HTML parent's content cell → a parent md doc **plus** several finer child docs).
The split direction is large and was nearly invisible until measured:

- By title alone, **~284 of the 7682 #117 docs (≈3.7%)** look "born at #117"
  (no HTML predecessor title).
- Matching their *prose* sentence-by-sentence against the last HTML commit:
  **159 (56%) have 100% of their sentences already present verbatim** in the
  prior HTML; **184 (65%) ≥60%**; 61 of the rest are trivial one-line
  "…Location" pointer rows. The strict-substring residue is only **39 docs
  (~0.5% of 7682)** — and even those are *reworded* carry-over, not new topics
  (their subjects appear dozens of times in the HTML: `encumbrance ratio` ×32,
  `standby spell` ×103, `net revenue` ×49, …).
- **Conclusion: genuinely-new content at #117 ≈ 0.** Almost every "born" doc is
  prose that already lived in the HTML atlas, overwhelmingly **as a subsection of
  what became its parent**, extracted into a standalone node at migration.

**#117 conserves content — measured in both directions (2026-06-25).** It is a
*regranulation*, not a wave of creations and deletions. The node-level diff lies
in both directions; the content-level truth is conservation:

| node-diff naively says | content reality (measured) |
|---|---|
| ~280 md docs "created" at #117 (no HTML twin) | ≈0 new — their prose was already in the HTML, mostly inside what became their parent |
| ~1140+ HTML rows "deleted/merged" at #117 (no md twin) | ≈0 lost — **82% of HTML prose survives verbatim into the md, ~89% with rewording**; the ~11% residue is overwhelmingly `<dfn>` breadcrumb/path strings the md drops because heading nesting now encodes hierarchy (§2.2), not deleted content |

So the seam is a **many-to-many regranulation map** (HTML content regions ↔ md
docs), content-preserving. Identity threads by *following the content*, not the
node. A doc-identity's relationship across the seam is one of **three
content-conserving kinds** (`seam`, a per-doc field — **distinct from `era`**,
which is pure format; see §7):

- **`kept`** — 1:1 bridge (tiers 1–3). The common case; its `added` at #117 is
  dropped because its creation is already in the HTML era.
- **`split`** (~280) — an md child whose body is a *subsection* of an HTML
  parent's content cell (tier 4). **Not `added`** — record `extracted_from` =
  parent UUID and thread the child's history *into the parent's* pre-#117
  timeline. The child keeps its own #117 uuid4 going forward; backward, its
  history is the parent's.
- **`merged`** (~1140) — an HTML row whose content was *absorbed into* a
  surviving md doc's body. Record `merged_into` = successor UUID so chat can
  follow it forward; do not treat as a deletion.

- **`untraced`** (added 2026-08) — the seed found no predecessor and nobody has
  ruled one out. Not a fourth content-conserving kind: it is the *absence* of a
  verdict, and the reader says so ("history before the migration could not be
  traced") instead of implying a birth. See below — this is what the residue the
  first freeze called `created` actually was.

**Genuine `created` / `deleted` at #117 are measured ≈0**, so they are *not* a
bulk population — they stay reserved for the rare true case, and because each is
rare it is a real, surfaceable event rather than migration noise. The numbers
above (~280 split, ~1140 merged) are upper bounds from node-counting; the §10
seam measurement re-derives them by content and should drive any survivor near
zero into `created`/`deleted` only on real evidence.

> **Measured — two distinct deletion populations with two sinks; do NOT conflate
> them (corrected by the prototype, 2026-06-25).** `deleted≈0` is a SEAM property
> only; *within* the HTML era deletion is real, but it splits two ways:
> - **Data-churn (sentence-level) — the big population, stays in surviving
>   nodes.** Of **11 277** distinct deleted prose sentences across the 79 commits,
>   **1 497 (13.3%) never resurface** (shingle oracle vs final state). This is
>   dominated by content trimmed *inside docs that live on*, so it clusters in
>   *cleanup / derecognition* commits — `#12` "governance scope cleanup" (142
>   sentences, yet **doc-death = 1**), `#17` (101, **death = 0**), `#14`
>   "Derecognize ADs that failed to migrate" (**40/40 sentences gone but 0 docs
>   die** — it strips 78 AD-recognition `<a>` links from *surviving* docs), `#78`
>   (110). The correct sink is a **`modified` event on the surviving node** — its
>   diff chain retains the old text, which is *valuable* for the chat "what was
>   the budget in June 2025" consumer — **not** a tombstone.
> - **Doc-death (row-level) — the small population, needs tombstones.** Whole
>   `<dfn>` docs that vanish with content not re-keyed elsewhere total **~852
>   era-wide** (structural row-key scan), **~600 excluding `#1`'s draft-thrash**
>   (253; the 2nd commit ever, restructuring a nascent atlas). These cluster in
>   the big *weekly restructures*, **not** the cleanups: `#22` (~225), `#66`
>   (~115), `#103` (~52), `#78` (~48). Each genuine death gets one synthetic-UUID
>   **tombstone + `removed`**; counts are an upper bound until the real fuzzy
>   matcher reclassifies renumber-with-edit rows as `moved`. **This** — not the
>   13.3% — is the tombstone population: load-bearing but modest. Conflating the
>   two (as an earlier draft did, pinning "graveyard" on the cleanups) would
>   over-tombstone surviving docs and lose their data-churn diff chain.

### 4.2 The matcher — `matchNodes(older, newer)`

Reused at every backward hop **and** at the seed boundary; it is also the
slot-reuse pairing of §8 (factor into `scripts/htmlhist/history-identity.mjs`).
Tiered, cheapest-first, to avoid an O(n²) edit-distance blow-up:

1. **Exact `contentHash`** — covers *both* "unchanged in place" and
   "moved-but-unchanged" in one tier; no position needed. Position is only a
   tie-breaker when one hash occurs twice (duplicated boilerplate). **Prototype-
   confirmed to dominate HTML→HTML hops: 99.6% of all pairs** (2026-06-25) — so
   per-hop threading is cheap, exactly as the §4.0 cost argument assumes.
2. **Structural key** = `section` + **full ancestor title-path** (the whole
   `<dfn>` " - " chain) + the **owner / Agent column** (the §2b Name cell) + leaf
   title — *not* the leaf doc_no/temp-name alone, which collides hundreds of
   times (§2c). **This tier is load-bearing, not a fallback** (§2c): short rows
   (< ~8 words) carry no shingles, so tier 3 *cannot* match them — the structural
   key is their **only** handle — *and the seed had no such tier*, which is why
   the first freeze shipped 1 159 `created` docs against a measured ≈0 of genuine
   births: the whole zero-shingle population (the ICD parameter leaves, bodies
   like `` `Completed` ``) fell straight through. Fixed 2026-08 by **seed tier
   S2** (`scripts/htmlhist/seed-positional.mjs`), which ports the tier-2.5 idea
   below across the seam: anchor on the shingle-matched pairs, then align the
   zero-shingle leftovers by order inside each anchor gap, only where the bucket
   sizes match. The residue it can't reach is `untraced` (§4.1), never `created`.
   The owner column matters: the §3 converter
   measured it (2026-06-25) cuts raw seed-commit key-collisions **69% → 52%** by
   de-colliding bare temp-name rows (every "Spark" row no longer shares one key).
2.5. **Positional alignment within a key-bucket.** Even the strong key leaves a
   measured **~45% of seed rows in a distinct-content collision** — almost all of
   it the **Agent Scope DB deep hierarchy**, e.g. `…spark…parameters` ×48 (one
   "Parameters" doc per primitive an agent runs), whose true disambiguator (which
   primitive/instance) lives in **row order**, not the dfn, columns, or nesting
   (only ~12 nested tables era-wide). **Do not reconstruct that ancestry in the
   parser** (§3 deliberately doesn't). Instead, when a key maps a *bucket* of N
   older rows to N newer rows, **align them by `order`** (k-th older ↔ k-th newer):
   the atlas preserves row order, so a stable bucket threads deterministically
   without a unique key. This extends tier-1's position tie-break to tier-2 buckets
   and dissolves the bulk of the apparent collision; only when a bucket's size
   *changes* (a row inserted/removed/reordered inside it) is the residual genuinely
   ambiguous → tier 3 / §10.4. **This is the mechanism that turns the raw 45%
   collision into a small real decision queue** — the converter measurement above
   is exactly why this step exists. **Validated end-to-end (2026-06-25):** the
   real converter + matcher leave **0 ambiguous on the prototype's worst hop
   (`73a607a4`, was 661)** and only ~1–22 on bulk-edit commits (28 across four
   sampled hops); tier 1 alone carries >99% of pairs.
3. **Fuzzy, residual only** — generate candidates within the same section whose
   title is similar OR whose doc_no is adjacent, then score by the **shared-line
   ratio from `diffCore`** (NOT character-level Levenshtein — too costly on
   multi-paragraph bodies), blended with a positional-proximity prior. When the
   top candidate is **confident and uncontended**, assign greedily with a
   deterministic tie-break (sort by `(score, section, title-path, contentHash)`),
   exactly like git's rename-detection similarity index + locality. **When it is
   gray-zone, has multiple plausible predecessors, or is contended, do NOT commit
   the greedy guess — emit the ranked candidate set to the §10.4 decision queue**
   and take the resolved (recorded) choice. A frozen, immutable history must not
   silently bake a guessed parent.
4. **Containment / sub-node (seed hop only).** For a `newer` doc still unmatched
   after tiers 1–3, test whether its **normalized body is a contiguous
   subsequence** of some `older` parent's content cell (same section, parent on
   the `newer` doc's ancestor title-path). This is the *split* case (§4.1): one
   HTML parent → parent + extracted children. It is **one-to-many** and therefore
   does **not** consume the parent (the parent still matches its own counterpart
   in tier 1–3). Emit an `extracted_from` link to the parent's resolved UUID
   rather than a pairing. Cheap signal: §1 artifact-cancellation means the
   child's converted-md lines appear *verbatim* inside the parent's converted-md,
   so this is a substring/subsequence check, not fuzzy scoring. Measured target:
   ~280 children at the seed (§4.1).

**The seed is many-to-many — both directions are explicit policy, not
accidents** (boundary maps 8822 HTML rows ↔ 7682 md docs, content-conserving,
§4.1):
- **Many-to-one (`merged`):** when several `older` HTML rows' content was
  absorbed into one `newer` md doc, keep the best pairing as the doc's own
  identity; the other rows record `merged_into` = that doc's UUID. Never let them
  fall through to a silent drop / "deleted".
- **One-to-many (`split`):** tier 4 attaches extra `newer` children to an `older`
  parent **without** competing for the parent's own pairing; children record
  `extracted_from` = parent UUID. Never let an extracted child fall through to
  `added`.
Both relationships are content-conserving and logged; their counts (~1140
merged, ~280 split) are upper bounds re-checked by the §10 seam measurement.

### 4.3 Synthetic UUIDs — `syntheticUuid(node)`

For HTML rows with **no real #117 UUID of their own** — i.e. `merged` rows (whose
distinct pre-#117 history must stay queryable even though their content was
absorbed into a successor) and *mid-era graveyard* tombstones (created+deleted
within the HTML era). Note `kept` and `split` rows do **not** need synthetics:
`kept` carries its real #117 uuid4; a `split` child carries its own #117 uuid4
forward and threads backward through `extracted_from` into the parent's timeline.
Two hard requirements:

- **Deterministic, never random.** This repo enforces reproducible builds
  (`REPRO=1 pnpm test`; no `randomUUID()` in output — see CLAUDE.md /
  deterministic-builds). Use **uuid v5** (namespaced SHA-1) over a stable tuple:
  `v5(NS_ATLAS_HTML, section | titlePath | contentHash | firstSeenSha)`. Minted
  **once** at the row's newest occurrence and carried back unchanged — never
  recomputed per commit.
- **Auto-distinguishable + resurrection-safe.** v5's version nibble is `5`,
  so synthetic IDs are trivially told apart from the real `4`s — the `seam`/`era`
  tagging and the "never confuse synthetic with real" invariant come for free.
  Including `firstSeenSha` keys identity to **one contiguous life**, so a row
  deleted and later re-added (or two unrelated rows sharing final boilerplate)
  cannot collide into a merged timeline. This is the §8 slot-reuse hazard; same
  helper.

### 4.4 Pass B — forward diffing

With identity fixed for every `(commit, node)`, walk **oldest→newest** and emit
events per UUID: `added` at a UUID's first appearance, `modified`
(`diffCore.lineDiff` of consecutive converted-md, `classifyDiff` for
significance), `moved` when the doc_no/title-path changed between consecutive
commits (renders `movedFrom → movedTo`, §7), `removed` at its last appearance.
Same diff bytes and significance classes as the markdown era, so HTML-era rows
render identically in `EntryRow`. The #117 boundary event itself is a labelled
migration marker with its content diff suppressed (§5.3, §6).

> **Implemented + a load-bearing gotcha (2026-06-25).** `buildEvents` lives in
> `scripts/htmlhist/history-html-era.mjs`; the orchestrator is `scripts/aux/prepare-
> html-history.mjs` (`pnpm htmlhist:prepare [--measure]`), which uses the real
> `diffCore.lineDiff` + `classifyDiff` and emits events in the exact `eventToRow`
> shape (`commitHash`/`changeType`/`movedFrom`/`movedTo`/`diff`/`changeKind`) plus
> the additive `era`. **Adjacency invariant:** `added`/`removed` run-boundaries
> must be decided by a UUID's position in the *HTML-commit list* (a contiguous
> index), **not** the absolute `commit_seq` — HTML commits are **not consecutive
> in the full submodule log** (non-HTML commits interleave), so `seq+1` arithmetic
> sees a phantom gap at every hop and explodes `added`/`removed` ~3×. `commit_seq`
> (from `gitCommitSeq`, reconcile-by-SHA, §7.1) is carried only for DB ordering.

## 5. Wiring into `build-history.mjs`

1. **Two read paths, kept disjoint — resolve the apparent overlap up front.**
   The `loadHtmlAt` / HTML-parse branch lives **only inside the offline
   `prepare-html-history.mjs` runner** (§7.1), which is the one place that walks
   HTML commits and runs §4. The steady-state `build-history` does **not** get
   an `"html"` branch in its `getCommits()`/`loadSnapshot()` loop and never
   re-derives HTML events — for the HTML era it short-circuits to "load frozen
   artifact → upsert." `detectFormat` only ever returns `monolithic`/`atomized`
   at runtime; `html` is a freeze-time-only format. (This supersedes any reading
   of an earlier draft that put an `"html"` branch in the live `loadSnapshot`.)
2. The HTML-era events are therefore **loaded from the frozen artifact** (§7.1)
   and upserted into `atlas_history`. The expensive threading (§4) runs once,
   offline; `build-history` just seeds `newHistory` from the artifact. HTML rows
   with no real #117 UUID (`merged` rows + mid-era graveyard, §4.1/§4.3) are
   **kept**, not dropped: they carry deterministic synthetic v5 UUIDs and the
   appropriate seam/era tag (§7), so `atlas_history.doc_id` stays satisfied and
   the chat/timescale consumer can reach absorbed and dead content. Log the
   counts separately (`N merged-into-successor`, `M deleted-mid-era`).

   > **Implemented + TDD-covered (2026-06-25).** Migration `009_html_era.sql` adds
   > the five additive nullable columns (`era`/`seam`/`extracted_from`/`merged_into`/
   > `move_kind`); `history-db.ts` extends `HISTORY_COLS` + `HistoryEvent`/
   > `HistoryInsert` + `eventToRow` (all `?? null`, so the markdown era is
   > untouched), and adds `htmlEraRows(artifact, seqByCommit)` → `HistoryInsert[]`
   > (commit_seq reconciled by SHA). Specced test-first in
   > `src/server/history-db.test.ts` (13 tests, incl. a markdown-era regression
   > guard); all green, and the full `bun test src/server` (121) stays green.
   > **Remaining:** wire `build-history` to call `htmlEraRows` + `upsertHistory`
   > against a live DB (the only DB-dependent piece).
3. The migration commit (#117): with HTML-era history now present, the
   `isMdMigration` blanket re-tag (`added`→`moved`) becomes the **identity
   bridge** instead. Surviving docs already have their HTML history; at #117 we
   want at most one structural "migrated HTML→markdown" marker per doc, not a
   content diff (the converted-md vs real-md diff is pure conversion noise and
   must be suppressed). Replace the blanket re-tag with a **`seam`
   classification** of the 7682 docs the diff would naively call `added`:
   - **`kept` (≈7400):** doc whose body matches an HTML-era node (tiers 1–3).
     Drop the `added`; its creation is already recorded in the HTML era.
   - **`split` (≈280):** doc whose body is a *subsection* of an HTML parent
     (tier 4). Record `extracted_from` = parent UUID, **not** `added`. Its
     history threads into the parent's HTML-era timeline (§4.1).
   - **`created` (≈0, upper bound ~39):** no HTML predecessor or parent
     containment. Keep as `added` — this is the real, tiny target, and each one
     is worth surfacing precisely *because* it is rare.

   Measured (§4.1): under the old blanket logic **all 7682 are masked to
   `moved`**, with zero discrimination. The bridge replaces that with ~0 true
   `added`. "After bridging, true `added` at #117 ≈ 0 (≤ ~40)" is the headline
   §10 integration assertion.
4. `commit_seq`: no change — `gitCommitSeq()` already numbers HTML-era commits.
5. PR metadata: **measured — all 78 HTML-era PRs carry a `(#NNN)` + title**
   (100% coverage, not sparse as an earlier draft feared). So `fetchPr` enriches
   every HTML-era entry exactly as it does the markdown era; the "render with
   just date + commit link" fallback (EntryRow already handles it) will rarely if
   ever fire. The only real risk is `gh` API rate limits / cache misses against
   `sky-ecosystem/next-gen-atlas`, which already degrade gracefully — and because
   the artifact is frozen (§7.1), PR enrichment is fetched once at freeze time and
   baked in, never re-fetched per build. `fetchPr` is also where the
   **originating forum-thread URL** is extracted (it sits in the PR body) and
   baked into the artifact — see §10.3. The body is uneven (~half link a forum
   proposal, ~21% empty), but the forum URL and PR title degrade independently,
   and title-only is fine for the small cleanup commits that lack a body.

## 6. Why NOT byte-match the migration boundary

The atomization boundary (PR #236) was engineered so `extractBody` output is
byte-identical to `parseMonolithic` output → hashes agree → no fake diff. We
**cannot** replicate that for HTML→markdown: the conversion is normalizing and
lossy, so the #117 boundary will never be byte-clean. That's fine and
intentional:
- HTML-era diffs are computed **within** the HTML era (converted-md vs
  converted-md), where the same-converter-both-sides property holds (§1).
- The #117 boundary itself is treated as a labelled migration event, its
  content diff **suppressed** (§5.3), not shown as prose churn.

So the converter's job is internal consistency across consecutive HTML commits,
NOT agreement with the markdown era. This relaxes the converter requirements
enormously.

## 7. Storage & schema

No new columns strictly required: HTML-era events map onto existing
`atlas_history` columns.
- `added`/`modified`/`removed` → as today, with `diff` jsonb.
- renumber → `change_type='structural'` (`moved`), `moved_from`/`moved_to` =
  the **doc_no strings** (not paths). `EntryRow`'s `movedFrom → movedTo`
  rendering already reads as "A.2.3 → A.2.4", which is exactly "doc number
  changed". Visually fine; no schema change for the *render*.
- **But `moved_from`/`moved_to` now carries three incompatible payloads**: file
  paths (atomization moves, markdown era), doc_no strings (HTML renumber), and
  the #117 bridge marker. The UI doesn't care, but any *structured* consumer
  (radar, chat) that parses `moved_from` as a path will misread a doc_no.
  **Add a discriminator** rather than overloading silently: a `move_kind TEXT`
  (`'path' | 'doc_no' | 'migration'`) alongside the existing columns, or reuse
  the `era` tag to disambiguate. Pick one and state it; don't leave the column
  polymorphic-by-convention.

**Two orthogonal columns — keep them separate (this is the schema correction).**
An earlier draft jammed format-era and per-doc seam-fate into one `era` value
(`html-merged` etc.); those are different axes and must not share a column.

- **`era TEXT` = format/period only**, derivable from the commit (it is exactly
  what `detectFormat` keys on): `era IN ('html', 'markdown-monolith',
  'markdown-atoms')`. The `markdown-monolith`→`markdown-atoms` boundary is #236
  ("Atomic Atlas", the atomization PR — `detectFormat` calls this format
  `atomized`); `html`→`markdown-monolith` is #117. Nothing about a doc's fate
  lives here. This is what the UI labels ("HTML era", etc.).
- **`seam TEXT` = the #117 reorganization relationship, per doc, nullable**
  (null for every row whose identity doesn't cross the seam):
  `seam IN ('kept', 'split', 'merged', 'reintroduced', 'untraced', 'created', 'deleted')`.
  These are **content-conserving reorganization links, not loss/creation tags** (§4.1):
  `kept` (1:1), `split` (carved out of a parent), `merged` (absorbed into a
  successor). `created`/`deleted` are the measured-≈0 genuine cases — rare enough
  that each is a real event, not a population — and `untraced` is the honest
  fall-through for a doc the seed couldn't thread either way. Since `untraced` and
  `created` have no event of their own to hang on, `stampMigrationSeam`
  (`src/server/history/history-db.ts`) writes every doc's verdict onto its #117
  `structural` row on each sync. Plus two pointer columns:
  - `extracted_from UUID` — on `split` rows: the HTML parent the doc was carved
    out of (§4.2 tier 4). Lets reader/radar/chat thread the child's history
    *into* the parent's pre-#117 timeline.
  - `merged_into UUID` — on `merged` rows: the surviving md doc the row's content
    was absorbed into, so chat can follow absorbed content forward.

Reader/radar follow `extracted_from` to show continuity for `split` children and
`merged_into` for absorbed content; chat queries everything including
`deleted`/synthetic rows. Synthetic-vs-real is already free from the v5/v4 nibble
(§4.3), so `era`/`seam`/the pointers are for query+UI semantics, not base
correctness. All of these go in **migration 009** (008 is already
`008_preview_trust.sql` — the slot-reuse plan's "008" is stale, see §8).

> **Implemented in the artifact (2026-06-25).** `seedFromMd` computes the full
> per-doc seam map (kept 4631 / split 1736 / merged 1355 / created 1314) plus
> `extracted_from` (1702/1736 split children resolve a parent) and `merged_into`;
> the freeze runner bakes it into `artifact.docMeta` (uuid → `{seam, extractedFrom?,
> merged_into?}`) and stamps `seam`/pointers onto each doc's **`added` event** as
> additive fields. **Split children are md-only** (no HTML-era event of their own),
> so their lineage lives in `docMeta`, queried directly — exactly the radar/chat
> path above. **Dedup guard:** the one duplicated #117 uuid (7682 vs 7681, §2.2)
> made a split child's `extracted_from` resolve to its own twin; `seedFromMd` now
> drops self-references (`extracted_from === uuid`). A fuller de-dup at seed time
> (§2.2) is still pending.

Mid-era graveyard (created **and** deleted *within* the HTML era, never reaching
#117, §4.1) is the one place `seam` doesn't apply — those rows get `era='html'`,
a synthetic v5 UUID, and a `removed` event at their last commit, with no seam
link (no successor exists).

Backfill: `build-history` is incremental (cursor = `MAX(commit_seq)`). HTML-era
commits are below every existing row's seq, so a normal incremental run will
**not** reach them. A one-time `pnpm build:history --full` re-walks from the
first commit and fills them; `ON CONFLICT … DO UPDATE` makes it idempotent. Run
once on the worker after deploy (same playbook as the metrics backfill already
noted in CLAUDE.md "Pending work").

### 7.1 Freeze the computed history as an artifact

Pre-#117 history is **immutable** (frozen git past) and the §4 threading pass is
the expensive part. Compute it **once**, offline, and snapshot the result —
identity map + per-UUID events + diffs — to a checked-in artifact
(`public/history-html-era.json`, or a generated SQL seed). `build-history` then
loads that artifact instead of re-deriving (§5.2). Two reasons, both load-bearing:

- **Cost.** The boundary match + 79-hop backward thread + fuzzy residual runs
  zero times in steady state instead of on every worker boot / container build.
- **Stability.** Historical diffs must never silently change. If someone later
  tweaks the deterministic converter (§3), a *recomputed* HTML era would shift
  every pre-#117 diff under users' feet. A frozen artifact pins the prose diffs
  to what was reviewed. Regenerating is a deliberate, reviewed act (a script +
  PR), never an implicit side effect of an unrelated converter change.

The artifact is keyed by UUID and carries `commit_seq`, so it merges cleanly with
live `atlas_history` and survives schema migrations via the normal upsert.

**Load-bearing invariant — production must see full git history.** The frozen
artifact bakes in absolute `commit_seq` integers (≈1–80) computed offline against
the *complete* submodule log. Live markdown-era rows get their seq from the
production `gitCommitSeq()`, which walks whatever the **Railway atlas clone**
contains (per CLAUDE.md the atlas is git-*cloned* on Railway, not a submodule). If
that clone is ever shallow or otherwise doesn't reach the root `4e931dfd`,
production's numbering starts above 1 and the frozen HTML seqs (1–80) collide
with / misorder against live rows. Two defenses, do at least one:
1. **Assert full history at build/boot**: fail loudly if
   `git rev-list --max-parents=0 HEAD` ≠ `4e931dfd` or the clone is shallow
   (`git rev-parse --is-shallow-repository` = true) before trusting absolute
   seqs.
2. **Reconcile by SHA, not by integer**: have the loader re-resolve each frozen
   row's `commit_seq` through the live `gitCommitSeq()` map (keyed on the stored
   `commit_sha`) at upsert time, so ordering is derived from the live log rather
   than trusted as a baked constant. Preferred — it is robust to clone depth.

## 8. Slot-reuse, folded in

`docs/plans/history-slot-reuse.md` is the UUID-era mirror of §4's renumber
detection: when a *new* doc (with a fresh UUID) takes over a doc_no that a
*different* UUID used to hold. It annotates the new doc's `added` event with
`slot:{prevId,prevTitle,movedTo?}` and (optionally) the old occupant's event
with `takenBy`. Implement it together with this plan because:
- Both need the same "match a doc to where its content/number went" helper —
  factor it once (`matchNodes` for the HTML era, §4.2; the uuid-occupant check
  for the UUID era) in a shared `scripts/htmlhist/history-identity.mjs`.
- Both extend `EntryRow` with renumber/slot cross-reference copy — one UI pass.

**Correction to that plan**: it specifies `migrations/008_history_slot.sql`, but
008 is taken (`008_preview_trust.sql`). Use **`009_history_slot.sql`** (and if
§7's optional `era` column lands, combine both into one 009 migration). The rest
of the slot-reuse plan (HISTORY_COLS wiring, `slot`/`taken_by` jsonb, read path,
`EntryRow` disclaimer copy) stands as written.

## 9. Frontend

`src/components/history/NodeHistory.tsx`:
- The 79 HTML-era entries now arrive as real `HistoryEntry[]` from the API and
  render through `EntryRow` like any other — no per-entry UI work needed
  (date, change label, diff, commit link all work; the commit link already
  points at `next-gen-atlas/commit/<sha>`, valid for HTML commits).
- Replace the static `PreMdFooter` (the "79 prior commits exist… view HTML-era
  diff" stub) with either nothing (now that real entries exist) or a slim
  one-line era marker on the oldest HTML entry ("· HTML era — converted from the
  pre-markdown atlas"). Keep the GitHub compare link as a "see raw HTML diff"
  affordance if desired.
- If §7's `era` column lands, tint or tag HTML-era rows so users know the diff
  is converter-derived, not a literal source diff.
- **`EntryRow` fields are additive-only — never modify existing ones** (user
  directive, 2026-06-25). The HTML-era events already carry an additive `era`
  field (`buildEvents`, §4.4) so the row can show a "pre-markdown · converted from
  the HTML atlas" note / converter-derived-diff warning **without touching the
  existing `HistoryEntry` shape**. Any further HTML-era signal (e.g. `synthetic`,
  `seam`) is added as a new optional field the markdown era simply leaves unset;
  existing field meanings and rendering stay byte-for-byte unchanged.

`patch-notes.md`: add a user-facing bullet on the deploy date, e.g.
"Added document history for the pre-markdown (HTML) era of the atlas."

### 9.1 The other two consumers

**Radar (agent history).** Agents are docs (Agent Scope Database section, §2b)
and thread back on the same UUIDs, so an agent's history view gets the HTML era
for free once `atlas_history` is seeded — no radar-specific work beyond reusing
the same per-UUID query. For continuity, follow `extracted_from`/`merged_into`
(§7) so a split-out or absorbed agent shows its full lineage. Default to hiding
only genuinely-dead lineages (mid-era graveyard / `seam='deleted'`) so they don't
clutter the timeline — a one-line filter on synthetic v5 UUIDs.

**AI chatbot (point-in-time state).** Reader and radar consume *diffs*, but
timescale questions ("what did the atlas say about X in July 2025") need a doc's
**state at a commit**, not a delta. The diff chain already encodes this: a doc's
state at `commit_seq = N` is its `added` body replayed through every `modified`
diff up to N. So the capability exists without new storage — but make it a first
class, cheap lookup rather than forcing the chat layer to replay diffs ad hoc:
- Provide a `docStateAt(uuid, commit_seq)` helper (server-side) that walks the
  frozen events and returns reconstructed markdown. Memoize per `(uuid, seq)`.
- Because the era is frozen (§7.1), these reconstructions are themselves
  immutable and can be cached aggressively (or even pre-materialized for the
  chat retrieval index if point-in-time recall becomes hot).
- Absorbed (`merged`) and dead (mid-era graveyard / `seam='deleted'`) content is
  **in scope** for chat — answering "what used to be there" and "where did this
  go" is its whole value — so chat does **not** apply the reader/radar
  dead-lineage filter; it queries synthetic v5 rows too.
- **Originating-proposal context (§10.3).** Each commit's PR title/link and
  forum-thread URL (+ snapshot) live in the artifact, so chat can answer *why* a
  change happened ("the 2025-11-17 weekly proposal renamed Accessibility Reward to
  Distribution Reward and added the Keel Allocation System docs"), not just *what*
  changed — the forum thread is the human-authored rationale the diff alone can't
  give.

## 10. Verification

- Unit (`history-html-era.test.mjs`): renumber pairing (pure renumber;
  renumber-and-edit same commit; add vs delete that are NOT a pair; same-doc_no
  edit). Bridge resolution (exact doc_no; content-fallback; `merged`→`merged_into`;
  `split`→`extracted_from`; genuinely-unresolved → synthetic UUID + seam tag,
  **never silently dropped**).
- Golden (`atlas-html.test.mjs`): fixed HTML snippet → expected markdown;
  convert-twice determinism; two near-identical HTML inputs → minimal line diff
  (proves artifacts cancel).
- Integration: run `pnpm build:history --full` against the real submodule; spot
  a doc known to predate #117 and confirm its panel now shows a continuous
  timeline through the migration; confirm a known renumber renders as
  `doc_no → doc_no`; confirm no doc shows a giant noise diff at the #117 row.
- `--out-json` canary path gets the HTML-era entries for free (same event
  objects), so the existing artifact/canary tests cover the JSON shape.

### 10.0 Pre-build: the seam-conservation measurement (gates the schema)

Before writing the converter, run the content-conservation check both directions
against the real boundary — it sizes `created`/`deleted` and validates that
`seam` is the right model (the scratch measurements that produced the §4.1
numbers; promote them to a committed `freeze-html-history --measure` mode):

- **Forward (md → did it exist in HTML):** of the ~284 title-"born" #117 docs,
  confirm ≈0 are genuinely new (measured: 159/284 = 100% verbatim, residue ~39
  all reworded carry-over). Drives the `created` count. **Measure at the *blob*
  level — against the whole HTML prose — not per-row.** The threading prototype
  showed per-row/single-parent containment over-reports `created` ~50× (it called
  ~2050 docs "new" when the true figure is ~39), because short docs and content
  split across several rows fail a single-row containment test. `created` is a
  blob-survival question, not a row-pairing one.
- **Backward (HTML → did it survive into md):** of all distinct HTML sentences
  (sans `<dfn>` breadcrumbs), confirm ~82% survive verbatim / ~89% with
  rewording, residue dominated by path strings. Drives the **seam** `deleted`
  count → ≈0. **Scope note: this is a #117-*seam* property only.**
- **Intra-era deletion — two scans, two populations (§4.1):** (i) a *sentence*-
  survival scan shows **13.3% (1 497) never resurface**, but this is mostly
  **data-churn inside surviving docs** → `modified`, *not* tombstones; (ii) a
  *row-key* structural scan shows **~852 whole docs die** era-wide (~600 ex-`#1`),
  the actual **tombstone** population, clustered in big weekly restructures
  (`#22`/`#66`/`#103`/`#78`), *not* the cleanups (`#12`/`#14`/`#17` ≈0 doc-death).
  Both are real and **not** ≈0; ship both as committed `--measure` outputs and
  keep doc-death (tombstone) strictly separate from data-churn (diff-chain).
- **Gate:** if the *seam* residue is materially larger than measured (say >2–3%
  real prose), stop — the regranulation model is wrong for the boundary and
  `seam` needs rethinking. (The intra-era 13% is expected, not a gate failure.)

### 10.1 Named fixtures — the commits that actually stress the matcher

Per-commit churn is **sharply bimodal** (measured 2026-06-25): the median
consecutive-commit diff is tiny (3–270 changed lines → tier-1 exact-hash
matching dominates, as §4.2 assumes), but a handful of bulk-edit commits reflow
thousands of rows at once, collapse tier-1 entirely, and exercise the tier-2/3
fuzzy path across a whole section. **Those are the regression fixtures** — pin
them, not synthetic toy diffs. Ranked by `Sky Atlas.html` line churn:

| Commit (full) | PR | Date | Churn (+/−) | Why it's a fixture |
|---|---|---|---|---|
| `79abe87fbb4195642faa10722f40b069c230eb56` | #1 | 2025-05-26 | +15149/−7291 | Largest single edit in the era — the initial population wave. Backward-threading's *oldest* hop; forward = a huge `added` burst. Tests that bulk creation doesn't false-pair against unrelated boilerplate. |
| `66dcdb78ebc7a5f728d189fb9dc63667253c72a0` | #103 | 2025-11-02 | +6582/−3695 | Largest *mid-era* rewrite. Many rows edited-in-place + renumbered in one commit → the renumber-and-edit case (§4.2 tier 3) at scale. |
| `3c501b9d1e8b32df46f6f3a1ab139b2d98a0545f` | #12 | (gov cleanup) | +1268/−3814 | Net **deletion**-heavy but **data-churn, not doc-death** (prototype: died=1, rows stable at 2675): the −3814 lines are content removed from *surviving* rows. Exercises the data-churn path — heavy in-place removal emits `modified` on surviving nodes (kept in their diff chain for chat), and the §10.0 sentence-survival oracle confirms the content truly vanished vs reorganized elsewhere, **without** spawning whole-doc tombstones. |
| `34cdf3d23ef945b392e6851fb6c5c8752df2a328` | #17 | (cleanup) | +1550/−2091 | Balanced add+delete "cleanup multiple scopes" → worst case for greedy many-to-one assignment; tests deterministic tie-break. |
| `7efd3a80…` | #14 | "Derecognize ADs that failed to migrate" | 0/−78 | **Canonical DATA-CHURN, not doc-death (corrected by prototype 2026-06-25).** Despite the name, **0 whole docs die** — rows 4841→4841; it strips 78 `<a>` AD-recognition links from *surviving* docs. Tests that in-place content deletion emits `modified` on the surviving node (preserved in its diff chain for chat), **never** a tombstone. Also a live §10.3 fuzzy-join test: its commit date mis-matches the *unrelated* 2025-06-09 weekly thread (26608) — itemized-overlap verification must reject it. |
| `4dbd365e…` | #22 | Weekly Cycle Atlas Edit 2025-06-30 | — | **Canonical doc-DEATH / tombstone fixture (prototype 2026-06-25): ~225 whole rows vanish** with content not re-keyed (upper bound; the real fuzzy matcher reclassifies renumber-with-edit rows as `moved`). The genuine deaths each need one synthetic v5 tombstone + `removed`. This is where tombstoning is actually exercised — **not** the #12/#14/#17 cleanups (doc-death ≈0 there). |
| `02a3eb13eb8d060007b8655729a1a94d08fe59b0` | #78 | October 13 edit | +3582/−647 | **49% graveyard rate** (110/223 deletions permanent) despite being add-heavy → tests that the survival oracle separates real removal from reword inside the *same* commit. |
| `7b43d159e098b30e67c4be6a7594a237a340fa58` | #115 | 2025-11-17 | +4258/−81 | **The backward-seed's older side.** Large change immediately before #117 — the converted-md of this commit is what the 7682 md docs seed-match onto. The single most important pairing in the whole pass. |
| `d531de16…` ("Exposure Type"/"Reference" cols) | #63 | 2025-10-02 | — | The *only* `<th>`-set change in the era (§2.1), inside one doc's nested content table. Golden-converter fixture: nested-table column add must render as ordinary prose-cell diff, **not** a structural event. |

Fixture assertions to lock in:
- **Seed (`7b43d159` → #117 md):** ~7400 `kept` pairings + ~280 `split` children
  (`extracted_from` set) + ~1140 `merged` rows (`merged_into` set); **true
  `added` ≈0 (≤ ~40)** and **true `deleted` ≈0** (§10.0). No real uuid4 assigned
  to two different HTML rows; the one duplicated #117 uuid4 (7682 vs 7681
  distinct) is de-duped defensively (§2.2) and doesn't crash the seed.
- **Bulk renumber (#103):** a doc whose body is unchanged but doc_no moved emits
  exactly one `moved` (`doc_no → doc_no`), **not** removed+added.
- **Data-churn (#12/#14):** content removed from a *surviving* row emits
  `modified` on that node (its diff chain retains the old text for chat); it does
  **not** create a tombstone. Assert doc-death ≈0 here (prototype: died ≤1).
- **Doc-death (#22):** a whole row that vanishes with content not re-keyed
  elsewhere (sentence-survival oracle negative) emits exactly one `removed` +
  synthetic v5 UUID; a renumber-with-edit instead resolves to `moved`, not a
  death. Log both counts.
- **No giant noise diff** at the #117 row for any surviving doc (boundary diff
  suppressed, §6).

### 10.2 LLM-backed freeze-time audit — orphans & anomalies (offline only)

The deterministic matcher will mis-thread *some* docs across 79 commits no fixed
threshold catches. An LLM is the right safety net — but it must never run **in the
build-time identity path**, because this repo's builds are deterministic and the
artifact is frozen (`REPRO=1`, no `randomUUID`, §7.1). A *live* LLM deciding
identity during a build would break both reproducibility and frozen-diff
stability. It has **two offline roles** instead, both feeding committed files the
build replays deterministically: a **freeze-time auditor** (this section) and a
**decision proposer** for the ambiguous subset (§10.4). The boundary:

- **Deterministic core decides everything that lands in the artifact** — all
  threading, UUIDs, diffs, seam tags. Reproducible, frozen, LLM-free.
- **The core also emits, per commit, a deterministic `orphans` set** — nodes
  unmatched after all four tiers in *either* direction (an md doc with no HTML
  origin; an HTML row that vanishes with no successor). Orphan *detection* is
  mechanical and already required (it's what gates synthetic UUIDs / tombstones).
  Emitting it is free; it is the audit's input.
- **`scripts/htmlhist/audit-html-history.mjs` (NEW, offline) runs an LLM over orphans,
  flagged anomalies, and per-commit intent records (§10.3) and writes a *review
  report*, not artifact data.** Per commit it triages:
  - **orphan classification** — *expected* (e.g. `#14` derecognition, volatile
    data-churn §4.1) vs *suspicious* (looks like a real doc the matcher failed to
    thread → likely a bug/threshold miss);
  - **low-margin pairings** — tier-3/tier-4 matches just over threshold: "are
    these two really the same doc?";
  - **big-diff commits** — classify each as renumber / rewrite / split / genuine
    deletion (cross-check against the deterministic seam tag **and the originating
    forum proposal's itemized changes, §10.3**);
  - **graveyard validation** — for each shingle-flagged "gone for good" sentence,
    "truly removed" vs "reworded — the matcher should have caught this."
- **Human-gated loop:** a person reads the report; a real mis-thread is fixed by
  adjusting a threshold or adding a *deterministic* override, then the freeze is
  re-run. The LLM output never enters the artifact. This is the `/code-review`
  pattern: advisory, gates the one-time freeze, not load-bearing for correctness.
- **Cost is a non-issue:** the freeze is one-time and offline, so ~79 commit
  audits (or only the flagged ones) run once, never per build / per worker boot.

This is also the natural home for a recurring **"completeness critic"** pass — an
LLM prompted to ask "what threaded wrong, what orphan looks mis-classified, what
seam tag disagrees with the prose?" — whose findings become the next threshold
tweak before the artifact is finally frozen and reviewed.

### 10.3 Per-commit intent records — PR body + forum proposal (audit oracle, not identity)

Measured 2026-06-25: every HTML-era commit carries a PR, and the human *intent*
behind each is recoverable — but unevenly, in a way that happens to line up with
where the matcher needs the most help.

- **PR title — 100% coverage.** All 78 HTML-era PRs have a title, and for the
  small cleanup/fix commits the title *is* the intent ("Derecognize ADs that
  failed to migrate", "Correct tags", "Fix Ecosystem Entity Grants document
  type"). Those commits also have small, unambiguous diffs, so title-only is
  plenty.
- **Forum proposal thread — ~half of PRs, concentrated on the bulk edits.** The
  weekly / Spark / SAEP PR bodies link a forum thread (`forum.sky.money` → 301 →
  `forum.skyeco.com`, **public Discourse — append `.json` for structured data**,
  verified fetchable without login). The thread enumerates each change with **high
  granularity** — verbatim example from #115: seven named items ("Add SubProxy
  Account For Launch Agent 4", "Add Allocation System Primitive Documents For
  Keel", "Update Remaining References To Accessibility Reward", …), several citing
  exact doc-nos (`A.2.6`, `A.2.3.9.1.1.1.1.4`), on-chain addresses, and
  cross-linked PRs. These are exactly the **bulk-edit commits that collapse tier-1
  matching** (#1/#103/#115, §10.1) — so the richest intent record exists precisely
  where threading ambiguity is highest.
- **Empty PR body ≠ no intent — reverse lookup recovers it by date.** ~21% of PR
  bodies are empty, but the thread can be found *from the commit* instead of from
  the body. Discourse `search.json` is public, and weekly threads are slugged
  `atlas-edit-weekly-cycle-proposal-week-of-YYYY-MM-DD`, so the **commit date
  resolves the thread directly** (**verified**: #78 "October 13 edit" has an empty
  body, yet maps to thread `27311`, which itemizes its seven changes — "Introduce
  Launch Agent 4", "Update RRC Percentage For Pendle PTs", …). Two recovery paths:
  **(a) date-slug** fetch; **(b) full-text** `search.json?q=<commit title/date>`
  (both hit `27311` independently). Caveat: the thread usually links the *repo*
  ("update the Atlas GitHub repository"), **not the specific PR**, so the join key
  is the **weekly cycle / date, not an explicit backlink** — a *fuzzy* match,
  confirmed by overlap between the thread's itemized changes and the commit's diff
  (a natural §10.2 audit check) and **never trusted as identity**. (URL-path
  search `q=…/pull/78` does *not* work — Discourse tokenizes URLs.)
- **The real title-only residue is internal, non-proposal commits** —
  derecognitions, tag/type fixes, lints (#14 "Derecognize ADs that failed to
  migrate", #12 "governance scope cleanup", #97 "Correct tags"). These have **no
  forum thread in either direction** (verified: searching #14's text returns
  nothing relevant), so the PR title *is* the whole intent. Acceptable — they are
  also the smallest, most self-describing diffs. The genuinely hard fixtures are
  the rare **large** commits with no proposal anywhere; those lean on the §10.0
  sentence-survival oracle + the §10.2 LLM audit.

**How intent is used — display + audit, never identity.** Same hard boundary as
the LLM (§10.2): intent is external, unversioned, and **must not enter the
deterministic identity/diff path** (it would break reproducibility and frozen-diff
stability, and doc-nos cited in a proposal are editorial, not stable keys —
CLAUDE.md doc_no rule). Two safe uses:

1. **Display / chat.** Bake the PR title, PR link, and originating-forum-thread
   URL into the frozen artifact per commit (stable refs, fetched once at freeze —
   §5 item 5). The reader's history row and the chat "why did this change" answer
   both gain the human rationale for free. Discourse content itself is **snapshot
   at freeze** (URL + fetched-at + content hash), so the artifact never depends on
   a live fetch and can't drift when the forum is edited or a thread disappears.
2. **Audit context (§10.2).** Feed the forum's itemized change list to the
   freeze-time auditor so it classifies a bulk commit *change-by-change* against
   stated intent — e.g. #115's "Update Remaining References To Accessibility
   Reward" (a rename to "Distribution Reward") tells the auditor that a doc which
   looks deleted+added is a **rename the matcher should have paired**; "Add …
   Documents For Keel" *predicts* a burst of genuine `added` rows, so their lack
   of an HTML predecessor is expected, not an orphan bug. The auditor cross-checks
   the deterministic seam tags / orphans against the proposal and flags
   disagreements for the human gate.

Caveats: the **forward** forum→PR link is recovered from the PR body
(deterministic); the **reverse** commit→thread link is a **fuzzy date join**
(display + audit only, above), to be verified by itemized-change overlap before
its URL is baked; only internal non-proposal commits stay title-only; and
`gh pr list` only returns the most recent ~250 PRs, so the ~12 oldest HTML-era
PRs — including **#1, whose body is a rich change *checklist*** — must be fetched
individually (`gh api …/pulls/N`) at freeze time.

### 10.4 Interactive, recorded threading decisions (the ambiguous subset)

Tiers 1–2 (exact content / structural key) are unambiguous and auto-thread the
bulk. The residual fuzzy tier 3 and the split/merge tier 4 (§4.2) are where the
matcher *guesses* — and a silent greedy pick is exactly where a frozen, immutable
history would bake in a **wrong parent**. Rather than trust a global threshold,
**resolve the ambiguous subset as recorded, content-addressed decisions** — the
pattern this repo already ships for the process inventory
(`pnpm processes:apply-decisions <decisions.json>`, the `/reports/processes`
curation UI that exports exactly that shape).

**When a case is surfaced (not auto-threaded):**
- **Gray-zone score** — the best tier-3 candidate clears the "plausible" floor but
  not the "confident" ceiling.
- **Multiple plausible predecessors** — ≥2 `older` candidates clear the floor for
  one `newer` doc; pick which is the parent.
- **Contention (the back-and-forward check)** — one `older` doc is the best match
  for ≥2 `newer` docs (or vice versa). Resolve these **as a cluster**, not one at
  a time: assigning one side changes the other's options (a small bipartite
  assignment, not N independent picks).
- **Split-vs-`created` / merged-vs-`deleted`** ambiguity at tier 4 / the seam.

Everything confident and uncontended auto-threads and is never shown.

**What the step shows** (CLI prompt for MVP; optionally a curation page mirroring
`/reports/processes`): the `newer` doc (title, doc_no, content preview); the
ranked `older` candidates with shared-line score, a side-by-side diff preview,
**and who else is competing for each** (contention is visible); an **LLM-proposed
recommendation + rationale** per candidate (this is the "LLM helps" role — it
ranks and explains, it does not commit); and the choices: pick a predecessor ·
"genuinely new (`created`)" · "split from parent X (`extracted_from`)" · "merged
into Y (`merged_into`)" · defer.

**What is recorded — content-addressed, so it is reproducible AND stable:**

```
public/history-threading-decisions.json:
[{ commit_sha,
   subject_hash: v5key(newer.contentHash | section | titlePath),  // doc being placed
   verdict:      "match" | "created" | "split" | "merged",
   target_hash?: v5key(older.contentHash | …),                    // chosen predecessor/parent
   among:        [candidate_hash…],        // full plausible set shown, for audit
   decided_by:   "human" | "llm:auto", model?, rationale }]
```

- **Keyed on content hashes, never doc_no/row-order** (editorial / unstable —
  CLAUDE.md doc_no rule). If the underlying content changes, the key no longer
  matches → the decision **auto-invalidates and re-surfaces** (stale-decision
  detection) instead of silently mis-applying to different prose.
- The file is **committed and reviewed**, exactly like the frozen artifact.

**This PRESERVES `REPRO=1`, it doesn't weaken it.** The build is
`f(atlas_sha, converter_code, decisions.json)` — all three fixed and committed, so
two builds are byte-identical. The LLM/human run **once, offline, beforehand** to
*author* `decisions.json`; nothing nondeterministic runs during the build. This is
the precise version of §10.2's "deterministic identity path": the path consumes a
**frozen decisions file**, and judgment is captured *in* that file rather than
avoided. It also retires the fragile "tweak a global tier-3 threshold" loop —
per-case overrides are local and never ripple onto other docs.

**Completeness gate + non-interactive fallback.** The freeze runner refuses to
write the artifact while any ambiguous case is **undecided** (strict mode), so no
guessed parent is ever silently baked. To bootstrap, the LLM **auto-seeds** a
proposed verdict for every ambiguous case (`decided_by:"llm:auto"`); a human then
reviews/overrides the filtered subset that matters (low-confidence, contended,
high-fan-out) rather than deciding all from scratch. A re-freeze with a complete
file runs fully non-interactively (CI-safe).

**Queue size is itself a gate — and the gate counts *genuine-prose* ambiguity,
not structural-collision noise.** The threading prototype (2026-06-25) produced an
**18 k** raw ambiguous queue, but almost all of it was short/duplicated boilerplate
rows colliding by content (§2c) — **not** cases a human should ever see. The human
queue is only the **tier-3 prose gray-zone** (genuinely-similar bodies above the
floor, below the ceiling); dup-content / dup-key collisions belong to the
structural layer and must be resolved by a stronger tier-2 key (§4.2), not by
curation. So: a large *raw* queue ⇒ the converter or tier-2 key is wrong (fix that
first, don't curate around it); a healthy *genuine-prose* queue is
dozens-to-low-hundreds, concentrated in the bulk-edit commits (#1/#22/#66/#103).
Emit **both** numbers in `--measure` (raw vs prose-gray-zone) so the distinction is
visible — a raw queue that dwarfs the prose queue is the signal to fix keys, not to
staff a curation marathon.

**Relation to §10.2.** §10.2 *audits* what was decided (post-hoc); §10.4 *captures*
the decision (at decision time). Same LLM-assist + human-gate infrastructure. The
auditor additionally validates `decisions.json` — no contradictions, no stale
keys, no contended cluster left internally inconsistent.

## 11. Effort & files

Revised estimate **~5–7 days** (the original "2–3 days" undercounts). The
deterministic converter is the main unknown but it is not the only hard part: the
tiered fuzzy matcher + backward threading (§4), the freeze tooling (§7.1), the
`009` migration with `seam`/`era`/`extracted_from`/`merged_into`/`move_kind`
(§7), the freeze-time LLM audit (§10.2), the per-commit PR + forum intent fetch/snapshot
(§10.3), and three frontend consumers (§9) each carry real work. Budget ~2–3 days
for converter + matcher alone and ~2–3 more for wiring, migration, the audit
harness (incl. ~½ day for the §10.3 intent fetch + snapshot), UI, and the §10
fixtures.

New:
- `scripts/htmlhist/atlas-html.mjs` — HTML read + deterministic md conversion + parse.
- `scripts/htmlhist/history-html-era.mjs` — backward identity threading (Pass A) +
  forward diffing (Pass B), synthetic v5 UUIDs, deterministic per-commit
  `orphans` emission (§10.2 input).
- `scripts/htmlhist/history-identity.mjs` — shared `matchNodes` content-pairing helper
  (also used by slot-reuse).
- `scripts/htmlhist/prepare-html-history.mjs` — one-shot offline runner that computes
  §4 and writes the frozen artifact; rerun only as a deliberate, reviewed act.
  `--measure` mode emits the §10.0 seam + §4.1 graveyard + §10.4 decision-queue
  sizes without writing the artifact. `--decide` runs the §10.4 interactive
  resolution and writes/updates `history-threading-decisions.json`. The default
  run consumes that file and **errors on any undecided ambiguous case** (strict
  completeness gate). Also fetches per-commit PR metadata + the originating forum
  thread (§10.3) and snapshots them (URL + fetched-at + content hash).
- `scripts/htmlhist/audit-html-history.mjs` — offline LLM auditor over orphans +
  anomalies → human-readable review report; never writes artifact data (§10.2).
  Also hosts the §10.4 LLM **decision-proposer** (auto-seeds `decided_by:"llm:auto"`
  verdicts for the ambiguous queue) and **validates** `history-threading-decisions.json`
  (no contradictions, no stale/auto-invalidated keys).
  > **Implemented (2026-06-25): the *measured-confidence* audit.** `pnpm
  > htmlhist:audit` collects the real decision pool tagged by batch (seed
  > close-calls 2,610 / seed-decisive 4,059 control / tier-2.5 297 / tier-2.7 33 /
  > tier-3 114 / ambiguous 260), deterministically stratified-samples it
  > (content-hash sort, no RNG), and — with `--live` + `OPENROUTER_API_KEY` (the
  > existing `src/server/llm.ts` client → any model via `getModel()`) — asks the
  > LLM "is this identity choice correct?" per case, reporting a **per-batch error
  > rate + 95% Wilson interval** + sample misses to `.cache/audit-html-report.json`.
  > Dry mode (no key) writes the exact sampled cases to `.cache/audit-html-cases.json`.
  > This is what converts the estimated ~85–92% identity confidence into a
  > *measured* number per batch — the gate for the zero-tolerance bar.
- `public/history-html-era.json` — frozen artifact (identity map + per-UUID
  events + diffs + per-commit intent records: PR title/link, forum-thread URL +
  snapshot, §10.3), checked in (§7.1).
- `public/history-threading-decisions.json` — committed, content-addressed record
  of every ambiguous tier-3/4 threading decision (§10.4); a reproducible build
  **input** alongside the atlas sha + converter code.
- `src/server/migrations/009_history_slot.sql` (+ `seam`, `era`, `extracted_from`,
  `merged_into`, `move_kind` columns — §7; combine slot-reuse + HTML-era cols
  into the one 009).
- Tests next to each new lib.

Changed:
- `scripts/required/build-history.mjs` — HTML path/format branch, run the
  HTML-era pass, replace `isMdMigration` re-tag with the identity bridge.
- `src/server/history-db.ts` — slot-reuse cols (per slot-reuse plan); `era`,
  `seam`, `extracted_from`, `merged_into` (§7).
- `src/server/history.ts`, `src/lib/history.ts` —
  slot/takenBy/era/seam/extracted_from/merged_into fields.
- `src/components/history/EntryRow.tsx` — slot/renumber cross-reference copy.
- `src/components/history/NodeHistory.tsx` — retire/replace `PreMdFooter`.
- `package.json` — `turndown` (build-only) if chosen over a hand-rolled converter.
- `patch-notes.md`.

## 12. Open decisions

1. **Converter**: turndown-pinned (recommended) vs hand-rolled.
2. **Positional identity key**: exact shape of `(section, ancestor title-path,
   row order)` and how aggressively `matchNodes` tier 3 matches renumber-and-edit
   in one commit (shared-line-ratio threshold + positional-prior weighting).
3. **Freeze artifact format**: JSON blob (`public/history-html-era.json`,
   simplest, diffable in PRs) vs a generated SQL seed (loads faster, opaque in
   review). Recommend JSON.
4. **Seam vs era (decided, §4.1/§7):** `era` is pure format (`html` /
   `markdown-monolith` / `markdown-atoms`); the #117 fate is a separate `seam`
   field (`kept`/`split`/`merged`/`created`/`deleted`) with `extracted_from` /
   `merged_into` pointers — content-conserving links, not loss/creation tags
   (seam-`created`/seam-`deleted` measured ≈0 *at the #117 boundary*). Open
   sub-question: (a) do reader/radar ever surface a "merged/absorbed" or "deleted"
   view, or only hide them? Chat always includes everything. **Resolved (b):**
   intra-HTML deletion is **real and splits two ways** (§4.1) — *data-churn*
   (13.3% of deleted sentences, inside surviving docs → `modified`, concentrated
   in cleanup/derecognition) and *doc-death* (~852 whole docs era-wide →
   tombstones, concentrated in big weekly restructures). Tombstoning is required
   but **only for doc-death**, not the 13.3%. **Resolved (c):** the granularity
   split — tombstone whole nodes only (doc-death), keep superseded data in the
   surviving node's diff chain (data-churn).
5. ~~**PR enrichment for HTML era**~~ — **RESOLVED 2026-06-25**: all 80 HTML-era
   commit subjects carry `(#NNN)` (100% coverage). Summaries are as rich as the
   markdown era; the no-PR fallback rarely fires. See §5 item 5.
6. **`commit_seq` reconciliation** (§7.1): assert-full-history vs reconcile-by-SHA.
   Recommend reconcile-by-SHA (robust to Railway clone depth).
7. **`moved_from`/`moved_to` discriminator** (§7): dedicated `move_kind` column
   vs reusing `era`. Recommend an explicit `move_kind` so structured consumers
   never have to guess whether a value is a path or a doc_no.
8. **LLM audit scope** (§10.2): which model + how much to audit (every commit vs
   only flagged anomalies) and whether the auditor blocks the freeze (hard gate)
   or only advises. Recommend OpenRouter via the existing provider-agnostic LLM
   indirection, audit only flagged orphans/low-margin pairings (not all 79
   commits blindly), advisory-by-default with a human gate before commit. Hard
   invariant: LLM output is review-only and never enters the **build-time**
   identity path (it may author the committed §10.4 decisions file offline).
9. **Intent records (§10.3):** how much to bake — PR title/link + forum URL only
   (minimal, always-valid refs) vs also snapshotting the forum thread *text*
   (richer chat/audit context, but freezes external content into the repo).
   Recommend: bake refs for every commit; snapshot the forum thread *text* only
   for the bulk-edit fixtures (#1/#103/#115 + any large empty-body cleanup), keyed
   by content hash, where audit value is highest. For empty-body commits, resolve
   the thread by **reverse lookup** (date-slug / full-text, §10.3); since that
   join is by date — not an explicit PR link — verify thread↔commit correspondence
   (itemized-change overlap) before baking the URL, and tag it `date-matched` so
   chat/UI can hedge. Hard invariant (mirrors §10.2): intent is display + audit
   only — **never** an input to identity/diff.
10. **Interactive threading decisions (§10.4):** surface ambiguous tier-3/4
    matches (gray-zone, multi-candidate, contended) for an LLM-assisted human
    choice recorded in `history-threading-decisions.json`. Open: (a) CLI prompt
    vs a `/reports`-style curation UI for the review surface; (b) LLM auto-seed
    every ambiguous case then human-review-the-subset (recommended) vs human
    decides all from scratch; (c) strict completeness gate (freeze errors on any
    undecided case — recommended) vs deterministic-default fallback. Hard
    invariant (mirrors §10.2): only the **committed, content-addressed** decision
    is a build input; nothing nondeterministic runs during the build, so `REPRO=1`
    holds. Same machinery serves the §8 slot-reuse pairing.
