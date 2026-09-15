# entityLabel extraction: stop emitting sentence fragments

Status: **shipped** (branch `cursor/entitylabel-fragment-plan-223f`). The
pipeline now filters at the source and display-time `isCleanLabel` (PR #363) is
a tripwire against extractor regression, not the real gate.

Measured on the atlas at submodule `0587f18c`: fragment-shaped `entityLabel`s
went **65 → 0** (18 internal sentence breaks, 32 dangling function words, 15 bare
pronouns), over-length labels 31 → 9 (the 9 survivors are Phase 4.5a's
ICD-constructed vault names, deliberately exempt — locked decision 5). 48 labels
changed; 46 of them are a clause or a bare `Its` becoming the facet's real name
(`Wrap Proxy ETH Facet`, `PSM Facet`, `The Beacon`, `Aave v3 Facet`…) via Phase
4.5. Only 2 addresses end up with no label at all, and only one previously
*rendering* label got shorter (`The Sky.money Frontend Governance Reward payment`
→ `Frontend Governance Reward payment`) — the cost of dropping `.` from the
capture class, which is what stops the backwards walk crossing a sentence.

`src/lib/addressName.ts` and `.claude/skills/address-extraction/SKILL.md` point
here for the incident; `node scripts/aux/label-quality.mjs` is the re-runnable
scan.

## Incident

`entityLabel` is a per-address heuristic written into
`public/addresses.atlas.json` by `build-graph` Phase 2.6
(`scripts/lib/address-annotate.mjs` → `extractEntityLabel()`). It is supposed
to be a short proper-noun name (`Bonapublica`, `The Beacon`, `Spark Operations
Multisig`). For a large fraction of addresses it is a clause ripped out of the
surrounding sentence.

Reproduced on current `main` against live atlas copy in
`vendor/next-gen-atlas/content/A.2 - The-Support-Scope.md`:

| Surrounding sentence (truncated) | `extractEntityLabel` returns |
| --- | --- |
| wraps the ALM Proxy's entire native ETH balance into WETH. Its address on … is | `ALM Proxy's entire native ETH balance into WETH. It` |
| …from a Basin in exchange for Basin shares. Its address on … is | `Basin in exchange for Basin shares. It` |
| …through DAI and the Lite PSM's no-fee path. Its address on … is | `DAI and the Lite PSM's no-fee path. It` |
| …through the Pause Proxy. The Beacon's address on … is | `Sky Governance through the Pause Proxy. The Beacon` |

PR #363 (“Standardize on-chain address rendering”) did **not** fix this. It
added `isCleanLabel` / `resolveOwner` so the Addresses report Owner column,
Rewards cells, Address cards, and chat retrieval (`doc-rows.ts`) suppress
fragments. The PR summary itself called `entityLabel` “a heuristic scrape,
~17% sentence fragments.” The extractor, the table fallback, and Phase 2.6’s
longest-wins picker are unchanged since April (`e8d3baa6` / `9c38c251`).

Fragments still land in `addresses.atlas.json`, in `aliases`, in Solana PDA
owner-naming (`scripts/lib/solana-accounts.mjs` `names` map), and in Phase 4.5
(which will not overwrite a label once Phase 2.6 has set one — so a fragment
blocks a later ICD / entity / parent-title / chainlog fill).

## Two independent extractor bugs

Both fire on the `"X's address is"` pattern
(`ENTITY_PATTERNS[1]` in `address-annotate.mjs`):

```
/\b(?:the\s+)?([A-Z][A-Za-z0-9 .&''’-]{2,60}?)[''']?s?\s+address\s+(?:is|on)\b/
```

1. **The capture class includes `.` and spaces.** The non-greedy `{2,60}?`
   still walks backward across a sentence boundary to the first capital
   letter, so `WETH. Its address` becomes a 50-char clause ending in `It`.
2. **`[''']?s?` treats a bare `s` as a possessive.** `Its address` parses as
   capture `…It` + `s`. Dropping `.` from the class without fixing this still
   yields the label `Its` (and `Its` is not in the current exact-pronoun
   reject list, which is only `The|This|That|These|Those|It`).

The table path is a third source, not the one behind the four examples above:

- `LABEL_HEADER_KEYWORDS` includes `"description"`, `"details"`, `"purpose"` —
  prose columns accepted verbatim as names.
- The generic sibling-cell fallback (lines 147–151) returns the first
  non-address / non-number cell with no quality check. A 200-char Purpose
  cell becomes the label.

Phase 2.6 then **picks the longest** non-generic candidate
(`build-graph.mjs` ~184–190). Fragments beat `Bonapublica`. Leftover
candidates are stored as `aliases`, so a fragment that loses the pick still
ships.

## What a label is (and is not)

Locked by PR #363, not reopened here:

- **NAME** = `chainlogId ?? etherscanName`. Never `entityLabel`.
- **OWNER** = `entityLabel`, and only when it looks like a name.
- Prefer `null` over a fragment. A null owner falls back cleanly to no owner
  (UI) or to chainlog/Etherscan (internal `resolveLabel`). ~half the atlas
  addresses have no chainlog id and no Etherscan name — the delegate-style
  clean labels (`Bonapublica`, `BLUE`, `Cloaky`, `…Foundation's multisig`)
  are their only human string and **must survive**.

## Locked decisions

1. **Fix at the source, keep the display filter.** `extractEntityLabel` and
   the Phase 2.6 pool return only plausible names. `isCleanLabel` stays as a
   tripwire on every user-facing surface. Do not delete it in the same PR;
   rewrite its “until the pipeline defect is fixed” comment to “tripwire
   against extractor regression.”
2. **One predicate, two copies, tests that they agree.** Pipeline code is
   Node ESM (`scripts/lib/*.mjs`); the display filter is TS (`src/lib`). Do
   not take a packaging dependency from `apps/web` on `scripts/`. Put
   `isPlausibleName(label)` next to `extractEntityLabel` and keep
   `isCleanLabel`’s predicates **byte-identical** (same length bounds, same
   trailing-prose list, same sentence-break regex). A vitest that runs a
   shared fixture list through both functions is the sync gate. Do not
   introduce an NLP / LLM classifier.
3. **Length 3–48, not ~40.** `isCleanLabel` already ships 48.
   `The Aligned Delegates Buffer Multisig` is 38 characters; 48 leaves room
   for `The Sky Frontier Foundation's multisig` without inventing a second
   cap. Pipeline and display must not disagree on a name the other accepts.
4. **Null, never a consolation fragment.** If every candidate fails
   `isPlausibleName`, write `entityLabel: null` (and `aliases: []`). Do not
   fall back to the rejected pool. Phase 4.5b–e then get a chance to fill
   from entity names, parent titles, doc titles, or chainlog/Etherscan —
   that fill-in is desired. The four A.2 facet addresses above should come
   out as `Wrap Proxy ETH Facet` / `Basin Facet` / `PSM Facet` / `The Beacon`
   (title or tightened regex), not stay as clauses.
5. **Do not run the prose validator on structured 4.5 fills.**
   - 4.5a ICD-param labels and 4.5b graph entity names are constructed, not
     scraped.
   - 4.5e chainlog / Etherscan ids are identifiers (`MCD_VAT`).
   - 4.5c parent titles and 4.5d doc titles **do** go through
     `isPlausibleName` (a 90-character Core title is not an owner name).
6. **Keep longest-wins, but only among plausible names.** Once fragments are
   gone, the longest remaining candidate is still the right tie-break
   (`Spark Operations Multisig` over `Spark`). `GENERIC_LABELS` stays.
7. **Tighten the regex; don’t just post-filter.** The validator is the backstop.
   The capture class drops `.?!`. Possessive is `(?:[''']s)?` — `'s` or
   nothing, never a bare `s`. Exact-pronoun reject adds `Its` / `It's`.
8. **Table fallback is names, not prose.** Drop `description`, `details`,
   `purpose` from `LABEL_HEADER_KEYWORDS`. Every table-cell return value
   still has to pass `isPlausibleName` (covers the generic sibling fallback).
9. **No new atlas-layout knowledge.** The defect is in the annotator, not
   `atlas-source.mjs`.

## Implementation (one PR)

### 1. Predicate

In `scripts/lib/address-annotate.mjs`, export `isPlausibleName(label)`:

- empty / `< 3` / `> 48` → false
- internal sentence break `/[.?!]["')\]]?\s/` → false
- leading lowercase → false
- trailing function word: the existing `TRAILING_PROSE` list from
  `src/lib/addressName.ts` (`it|its|the|this|that|these|those|a|an|and|or|of|to|for|from|into|via|with|through|is|are|be|as|at|by|on|in`)
- exact pronoun `The|This|That|These|Those|It|Its|It's` → false

Wire it on every `extractEntityLabel` return (prose hit and both table
loops). Copy the same predicates into `isCleanLabel` if any of them differ
today (pronoun list is the likely drift).

### 2. Regex + table keywords

- Capture class: `[A-Z][A-Za-z0-9 &''’-]` (no `.`, no `?`, no `!`). Keep
  `&`, spaces, apostrophes. Upper bound can stay 60 — the predicate clips
  at 48.
- Pattern 2 possessive: `(?:[''']s)?` instead of `[''']?s?`.
- `LABEL_HEADER_KEYWORDS`: `name`, `label`, `entity`, `role`, `party`,
  `who`, `organization`, `contract`, `subject`. Not `description` /
  `details` / `purpose`.

### 3. Phase 2.6 pool

In `scripts/required/build-graph.mjs`, filter `g.labels` with
`isPlausibleName` (and existing `GENERIC_LABELS`) **before** the longest
sort. `aliases` is the rest of that filtered pool, never rejected
fragments.

### 4. Phase 4.5c / 4.5d

In `scripts/lib/graph-address-enrich.mjs`, skip the write when
`!isPlausibleName(title)`.

### 5. Tests

Add fixtures to `scripts_tests/address-annotate.test.ts` (happy path) and
`scripts_tests/address-annotate-robustness.test.ts` (formatting). Minimum:

Should return **null** (or a trimmed name, never the clause):

- the four A.2 sentences in the table above, using the real surrounding
  text + a dummy address so the test is the extractor, not the atlas SHA
- a table row whose only sibling cell is a Description/Purpose paragraph
  containing `. It`
- `"Its address on Ethereum is 0x…"` → null (not `"Its"`)

Should return **unchanged**:

- `Bonapublica`, `BLUE`, `Cloaky`, `AegisD`
- `Spark Operations Multisig` (`address of X is`)
- `The Aligned Delegates Buffer Multisig`
- `Sky Frontier Foundation` (`X's address is`, ASCII and typographic `’`)
- `The Sky Frontier Foundation's multisig` if a pattern actually produces
  it — otherwise keep it as an `isPlausibleName` / `isCleanLabel` accept
- `The Beacon` from `The Beacon's address on Ethereum Mainnet is`
- table cell under `Entity` / `Name` / `Role`

Shared-fixture test: the same good/bad strings pass/fail both
`isPlausibleName` and `isCleanLabel`.

Existing tests that currently expect a fragment (none known) would fail
loudly; the robustness suite’s “leading `The` is captured” case must still
pass.

`scripts_tests/graph-address-enrich.test.ts`: one case where a 4.5d title
with an internal `. ` is refused, and one where `Wrap Proxy ETH Facet`
still writes.

### 6. Measure, then look

After the unit tests are green:

```bash
pnpm build:index
pnpm build:graph
node scripts/aux/unlabeled-addresses.mjs
```

Add a tiny classifier next to that aux script (or a one-off in the PR
description) that prints:

- addresses with an `entityLabel`
- of those, how many fail `isPlausibleName` (target: **0**)
- null rate vs pre-change (will go up; that is the point)
- a sample of newly-null addresses, to eyeball whether 4.5 filled a better
  name or left them honestly unlabeled

`pnpm census:chains` is a sanity check (chain attribution, not labels).
`pnpm test:snap` should be a no-op unless some snapshot accidentally
inlined an `entityLabel`; if it fails, read the diff before `--update`.

Do not add a patch-notes bullet unless the Owner column visibly gains
facet/parent titles that were previously blank (fragments were already
hidden). No Features-guide change — no new control.

### 7. Docs / comments

- Rewrite the `isCleanLabel` doc-comment (pipeline defect is fixed; filter
  remains a tripwire).
- One paragraph in `.claude/skills/address-extraction/SKILL.md` under
  **Address classification**: `entityLabel` is a plausible-name or `null`,
  never a clause; `isPlausibleName` is the build-side twin of
  `isCleanLabel`.
- This plan’s status line → **shipped** with the PR number.

## Acceptance

- The four A.2 sentences no longer produce a clause. Fragment-shaped
  `entityLabel` rate on a full graph build is ~0 (no internal `. `, no
  trailing function word, no `> 48` char labels).
- Clean labels in the existing annotate tests are unchanged.
- Addresses that only had a fragment either become `null` or pick up a
  4.5 ICD / entity / parent-title / chainlog name.
- `isCleanLabel` still rejects the historical fragment strings, so a
  future extractor regression cannot reach the Owner column.
- Solana `programOwnerName` derived from `entityLabel` cannot be a
  sentence fragment.

## Out of scope

- Making `entityLabel` a display **name** again (PR #363).
- Deleting `isCleanLabel`.
- Sharing one module between `scripts/lib` and `apps/web`.
- Scoring labels with embeddings or an LLM.
- Changing `ROLE_VOCAB`, chain detection, or `expectedTokens`.
- A new report or a census baseline of label quality. The unit fixtures
  plus a 0-fail `isPlausibleName` scan of `addresses.atlas.json` are the
  gate. If a later bump reintroduces clauses, `isCleanLabel` holds the UI
  and the scan (re-run at graph-build time, even as a comment in the PR)
  is enough to notice.
)
