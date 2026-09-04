# Frontend search: singular ↔ plural without stemming

Status: **proposed**. Frontend reader search only (`search.worker.ts` MiniSearch
path + the relations.json entity overlay). Not chat lexical search, not MCP,
not in-report row filters.

Origin: users searching a singular like `subsidy` miss docs that only say
`subsidies` (and the reverse). We previously shipped a Porter stemmer and
removed it because it broadened results too far.

## Constraint: do not bring the stemmer back

MiniSearch currently has **no stemmer**. `processTerm` only strips edge
punctuation and lowercases (`src/lib/searchOptions.ts`). That is load-bearing.

The stemmer was removed because it collapsed *derivational* forms, not just
number:

| Query | Stemmer matched (too broad) | What the user meant |
| --- | --- | --- |
| `align` | alignment, aligning, misalignment, … | the word align |
| `agent` | agency, agents, … | Agent |
| `misalignme` | **nothing** (prefix search broke) | misalignment |

`apps/web/src/workers/search.test.ts` still encodes this:

- `"misalignme → misalignment docs (10-char prefix, was broken with stemmer)"`
- `"regression: no stemmer — plurals stay distinct from singulars"` (`agents`
  must not return docs that only contain `agent`)

A stemmer operates on a *stem*. `subsidy` and `subsidies` share `subsidi`, but
so do `subsidize` / `subsidizing` / `subsidization`. That is the broadening we
already rejected. Inflection (singular ↔ plural of the *same lemma*) is a
narrower transform and is what this plan does.

Do **not** change `processTerm`, `MINISEARCH_OPTIONS`, or rebuild
`search-index.json` for this. `MiniSearch.loadJSON` requires options identical
to the index producer; touching `processTerm` would also change the Bun
server's lexical search, which is out of scope.

## What already works (and must keep working)

Broad mode searches with `prefix: true`. On the token:

- `agent` already matches `agents` (`agents`.startsWith(`agent`))
- `address` already matches `addresses`
- `child` already matches `children`
- `sky` already matches `skies` (accidental prefix; leave it)

So regular `+s` / `+es` singular→plural is **already handled**. The stemmer
regression for `agents` ↛ `agent` is the reverse direction of a prefix-covered
pair, and we keep that behaviour (see rule below).

Partial-word prefixes must keep working: `govern`, `alignme`, `misalignme`,
`delegat`. Inflecting those into junk (`subsid` → `subsids`) is how a naive
`+s` rule goes wrong; the expansion rule below refuses that class.

## The actual hole

Prefix cannot connect a pair when neither form is a prefix of the other:

| Query | Misses | Pattern |
| --- | --- | --- |
| `subsidy` | subsidies | `-y` → `-ies` |
| `entity` | entities | same |
| `treasury` | treasuries | same |
| `proxy` | proxies | `-y` → `-ies` after a consonant |
| `leaf` / `life` | leaves / lives | `-f`/`-fe` → `-ves` |
| `person` | people | irregular |

`subsidy` ↛ `subsidies` is the motivating case: `subsidies`.startsWith(`subsidy`)
is false.

## Approach: query-time expansion, not index-time

Rewrite the query (and the entity-name haystack test) so each eligible free
term also searches its singular/plural counterpart. The index stays a bag of
surface forms. Prefix search, fuzzy `~N`, tickers-as-phrases, and
`loadJSON` parity are untouched.

```
expandTerm("subsidy")  → ["subsidy", "subsidies"]
expandTerm("subsidies") → ["subsidies", "subsidy"]
expandTerm("agent")    → ["agent"]          // prefix already covers agents
expandTerm("agents")   → ["agents"]         // keep the stemmer regression
expandTerm("subsid")   → ["subsid"]         // incomplete word, do not inflect
expandTerm("USDS")     → ["USDS"]           // ticker / all-caps
```

MiniSearch is already `combineWith: "OR"`, so injecting the counterpart as an
extra query token is enough. Highlighting must include the counterpart so a
`subsidy` search marks `subsidies` in the snippet.

### Expansion rule (the whole design)

A shared helper, e.g. `src/lib/searchInflect.ts` (pure, no DOM, worker-safe):

1. Skip tokens that are not inflectable English nouns: length &lt; 3, digits,
   ALL-CAPS / ticker-shaped (`TICKER_RE` already in the search worker),
   chainlog ids, doc numbers, UUID fragments.
2. Ask the library for `singular(term)` and `plural(term)`.
3. Keep a candidate only when **all** of:
   - it differs from the original (case-insensitive)
   - round-trip holds: `singular(plural(w)) === singular(w)`
   - **neither form is a prefix of the other** — this is the anti-stemmer
     gate. If prefix search already connects the pair, we do not OR-expand.
     That preserves `agents`-only and avoids doubling hits MiniSearch would
     have returned anyway.
4. Phrase (`"…"`) and strict (`'…'`) modes do not expand. Quoted phrases stay
   literal substring matches. Field-scoped terms (`title:subsidy`) *do*
   expand inside that field — same helper, applied to the scoped token.

The prefix-of-each-other gate is what keeps this from becoming "stemmer-lite".
We only spend an extra OR term on the morphological gap prefix cannot see.

## Library: `pluralize`

This is the case a library earns its keep. A hand-rolled `y`/`ies` regex will
get `day`/`days`, `sky`/`skies`, `USDS`, and irregulars wrong, and we will
keep patching it. We need both directions (`plural` *and* `singular`) plus
the irregular table.

**`pluralize`** (blakeembrey/plurals, ~2 KB, MIT):

- `pluralize.plural` / `.singular` / `.isPlural` / `.isSingular`
- irregulars (`person`/`people`) and uncountables (`information`)
- `addUncountableRule` / `addIrregularRule` for atlas vocabulary if a
  misfire shows up
- no NLP, no Node APIs — Vite will bundle it into the search worker

Not `natural`, `compromise`, or MiniSearch's own Porter stemmer — those are
stemmers/lemmatizers and re-open the broadening bug. Not `inflected` (Rails
port): larger, and we only need noun number.

Add it to the **root** `package.json` (shared with the web app via the
workspace) *or* `apps/web` if we keep the helper frontend-only. Prefer
`src/lib/searchInflect.ts` imported by the worker so a later chat reuse does
not fork the rules — but the **call sites** for this work are frontend-only.

`@types/pluralize` if the package's own types are missing.

Atlas-specific uncountables we should register on day one, even if the
prefix-gate would already skip some of them: `sky`, `usds`, `susds`, `dai`,
`mkr`. Cheap, and they are proper names in this corpus.

## Call sites

### 1. MiniSearch — `apps/web/src/workers/search.worker.ts`

After the existing query parse (phrases stripped, `in:`/`type:`/`title:`
extracted, exclusions pulled, tickers promoted to phrases), map each remaining
free word through `expandTerm` and search the unique set.

Highlight lists (`titleHighlightTerms` / `contentHighlightTerms`) get the
same expansion so the snippet marks the form that actually appeared.

No change to `docFilter`, phrase post-filter, or the UUID / doc_no / chainlog
fast-paths.

### 2. Entity overlay — `matchParticipants` (`apps/web/src/lib/search.ts`)

Today this is exact / prefix / substring on the **whole** `entity.name`
against the raw query, run on the main thread over `loadGraph()`'s
`participants` (itself a filter of `relations.json`). Same hole: `subsidy`
does not substring-match `Stability Subsidies`.

Apply the same helper **per query token** against **per name token** (plus
keep the existing whole-string exact/prefix/substring scores). A hit if every
query token matches some name token via `===`, `startsWith`, `includes`, or
an inflection counterpart.

Scoring stays 3 / 2 / 1 for exact / prefix / substring of the original query
string; an inflection-only hit scores as substring (1) so a real prefix still
wins.

This is the relations.json half of the request. It does not require moving
the work into the graph worker, but that move is a good follow-up (below).

## Follow-up (separate PR): entity search in the graph worker

`SearchResults` currently `loadGraph()`s the full relations payload on the
main thread *only* to run `matchParticipants` + `buildParticipantLinks`. The
graph worker already fetched `relations.json` and holds `entityById`.

A `search-entities` message (`{ type, id, q }` → `{ hits: { participant,
score, href }[] }`) would:

- drop the duplicate main-thread parse for the search page
- keep inflection next to the entity roster
- reuse `buildParticipantLinks` as a pure function imported by the worker

Do **not** block inflection on this. The overlay is ~a few thousand names;
the correctness bug is the matcher, not the thread. Worker-move needs its
own request-id plumbing (the search worker already has this; the graph
worker does not).

## Out of scope

- Chat / MCP `atlas_search` (different ranking, already has glossary
  naive-`s` in `prefetch.ts`)
- In-report search (`staleDatesSearch`, `rewardsSearch`, …)
- Changing MiniSearch `processTerm` or the committed-artifact contract
- Re-enabling Porter / any stemmer, including "stem only at query time"
- Indexing both surface forms (would force an index rebuild *and* change
  server `loadJSON` options)

## Tests

Unit, no atlas build:

- `searchInflect.test.ts` — the table in "Approach" plus `entity`/`entities`,
  `person`/`people`, `day`/`days` (prefix-gated, no expansion), `sky` stays
  `sky`, `USDS` stays, incomplete `subsid` stays.
- `matchParticipants` — `subsidy` hits a participant named `Stability
  Subsidies`; `spark` is unchanged.

Against `public/search-index.json` (`search.test.ts`):

- `subsidy` returns at least one doc whose text contains `subsidies` and not
  `subsidy` (the motivating miss).
- Keep the stemmer regressions: `misalignme` still hits; `agents` still does
  not return `agent`-only docs.
- Phrase `"subsidy"` does not expand.

If a fixture doc is easier than depending on live atlas prose for the
motivating case, add a worker-level unit test with a tiny in-memory
MiniSearch rather than coupling to `docs.json`.

## User-visible copy

One Features-guide line under Search / Query language, and a SearchHints row
(`subsidy` — also matches `subsidies`). `patch-notes.md` when it ships, not
in the implementation-prep PR. Phrase/strict stay literal, so the hint must
say this is **broad** mode.

## Implementation order

1. Add `pluralize`, write `searchInflect.ts` + table tests, prove the
   expansion rule in isolation (including the prefix-gate).
2. Wire it into `search.worker.ts` (query + highlight). Flip/extend the
   MiniSearch integration tests.
3. Wire the same helper into `matchParticipants`.
4. Features guide + SearchHints + patch notes.
5. (Later) `search-entities` on the graph worker.
