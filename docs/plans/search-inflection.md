# Frontend + server search: singular ↔ plural without stemming

Status: **shipped**. Query-time inflection in the reader worker and server
`runLexical`, ranked so original-term hits sit above inflection-only hits.
The MiniSearch index still stores surface forms (`processTerm` is unchanged).

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

`apps/web/src/workers/search.test.ts` still encodes the index-level
constraint (MiniSearch stores surface forms, no stemmer):

- `"misalignme → misalignment docs (10-char prefix, was broken with stemmer)"`
- `"regression: no stemmer in the index — MiniSearch stores surface forms"`
  (`agents` against the raw index still only returns docs containing `agents`)

Query-time expansion in the worker / `runLexical` *does* return `agent`-only
docs for an `agents` query; those hits sit in the inflection-only bucket
below every original-term hit.

A stemmer operates on a *stem*. `subsidy` and `subsidies` share `subsidi`, but
so do `subsidize` / `subsidizing` / `subsidization`. That is the broadening we
already rejected. Inflection (singular ↔ plural of the *same lemma*) is a
narrower transform and is what this plan does.

Do **not** change `processTerm`, `MINISEARCH_OPTIONS`, or rebuild
`search-index.json` for this. Returning both surface forms from `processTerm`
would write them into the same posting list and make exact vs inflected
indistinguishable. `MiniSearch.loadJSON` also requires options identical to
the index producer. Inflection is a query helper both the reader and
`runLexical` share; the index stays a bag of surface forms.

## What already works (and must keep working)

Broad mode searches with `prefix: true`. On the token:

- `agent` already matches `agents` (`agents`.startsWith(`agent`))
- `address` already matches `addresses`
- `child` already matches `children`
- `sky` already matches `skies` (accidental prefix; leave it)

So regular `+s` / `+es` singular→plural is **already handled** by prefix
search. The reverse (`agents` → `agent`) is the hole prefix cannot see; the
helper adds that counterpart and ranks those hits after original-term matches.

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
expandTerm("subsidy")  → extra "subsidies"
expandTerm("subsidies") → extra "subsidy"
expandTerm("agent")    → no extra           // prefix already covers agents
expandTerm("agents")   → extra "agent"      // prefix cannot see the shorter form
expandTerm("subsid")   → no extra           // incomplete word, do not inflect
expandTerm("USDS")     → no extra           // ticker / all-caps
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
   - the counterpart is **not a prefix-extension of the original**
     (`other.startsWith(lower)`). Adding `agents` to an `agent` query would
     double-count docs MiniSearch already returns via `prefix: true`. The
     shorter form (`agents` → `agent`) is still added, because prefix cannot
     see it.
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

Added to the root `package.json` and `apps/web` (the worker bundle). The
helper is `src/lib/searchInflect.ts`, imported by the reader worker, server
`runLexical`, and `matchParticipants`.

`@types/pluralize` if the package's own types are missing.

Atlas-specific uncountables we should register on day one, even if the
prefix-gate would already skip some of them: `sky`, `usds`, `susds`, `dai`,
`mkr`. Cheap, and they are proper names in this corpus.

## Call sites

### 1. MiniSearch — `apps/web/src/workers/search.worker.ts`

After the existing query parse (phrases stripped, `in:`/`type:`/`title:`
extracted, exclusions pulled, tickers promoted to phrases), expand remaining
free words and search original + extra terms in one OR query. Partition so
hits that matched an original term sit above inflection-only hits.

Highlight lists (`titleHighlightTerms` / `contentHighlightTerms`) get the
same expansion so the snippet marks the form that actually appeared.

Phrase / strict skip expansion (literal substring contract). Field-scoped
`title:` / `content:` / `doc_no:` terms expand inside that field.

### 2. Server lexical — `src/server/retrieval/search.ts` `runLexical`

Same expand + partition, then `slice(0, k)`. Used by chat `atlas_search` and
`atlas_query`. Semantic / RRF unchanged; lexical rank still feeds RRF.

### 3. Entity overlay — `matchParticipants` (`apps/web/src/lib/search.ts`)

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

- Stemming / lemmatizing, including "stem only at query time"
- Indexing both forms in `processTerm` / rebuilding `search-index.json`
- In-report row filters (`staleDatesSearch`, `rewardsSearch`, …)
- Graph-worker `search-entities` message (follow-up below)

## Tests

Unit, no atlas build:

- `searchInflect.test.ts` — the table in "Approach" plus `entity`/`entities`,
  `person`/`people`, `day`/`days` (prefix-gated, no expansion), `sky` stays
  `sky`, `USDS` stays, incomplete `subsid` stays.
- `matchParticipants` — `subsidy` hits a participant named `Stability
  Subsidies`; `spark` is unchanged.

Against `public/search-index.json` (`search.test.ts`): the index-level
stemmer regressions stay (`misalignme` still hits; raw MiniSearch `agents`
still only returns docs containing `agents`).

Worker / `runLexical` fixture tests (tiny in-memory MiniSearch, no live atlas
prose):

- `subsidy` lists a subsidies-only doc, after any subsidy-term docs.
- `agents` may include `agent`-only hits, ranked below `agents` hits.
- Phrase `"subsidy"` / strict `'subsidy'` do not expand.
- `runLexical` slices `k` after the partition, so a full A bucket omits B.

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
