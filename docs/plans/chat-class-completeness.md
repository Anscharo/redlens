# Chat class completeness — answers that are not in top-k

Status: PLANNED (not started). Incident 2026-08-24. Canonical live chat
behavior remains [`docs/chat-system.md`](../chat-system.md); this file is
prescriptive for work that is not in the code yet.

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
2. **No history extremum over a class.** `atlas_history` is one doc.
   `atlas_first_seen` is ≤50 ids you already have. `atlas_recent_changes` is
   newest-first, last 30 days by default — the opposite question.

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

## Phase 2 — extremum over a class (the “oldest” primitive)

A new history tool, not a 50-id loop of `atlas_first_seen`.

**Name:** `atlas_history_extremum` (own tool, DB-backed, same reason
`atlas_first_seen` is not folded into the sync graph tools).

**Class selector** — same fields as the listing path: `title`, `title_prefix`,
`type`, `doc_no_pattern`, `ancestor_id`, `entity`. Resolve the class in
process from `Indexes` (UUIDs), then one SQL over `atlas_history`.

**Event selector:**

- `added` — earliest/latest `added` row (today’s `atlas_first_seen` meaning).
- `modified` — earliest/latest `change_type = 'content'` (user-facing
  “non-move edit”; store vocab `content`, expose `modified` like the other
  history tools).
- `any_non_move` — `added` ∪ `content`, excluding `structural`.

**Extreme:** `min` | `max` on `committed_at` (null dates sort last for `min`,
never win; surface them in `undated` so a severed-era doc cannot silently
disappear).

**Return:**

```
{
  class_total: number,          // docs in the class
  class_with_history: number,
  event: "modified",
  extreme: "min",
  ties: [{ uuid, doc_no, title, date, source, change_type, pr_number, pr_title }],
  undated: [{ uuid, doc_no, note }],   // optional
}
```

Ties (same date) all return — the incident’s three 2026-07-10 IDs were a real
tie *inside a subset*; the tool must show ties inside the **class**. Cap `ties`
only with an explicit `truncated` on that array, never by dropping extras.

`whenToUse`: questions that ask for the oldest / newest / first / last document
in a named class. Cite dates as history-derived, never as atlas-stated
(`atlas_first_seen` already has this rule).

Fixture: the incident UUID must beat any `"Rate Limit"` leaf whose first
`content` event is 2026-07-10, for `title: "Rate Limit"`, `event: "modified"`,
`extreme: "min"`. Skip the assertion when `atlas_history` is empty (unit tests
without Postgres); the DB-backed suite (`tools-history-db.test.ts`) owns it.

Phase 2 does **not** replace Phase 1. Listing is still required for “all” /
“how many.” Extremum is the reduction so “oldest” does not need N history
calls inside a 4-round budget.

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

- an `atlas_history_extremum` result whose `class_total` is cited or implied, or
- an `atlas_filter` (or equivalent listing) with `has_more !== true` and
  `truncated !== true` for the same class.

**Refuted** if an extremum/listing in evidence disagrees with the claimed
winner or count (the listing/extremum is the table; treat like param
mismatches).

**Unverified** otherwise → hard `fail` on exhaustive questions (absence’s
unverified is softer; here the question *required* a census). That fail must
steer the advisor to **`requery`**, not `rewrite`. Extend `describeCheckFailures`
with one sentence the recovery prompt already understands: *the class was not
listed to completion; call `atlas_filter` / `atlas_history_extremum` before
answering.*

Do not ask the claim-table verifier to notice missing documents. It only sees
retrieved evidence; an incomplete retrieve looks well-cited. This contract is
about **which tools ran**, not about quoting.

Tests (mutation-check like the rest of this PR):

- Incident-shaped answer + only `atlas_search` evidence → fail, requery.
- Same answer + untruncated `atlas_filter` title listing whose `total` matches
  the named set → pass (listing questions).
- Extremum answer + `atlas_history_extremum` ties that include the claimed
  UUID → pass.
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
- Pass if `atlas_filter` (title) or `atlas_history_extremum` ran before the
  answer, and a listing used for “all” was not `has_more`.

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
2. Phase 2 (extremum). Makes “oldest” fit the 4-round budget.
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
  page, `has_more` plus Phase 2’s in-SQL reduction is the path — never a
  silent clip.
- **`atlas_first_seen` vs the new tool.** Keep `atlas_first_seen` for “these
  12 ids, when were they added.” Do not overload it with filters; the
  modified/non-move axis does not belong there.
