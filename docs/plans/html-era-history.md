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

Post-#117 docs carry a stable `<!-- UUID: … -->`. HTML-era docs do **not** —
their only identity is the **doc number** (e.g. `A.2.2.8.1`), and doc numbers
were renumbered freely between commits. So:

1. **Within the HTML era**, the per-commit snapshot must be keyed by `doc_no`,
   not UUID (there is no UUID to key on).
2. **A pure renumber** (`A.2.3` → `A.2.4`, same prose) must NOT read as
   `removed(A.2.3)` + `added(A.2.4)`. Per the request: when a doc_no's entire
   body disappears in a commit and the same body appears under a different
   doc_no, classify it as **"doc number changed"** (a `moved` event) and carry
   the identity forward. This is content-tracking, exactly analogous to git's
   rename detection.
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

## 2. Reconnaissance REQUIRED before coding

This environment cannot reach `sky-ecosystem/next-gen-atlas` (egress policy
blocks the submodule clone), so the HTML structure below is **inferred from the
codebase, not verified against the repo.** The first implementation step is to
populate the submodule (`pnpm pull-atlas`) and answer these, because they decide
the shape of the converter in §3:

```bash
cd vendor/next-gen-atlas
# 1. Confirm the HTML file path + enumerate the 79 pre-#117 commits.
#    Compare URL in NodeHistory.tsx is 4e931dfd…22cc27b5, so:
#      22cc27b5 = the markdown-migration commit (first UUID-bearing commit)
#      4e931dfd = the last HTML-only commit
git log --reverse --format='%H %aI %s' 4e931dfd -- '*.html' | head
git show 22cc27b5 --stat | grep -iE '\.html|\.md'   # what the migration deleted/added

# 2. Inspect the HTML structure at the last HTML commit: how are heading,
#    doc_no, title, [type] encoded? Is it one file? Headings as <h1>..<h6>?
#    data- attributes? Is the doc_no in the text or an attribute?
git show 4e931dfd:'<path>.html' | head -200

# 3. Size the migration bridge: how many #117 doc_nos exactly match
#    4e931dfd doc_nos? (drives how hard the content-fallback matcher must work)
```

Record the answers in this doc before writing `atlas-html.mjs`. The three open
unknowns are: **(a)** exact HTML file path, **(b)** how doc_no/title/type are
encoded in the HTML heading, **(c)** doc_no stability across the migration
commit itself.

## 3. HTML reader + converter — `scripts/lib/atlas-html.mjs` (NEW)

The single repo-structure-dependent module. Mirrors the contract of
`parseMonolithic` / `loadAtomizedAt` in `build-history.mjs`: given a commit
hash, return `Map<docNo, {doc_no,title,type,content,contentHash}>` — but keyed
by **doc_no** (no UUID exists).

```
loadHtmlAt(hash):
  raw = git show <hash>:<htmlPath>
  return parseHtmlToNodes(raw)

parseHtmlToNodes(html):
  - Parse with a deterministic HTML parser. We already ship jsdom (dev dep);
    prefer a lightweight streaming parse (e.g. node-html-parser) added as a
    build-only dep, or hand-roll over the heading structure if it's regular.
  - Split into documents on heading boundaries (the HTML analogue of HEADING_RE).
    Extract (doc_no, title, type) per the encoding found in §2.
  - Convert each document BODY html → markdown with a deterministic converter
    (turndown, pinned config: ATX headings, '-' bullets, fenced code, no
    auto-trailing-whitespace). Determinism > fidelity (§1).
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

Pure, testable. Does the doc_no-keyed forward walk with renumber detection and
UUID resolution. Kept separate from the UUID-keyed `diffSnapshots` so neither
path grows conditionals for the other.

```
buildHtmlEraHistory(htmlCommits, migrationDocNoToUuid):
  identities = []        // each: { uuid|null, events: [...] }
  active = Map<docNo, identity>     // doc_no currently occupied by an identity
  prev = new Map()       // docNo → node (previous commit snapshot)

  for commit in htmlCommits (oldest→newest):
    curr = loadHtmlAt(commit.hash)        // docNo → node
    { added, modified, removed } = diffByDocNo(prev, curr)

    // ── renumber detection (the requested behaviour) ──────────────────────
    // Pair each removed doc_no with an added doc_no carrying the same content.
    // Exact contentHash first; then title-equal + high line-overlap (handles
    // renumber-and-edit in one commit). Each pairing is a "doc number changed".
    renumbers = pairByContent(removed, added)   // [{from, to, node}]
    for {from, to, node} in renumbers:
      id = active.get(from)
      active.delete(from); active.set(to, id)
      id.events.push({ commit, changeType:'moved', movedFrom:from, movedTo:to,
                       // if content ALSO changed, emit a second 'modified' too
                     })
      drop from `removed`, drop to `added`

    for node in added (genuinely new):
      id = { uuid:null, events:[] }; active.set(node.doc_no, id)
      id.events.push({ commit, changeType:'added', diff: fullBodyAsAdds(node) })
    for node in modified:
      id = active.get(node.doc_no)
      id.events.push({ commit, changeType:'modified',
                       diff: lineDiff(prev.content, curr.content),
                       changeKind: classifyDiff(diff) })
    for node in removed (genuinely deleted):
      id = active.get(node.doc_no); active.delete(node.doc_no)
      id.events.push({ commit, changeType:'removed', diff: fullBodyAsDels(node) })

    prev = curr

  // ── bridge to UUID era ────────────────────────────────────────────────
  // At the migration boundary, each still-active identity's final doc_no maps
  // to the #117 doc_no → UUID. Exact doc_no match first; content/title fallback
  // for docs renumbered AT the migration.
  for [docNo, id] in active:
    id.uuid = migrationDocNoToUuid.get(docNo)
             ?? contentMatchUuid(id.lastNode, migrationSnapshot)

  return identities
```

Reuses the existing shared diff core (`src/lib/diffCore.ts` `lineDiff`) and
`classifyDiff` from `history-classify.mjs` — same diff bytes and same
significance classes as the markdown era, so HTML-era rows render identically.

`pairByContent` is the same idea as the slot-reuse pairing in §8, just
content-keyed (no UUIDs to compare) and run on `removed×added` rather than
`added`-at-an-occupied-slot. Factor the shared "match a body to its new home"
helper so both eras call it.

## 5. Wiring into `build-history.mjs`

1. `getCommits()` / `detectFormat()` / `loadSnapshot()` — add the HTML path and
   an `"html"` branch returning `loadHtmlAt`. **But** the HTML era needs the
   doc_no-keyed pass, not the uuid-keyed `diffSnapshots` — so:
2. Before the existing main loop, if the walk range includes pre-#117 commits,
   run `buildHtmlEraHistory(...)` once, resolve each identity to a UUID, and
   seed `newHistory` (keyed by UUID) with its events. Identities that resolve to
   no UUID (deleted before #117) are **dropped** — there is no UUID timeline to
   attach them to, and `atlas_history.doc_id` is `UUID NOT NULL`. Log the count
   so silent loss is visible (`N HTML-era docs deleted before migration, not
   surfaced`). (Optional future: a synthetic-UUID namespace or a separate
   `atlas_history_html` table if we ever want to show the graveyard — out of
   scope here.)
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

Optional polish (recommend, 1 column): add `era TEXT` (or reuse a boolean
`pre_md`) so the UI can label HTML-era rows ("HTML era") and so analytics can
filter. If added, it goes in the **next free migration number 009** (008 is
already `008_preview_trust.sql` — the slot-reuse plan's "008" is stale, see §8).

Backfill: `build-history` is incremental (cursor = `MAX(commit_seq)`). HTML-era
commits are below every existing row's seq, so a normal incremental run will
**not** reach them. A one-time `pnpm build:history --full` re-walks from the
first commit and fills them; `ON CONFLICT … DO UPDATE` makes it idempotent. Run
once on the worker after deploy (same playbook as the metrics backfill already
noted in CLAUDE.md "Pending work").

## 8. Slot-reuse, folded in

`docs/plans/history-slot-reuse.md` is the UUID-era mirror of §4's renumber
detection: when a *new* doc (with a fresh UUID) takes over a doc_no that a
*different* UUID used to hold. It annotates the new doc's `added` event with
`slot:{prevId,prevTitle,movedTo?}` and (optionally) the old occupant's event
with `takenBy`. Implement it together with this plan because:
- Both need the same "match a doc to where its content/number went" helper —
  factor it once (`pairByContent` for HTML era, the uuid-occupant check for the
  UUID era) in a shared `scripts/lib/history-identity.mjs`.
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

Roughly 2–3 days, gated on §2 reconnaissance (the converter is the only real
unknown).

New:
- `scripts/lib/atlas-html.mjs` — HTML read + deterministic md conversion + parse.
- `scripts/lib/history-html-era.mjs` — doc_no-keyed walk, renumber, bridge.
- `scripts/lib/history-identity.mjs` — shared content-pairing helper (also used
  by slot-reuse).
- `src/server/migrations/009_history_slot.sql` (+ optional `era` column).
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

## 12. Open decisions (need a human / the repo)

1. **HTML structure** (§2) — blocks `atlas-html.mjs`. Must inspect the real repo.
2. **Converter**: turndown-pinned (recommended) vs hand-rolled.
3. **Deleted-before-#117 docs**: drop (recommended, simplest) vs synthetic-UUID
   namespace vs separate table. Affects whether the "graveyard" is ever viewable.
4. **`era` column**: add for UI labelling (recommended) vs reuse moved_from/to
   and skip the schema change.
5. **PR enrichment for HTML era**: how many of the 79 commits carry `(#NNN)` and
   have fetchable PRs? Determines how rich the HTML-era summaries get.
