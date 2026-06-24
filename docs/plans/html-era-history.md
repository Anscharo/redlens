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

**(c) Identity is positional, and the migration bridge is lossy.**

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
- The atlas **roughly doubled** across the era: **4676 rows at the first commit →
  8822 at the last.** Per-commit churn is large; expect heavy add traffic.
- **The migration is not 1:1.** `7b43d159` has 8822 HTML rows; `22cc27b5`'s
  markdown has **7682 UUID-bearing docs**. ~1140 rows do not survive as distinct
  UUID'd docs (merges/drops at migration). The §4 bridge ("exact doc_no match
  first; content/title fallback") must tolerate a **lossy, ~87% many-to-one**
  mapping, and §5.2's "dropped, log the count" path is load-bearing, not an edge
  case.

So: §3 parses table cells (not headings), §1/§4 identity is positional, and §4's
content-fallback matcher is the common case rather than the exception. The
converter targets a single stable schema; the identity/bridge step carries the
real risk.

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

## 3. HTML reader + converter — `scripts/lib/atlas-html.mjs` (NEW)

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

## 4. HTML-era history pass — `scripts/lib/history-html-era.mjs` (NEW)

Pure, testable. **Two passes: A) thread identity *backward* from #117; B) emit
diffs *forward* from the first commit.** Kept separate from the UUID-keyed
`diffSnapshots` so neither path grows conditionals for the other.

### 4.0 Why backward

The only ground-truth identity in the whole era — the real `uuid4`s — lives at
the **newest** end (minted at #117, §2.2). So thread *from* the anchor:

- **Forward** (the naive direction) would thread positional identity from commit
  1 and only learn each doc's UUID at the very end via a lossy bridge; every
  mis-thread compounds *toward* the anchor.
- **Backward** starts *on* the anchor and carries real UUIDs back in time, so
  errors decay *away* from ground truth. It also **dissolves the forward bridge**
  entirely: at #117 every surviving doc already *is* its UUID, so there is no
  separate end-of-run resolution step.

The cost doesn't vanish — it concentrates in **one** step: the first backward
hop, #117 markdown (7682 UUID'd docs) → `7b43d159` HTML (8822 rows). That is the
*only* step that crosses the md↔html format boundary **and** is many-to-one
(~1140 rows drop, §2c). Every *other* backward hop is HTML→HTML through the same
converter, where §1's artifact-cancellation holds and **exact contentHash
matches dominate**.

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
going backward are the graveyard (deleted before #117); they get synthetic v5
UUIDs and are tagged so consumers can filter them (§7, §9).

### 4.2 The matcher — `matchNodes(older, newer)`

Reused at every backward hop **and** at the seed boundary; it is also the
slot-reuse pairing of §8 (factor into `scripts/lib/history-identity.mjs`).
Tiered, cheapest-first, to avoid an O(n²) edit-distance blow-up:

1. **Exact `contentHash`** — covers *both* "unchanged in place" and
   "moved-but-unchanged" in one tier; no position needed. Position is only a
   tie-breaker when one hash occurs twice (duplicated boilerplate).
2. **Structural key** = `section` + **full ancestor title-path** (the whole
   `<dfn>` " - " chain, near-unique — *not* the leaf doc_no/temp-name, which
   collides hundreds of times, §2c).
3. **Fuzzy, residual only** — generate candidates within the same section whose
   title is similar OR whose doc_no is adjacent, then score by the **shared-line
   ratio from `diffCore`** (NOT character-level Levenshtein — too costly on
   multi-paragraph bodies), blended with a positional-proximity prior. Assign
   **greedily above a threshold with a deterministic tie-break** (sort by
   `(score, section, title-path, contentHash)`), exactly like git's
   rename-detection similarity index + locality.

**Many-to-one is explicit policy, not an accident:** the boundary seed maps 8822
HTML rows onto 7682 md docs. When several older rows best-match one newer doc,
keep the single best pairing; the losers fall through to the synthetic-UUID path
and are logged as merged-at-boundary. Never let greedy assignment silently drop
them.

### 4.3 Synthetic UUIDs — `syntheticUuid(node)`

For graveyard docs (no real UUID). Two hard requirements:

- **Deterministic, never random.** This repo enforces reproducible builds
  (`REPRO=1 pnpm test`; no `randomUUID()` in output — see CLAUDE.md /
  deterministic-builds). Use **uuid v5** (namespaced SHA-1) over a stable tuple:
  `v5(NS_ATLAS_HTML, section | titlePath | contentHash | firstSeenSha)`. Minted
  **once** at the doc's newest occurrence and carried back unchanged — never
  recomputed per commit.
- **Auto-distinguishable + resurrection-safe.** v5's version nibble is `5`,
  so synthetic IDs are trivially told apart from the real `4`s — the `era`
  tagging and the "never confuse synthetic with real" invariant come for free.
  Including `firstSeenSha` keys identity to **one contiguous life**, so a doc
  deleted and later re-added (or two unrelated docs sharing final boilerplate)
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

## 5. Wiring into `build-history.mjs`

1. `getCommits()` / `detectFormat()` / `loadSnapshot()` — add the HTML path and
   an `"html"` branch returning `loadHtmlAt`. **But** the HTML era needs the
   backward threading pass (§4), not the uuid-keyed `diffSnapshots` — so:
2. The HTML-era events are **not recomputed here** — they are loaded from the
   frozen artifact (§7.1) and upserted into `atlas_history`. The expensive
   threading (§4) runs once, offline, via a one-shot script; `build-history`
   just seeds `newHistory` from its output. Graveyard docs (deleted before #117)
   are **kept**, not dropped: they carry deterministic synthetic v5 UUIDs (§4.3)
   and an `era`/graveyard tag (§7), so `atlas_history.doc_id` stays satisfied and
   the chat/timescale consumer can reach dead docs. Log the count
   (`N graveyard docs surfaced with synthetic UUIDs`).
3. The migration commit (#117): with HTML-era history now present, the
   `isMdMigration` re-tag (`added`→`moved`) becomes the **identity bridge**
   instead. Surviving docs already have their HTML history; at #117 we want at
   most one structural "migrated HTML→markdown" marker per doc, not a content
   diff (the converted-md vs real-md diff is pure conversion noise and must be
   suppressed). Replace the blanket re-tag with: drop `added` events for docs
   whose doc_no/content bridges to an HTML-era identity (their creation is
   already recorded in the HTML era); keep genuine new docs as `added`.
4. `commit_seq`: no change — `gitCommitSeq()` already numbers HTML-era commits.
5. PR metadata: HTML-era commits predate the markdown PR workflow. `fetchPr`
   still works for any `(#NNN)` in the commit subject; absent that, entries
   render with just date + commit link (EntryRow already handles no-PR rows).
   Beware `gh` API access — the build runs against `sky-ecosystem/next-gen-atlas`
   and HTML-era PRs may be sparse; cache misses must degrade gracefully (they
   already do).

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
  changed". Good enough; no schema change.

`era` column (now recommended, mildly load-bearing): add `era TEXT` so the UI can
label HTML-era rows ("HTML era") **and** distinguish graveyard rows (synthetic v5
UUID, §4.3) from live ones — `era IN ('html','html-graveyard')`. It lets reader
and radar hide dead docs while the chat consumer still queries them. Goes in the
**next free migration number 009** (008 is already `008_preview_trust.sql` — the
slot-reuse plan's "008" is stale, see §8). The v5-vs-v4 version nibble already
distinguishes synthetic from real, so `era` is for query/UI convenience, not
correctness.

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

## 8. Slot-reuse, folded in

`docs/plans/history-slot-reuse.md` is the UUID-era mirror of §4's renumber
detection: when a *new* doc (with a fresh UUID) takes over a doc_no that a
*different* UUID used to hold. It annotates the new doc's `added` event with
`slot:{prevId,prevTitle,movedTo?}` and (optionally) the old occupant's event
with `takenBy`. Implement it together with this plan because:
- Both need the same "match a doc to where its content/number went" helper —
  factor it once (`matchNodes` for the HTML era, §4.2; the uuid-occupant check
  for the UUID era) in a shared `scripts/lib/history-identity.mjs`.
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

`patch-notes.md`: add a user-facing bullet on the deploy date, e.g.
"Added document history for the pre-markdown (HTML) era of the atlas."

### 9.1 The other two consumers

**Radar (agent history).** Agents are docs (Agent Scope Database section, §2b)
and thread back on the same UUIDs, so an agent's history view gets the HTML era
for free once `atlas_history` is seeded — no radar-specific work beyond reusing
the same per-UUID query. Default to hiding `era='html-graveyard'` rows so dead
agents don't clutter the timeline (the `era` column makes this a one-line
filter).

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
- Graveyard docs are **in scope** for chat (their whole value is answering "what
  used to be there"), so chat queries do **not** apply the `era` graveyard
  filter that reader/radar do.

## 10. Verification

- Unit (`history-html-era.test.mjs`): renumber pairing (pure renumber;
  renumber-and-edit same commit; add vs delete that are NOT a pair; same-doc_no
  edit). Bridge resolution (exact doc_no; content-fallback; unresolved→dropped).
- Golden (`atlas-html.test.mjs`): fixed HTML snippet → expected markdown;
  convert-twice determinism; two near-identical HTML inputs → minimal line diff
  (proves artifacts cancel).
- Integration: run `pnpm build:history --full` against the real submodule; spot
  a doc known to predate #117 and confirm its panel now shows a continuous
  timeline through the migration; confirm a known renumber renders as
  `doc_no → doc_no`; confirm no doc shows a giant noise diff at the #117 row.
- `--out-json` canary path gets the HTML-era entries for free (same event
  objects), so the existing artifact/canary tests cover the JSON shape.

## 11. Effort & files

Roughly 2–3 days; the deterministic converter is the main remaining unknown.

New:
- `scripts/lib/atlas-html.mjs` — HTML read + deterministic md conversion + parse.
- `scripts/lib/history-html-era.mjs` — backward identity threading (Pass A) +
  forward diffing (Pass B), synthetic v5 UUIDs.
- `scripts/lib/history-identity.mjs` — shared `matchNodes` content-pairing helper
  (also used by slot-reuse).
- `scripts/aux/freeze-html-history.mjs` — one-shot offline runner that computes
  §4 and writes the frozen artifact; rerun only as a deliberate, reviewed act.
- `public/history-html-era.json` — frozen artifact (identity map + per-UUID
  events + diffs), checked in (§7.1).
- `src/server/migrations/009_history_slot.sql` (+ `era` column).
- Tests next to each new lib.

Changed:
- `scripts/required/build-history.mjs` — HTML path/format branch, run the
  HTML-era pass, replace `isMdMigration` re-tag with the identity bridge.
- `src/server/history-db.ts` — slot-reuse cols (per slot-reuse plan); `era` if
  added.
- `src/server/history.ts`, `src/lib/history.ts` — slot/takenBy/era fields.
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
4. **Graveyard scope** (decided: **keep** with synthetic v5 UUIDs, §4.3): open
   sub-question is whether reader/radar ever expose a "graveyard" view or only
   ever hide them; chat always includes them.
5. **PR enrichment for HTML era**: how many of the 79 commits carry `(#NNN)` and
   have fetchable PRs? Determines how rich the HTML-era summaries get.
