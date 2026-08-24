# Chat class completeness — answers that are not in top-k

Status: SHIPPED 2026-08-24 (PR #314). Incident 2026-08-24. Canonical live chat
behavior is [`docs/chat-system.md`](../chat-system.md) §6.25; this file keeps
the incident write-up and locked decisions.

## Incident

Question: *“What is the oldest rate limit id in the atlas.”*

The assistant searched, took the first hits titled “Rate Limit”, ran history on
that handful, and reported three IDs first-seen **2026-07-10**. A later
user-supplied UUID (`8414b48b-932e-430e-a236-727807fd73ba`) was first-seen
**2025-11-07**, with oldest non-move edit **2026-04-09**. The first answer even
hedged *“among those queried”* — true of the subset, so the verifier had
nothing to contradict. A rewrite recovery could not enlarge the set: it is
capped at one iteration and told to use *only evidence already gathered*.

The follow-up *“first look for any rate limit ids then find the one that has
the oldest non-move edit”* is the procedure the tools should have forced on
turn one. “Stopped before an answer was ready.” on that turn is staged-mode
empty-done (user stop or empty terminal `done`), not this bug.

## The failure class

Search (`atlas_search`, `atlas_query` with `q`) is **ranked**. Default `k=10`,
hard cap `50`. That is the right tool for “docs about X.” It is the wrong tool
for any question whose correct answer is a **property of a set**:

| Shape | Example | Why top-k lies |
| --- | --- | --- |
| Superlative over a class | oldest / newest / first / last Rate Limit | the extreme is often *not* the most BM25-relevant |
| Exhaustive listing | all rate-limit IDs; how many | a page is not a census |
| Extremum of a parameter | which instance has the highest cap | search ranks prose, not the numeric field |
| Needle with a rare exact title | a specific `LIMIT_*` leaf | it may sit on page 2 of “rate limit” |

Raising `k` is not the fix. A bigger page is still a page. The model will still
stop, and `chatMaxIterations` is 4.

Two tool gaps made the incident inevitable even with a better prompt:

1. **No class listing by title.** `atlas_filter` is type / `doc_no` / ancestor /
   depth. Rate Limit leaves are titled `"Rate Limit"` (singular). They are not
   a document type. The title-templates census tracks `"Rate Limits"` (plural)
   only. `type: "Core"` is thousands of rows, not this class.
2. **`atlas_first_seen` only works once you already have ids.** It is a batch
   lookup (≤50 slugs/UUIDs) of the earliest `added` row. The incident never
   had the class in hand — it passed search hits in. `atlas_history` is one
   doc. `atlas_recent_changes` is newest-first, last 30 days by default.

The prompt currently says most questions need one `atlas_query` and to answer
once evidence exists. That is correct for lookup. It is the wrong pressure for
a superlative.

## Locked decisions

1. **Search never answers membership or extrema.** Exact-title / type /
   `doc_no` classes are listed (or reduced in SQL). Ranked retrieval is for
   “about”, not “every” or “the oldest.”
2. **Do not raise `k`.** Do not add a Rate Limits `atlas_report_*`. A per-title
   report only fixes this family; the class is “any named set.”
3. **Completeness is a hard fail, sibling to absence.** Hedging “among the
   documents I retrieved” still fails a question that asked about the atlas.
4. **Recovery must `requery`, not `rewrite`.** `rewrite` is `maxIterations: 1`
   and “only evidence already gathered.” An incomplete set cannot be repaired
   in prose. `requery` already exists (`revisionSteer`, two iterations).
5. **The listing envelope must tell the truth about the class size.** Today
   `atlas_filter` `break`s at `limit`, then sorts the fragment, and only sets
   `truncated` when `fitToBudget` clips. Hitting `limit` with a full page
   looks complete. Collect matches → sort → page; always return
   `{ total, count, offset, has_more, truncated? }`.
6. **Same tools on chat and MCP.** They share `tool-registry.ts`. No chat-only
   shortcut.

## Phase 1 — list a class (unblocks everything else)

`atlas_filter` in `tools-graph.ts` (registry shape in `tool-registry.ts`).

Add:

- `title` — exact match, case-sensitive to atlas titles (`"Rate Limit"`).
- `title_prefix` — prefix match for families like `"Rate Limit"`.
- `offset` — same pagination as `atlas_entities` / `atlas_edges`.
- Default `include_content: false` when the caller is listing (keep the
  current default only if changing it breaks existing tests; otherwise the
  listing path must be slim or 200 rows will budget-truncate and look like a
  short class).

Fix the scan:

- Filter the whole scope; do **not** `break` at `limit`.
- Sort by `doc_no`.
- Slice `[offset, offset+limit]`.
- `total` is the match count **before** the slice. `has_more` is
  `offset + count < total`. Byte-budget clip still sets `truncated` *and*
  must not lie about `total`.

At least one filter remains required (title counts). Tests: exact `"Rate Limit"`
returns `total` equal to a dumb `docs.filter(d => d.title === "Rate Limit")`
scan; a `limit` smaller than `total` sets `has_more` and does not change
`total`; sort order is stable across pages.

Prompt (`system-prompt.ts` Tools section), next to the existing “resolve the
property for every one you name” rule:

> Superlatives and exhaustive questions (`oldest`, `earliest`, `newest`, `all`,
> `every`, `how many`) require a **complete class listing** first
> (`atlas_filter` by `title` / `title_prefix` / `type` / `doc_no_pattern`).
> `atlas_search` / `atlas_query` `q` are ranked and are not a census. If the
> listing is `has_more` or `truncated`, you may not claim oldest / first / all
> — page or narrow until `has_more` is false, or say the set is incomplete.
> “Among the documents I retrieved” is not an answer to a question about the
> atlas.

Soften the “answer immediately once you have the evidence” sentence so it does
not apply to those shapes. Routing (`model-router.ts`): add
`oldest|earliest|newest|latest|first-seen` as a STRONG `extremum` signal.
Do **not** treat routing as the fix — luna will still search-and-stop without
the listing tool.

## Phase 2 — class mode on `atlas_first_seen` (no new tool)

Do **not** add `atlas_history_extremum`. The model already knows
`atlas_first_seen` for “when / oldest / since when.” A second history tool
with a new name is a tool-choice miss waiting to happen: the incident path
would keep calling `atlas_first_seen` on ten search ids. Widen the tool that
question already wants.

`atlas_first_seen` today (`src/server/history/first-seen.ts`): `ids` (1–50) →
one row per requested id → earliest `change_type = 'added'`. Keep that mode
byte-identical. Add a **second exclusive mode**.

**XOR.** Either `ids` (batch, cap 50, current shape) **or** a class selector
(`title`, `title_prefix`, `type`, `doc_no_pattern`, `ancestor_id`, `entity` —
same fields as Phase 1). Both, or neither, is an error. Class mode resolves
UUIDs in process from `Indexes`, then one SQL over `atlas_history`. No 50 cap
on the class: the reduction is the point.

**Still a first-seen: `min` only, default `added`.** Do not add `max` /
“newest” here — that is last-seen and would make the tool name a lie. Newest
stays a later change, or a listing + sort, not this tool.

**`event` (optional, default `added`):**

- `added` — today’s query (earliest `added` row, including seam / undated
  notes). This is “oldest rate limit id” as first-seen.
- `modified` — earliest `change_type = 'content'` (user-facing “non-move
  edit”). This is the incident follow-up. Store vocab stays `content`; expose
  `modified` like the other history tools. First *edit* is still a first-seen.

Do not add `any_non_move` or `max` in this pass.

**Class-mode return** is a reduction, not 400 per-id rows (that re-blows the
byte budget and looks like a page):

```
{
  class_total: number,
  class_with_history: number,
  event: "added" | "modified",
  oldest: [{ uuid, doc_no, title, date, source, pr_number, pr_title }],
  undated: [{ uuid, doc_no, note }],
}
```

`oldest` is every tie at the minimum date. Cap that array only with
`truncated` on `oldest`, never by dropping extras silently. Ids-mode `results`
is unchanged.

`whenToUse` grows by one sentence: for a named class (“oldest Rate Limit”),
pass `title` / `type` / … — do **not** pass ids you got from search. Cite as
history-derived, same as today.

Fixture (DB suite): `title: "Rate Limit", event: "modified"` must return a
date older than 2026-07-10 and include `8414b48b-…` (or skip when history is
empty). Ids-mode tests must stay green with no shape change.

Phase 2 does **not** replace Phase 1. Listing is still required for “all” /
“how many.” Class-mode first_seen is the reduction so “oldest” does not need
N history calls inside a 4-round budget.

## Phase 3 — completeness contract (make the harness notice)

New module `src/server/chat/verify/completeness.ts`, same three-outcome shape
as `absence.ts` (refuted / grounded / unverified), applied to answers for
questions that match an **exhaustive/extremum** detector.

**Question detector** (deterministic, shared with routing if the regex is the
same file): `oldest|earliest|newest|latest|first-seen|\ball\b|\bevery\b|how many`.
False fires on small talk are fine — the contract no-ops unless the *answer*
asserts a unique extreme or a complete set.

**Answer asserts completeness** when it names a unique oldest/newest, or says
“the rate limits are …”, or “all N.” Hedging “among those queried / retrieved /
I found” **still counts** — that hedge is the incident’s verifier-escape.

**Grounded** only if this turn’s tool evidence includes either:

- an `atlas_first_seen` **class-mode** result (title/type/…, not `ids`) whose
  `class_total` is present, or
- an `atlas_filter` listing with `has_more !== true` and `truncated !== true`
  for the same class.

**Refuted** if an extremum/listing in evidence disagrees with the claimed
winner or count (the listing/extremum is the table; treat like param
mismatches).

**Unverified** otherwise → hard `fail` on exhaustive questions (absence’s
unverified is softer; here the question *required* a census). That fail must
steer the advisor to **`requery`**, not `rewrite`. Extend `describeCheckFailures`
with one sentence the recovery prompt already understands: *the class was not
listed to completion; call `atlas_filter` or `atlas_first_seen` with a title/type
filter (not search ids) before answering.*

Do not ask the claim-table verifier to notice missing documents. It only sees
retrieved evidence; an incomplete retrieve looks well-cited. This contract is
about **which tools ran**, not about quoting.

Tests (mutation-check like the rest of this PR):

- Incident-shaped answer + only `atlas_search` evidence → fail, requery.
- Same answer + untruncated `atlas_filter` title listing whose `total` matches
  the named set → pass (listing questions).
- Extremum answer + class-mode `atlas_first_seen` whose `oldest` includes the
  claimed UUID → pass.
- Extremum answer + ids-mode `atlas_first_seen` on a search-sized batch → fail
  (that is the incident).
- “Among those queried” hedge + search evidence → still fail.

## Phase 4 — eval so it cannot regress to search-and-stop

New labeled set `scripts/eval/eval-completeness-queries.ts` +
`pnpm eval:completeness` (sibling to `eval:complexity`). Every positive is a
question whose answer is **not** in a typical top-10 “rate limit” / “oldest”
search: the incident query and paraphrases; “all rate limit ids”; “oldest
non-move edit among Rate Limit docs”; one exact-title needle known to rank
poorly.

Score **tool choice**, not just the prose:

- Fail if the first membership/extremum call is `atlas_search` / `atlas_query`
  with only `q`.
- Pass if `atlas_filter` (title) or class-mode `atlas_first_seen` ran before
  the answer, and a listing used for “all” was not `has_more`.
- Fail if `atlas_first_seen` ran only with `ids` taken from a prior search.

Run against the default and strong chains when a key is present; the tool-choice
arm can run on traces without a judge. Add the incident query to
`eval-bakeoff-queries.ts` with an expect that names the 2025-11-07 UUID class
(or “older than 2026-07-10”) so a completeness miss is a bakeoff miss.

## Out of scope

- A Rate Limits report, or expanding the title-templates census to `"Rate Limit"`
  as a substitute for a general listing tool.
- Raising `atlas_query` / `atlas_search` `k`.
- Letting `rewrite` grow the evidence bag.
- Teaching the figures slice to invent missing IDs.
- Staged-delivery empty-done copy (“Stopped before an answer was ready.”) —
  unrelated; see `docs/chat-system.md` §8.

## Order

1. Phase 1 (listing + envelope + prompt). Without it, Phase 3 has no “complete
   listing” to require.
2. Phase 2 (class-mode `atlas_first_seen`). Makes “oldest” fit the 4-round budget.
3. Phase 3 (harness). Makes search-and-stop a red chip and a requery, not a
   green subset.
4. Phase 4 (eval). Locks the incident in CI-adjacent measurement.

Routing (`extremum` → STRONG) ships with Phase 1. Extra `maxIterations` for
that route is optional and only worth it after 1–2 exist; otherwise it buys
four rounds of search.

## Open questions

- **Title exact vs prefix.** Exact `"Rate Limit"` is what the incident needs.
  Prefix `"Rate Limit"` also catches `"Rate Limits"` directories. Prefer
  exposing both and letting the prompt say: exact for a leaf title, prefix
  when the user said the family name. Do not fuzzy-match titles; that
  reintroduces ranking.
- **Class larger than the byte budget.** Slim rows (`include_content: false`)
  should fit hundreds of titles. If `total` still cannot be returned in one
  page, `has_more` plus Phase 2’s class-mode reduction is the path — never a
  silent clip.
- **Newest / last-seen.** Out of `atlas_first_seen` on purpose (`min` of
  `added`/`modified` only). If that shape shows up in traces, add a sibling
  `atlas_last_seen` or an `extreme` flag then — do not cram `max` into
  first-seen.
