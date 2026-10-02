---
name: postgres-jsonb
description: >
  How Bun.sql binds and returns Postgres json/jsonb, array and aggregate
  columns in SAbR, and the write/read type traps that have caused real
  incidents. Use when writing or reading a jsonb column, a Postgres array
  column (text[]/uuid[]/vector), or an aggregate; when adding a migration with
  one; when typing a row interface for a SELECT; or when debugging
  "malformed array literal", ".filter/.map is not a function", a value that
  arrives as a string instead of an object, or a count that arrives as a
  string. Covers the double-encode trap, why the ::jsonb cast is convention
  rather than protection, per-element-type array decoding, the existing
  helpers, and how to re-verify all of it against a real database.
  Keywords: jsonb, json, ::jsonb, JSON.stringify, double-encoded, Bun.sql,
  bun sql, sql template, malformed array literal, Array value must start with,
  text[], uuid[], toUuidArrayLiteral, fromUuidArray, pg-array, vector,
  pgvector, count(*), bigint, ::int, timestamptz, Date, row type, tool_calls,
  page_context, verdict, balances, member_ids, address_refs, migration
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# postgres-jsonb

Every rule here is measured against the real database, not inferred. The
measured table is at the bottom with the command to re-run it.

## The one rule that matters

**Pass the RAW JS value. Never `JSON.stringify` before a `::jsonb` cast.**

```ts
// RIGHT — stored as a jsonb object/array, reads back parsed
await sql`INSERT INTO messages (tool_calls) VALUES (${calls}::jsonb)`;

// WRONG — stored as a jsonb STRING SCALAR, reads back as a string
await sql`INSERT INTO messages (tool_calls) VALUES (${JSON.stringify(calls)}::jsonb)`;
```

Bun encodes the value for the cast itself, so pre-stringifying encodes it
twice. Nothing throws. The row inserts fine and looks fine in `psql`. It fails
later, in the reader, as `.filter is not a function` — or silently, as a value
that is a string where every type says it is an object.

**The `::jsonb` cast is not what protects you.** Measured: a raw JS object
binds to a jsonb column correctly *with or without* the cast. Keep writing the
cast — it is the house convention, it states intent, and several tests assert
its presence — but do not believe a missing cast is why something broke, and
do not "fix" a double-encode by adding one.

## The four incidents this has actually caused

1. **A jsonb string scalar in production data.** An earlier `doRefresh()`
   double-encoded `addresses.balances`. `normalizeBalances`
   (`src/server/balances/balances.ts`) still parses a string transparently on
   read so corrupted rows self-heal on the next refresh. That reader is a
   *scar*, not a pattern to copy.
2. **`malformed array literal` on boot.** A JS array passed as a bound
   parameter for a Postgres array column (`atlas_doc_embeddings.member_ids`).
   Bun does not encode JS arrays as Postgres arrays — it sends the first
   element as a scalar. The empty array is worse: `[]` binds as `""`, so
   `malformed array literal: ""`. This is the noisy boot-embeddings failure in
   CLAUDE.md's Cursor Cloud notes.
3. **`ids.map is not a function`, failing an e2e smoke (PR #286).** A `uuid[]`
   column read back as the Postgres text form `{uuid,uuid}` and handed on as if
   it were `string[]`.
4. **A replay crash reachable from a second route (2026-09-30).**
   `callsWithRecall` in `context-compact.ts` called `.filter` on
   `row.toolCalls` straight from jsonb. Correct for every row the app writes,
   but the context meter added a *second* reader of those rows — the
   conversation-detail route — so one malformed legacy row would have turned
   reopening that chat into a 500 rather than just losing that row's cards. Now
   `Array.isArray`-guarded.

The pattern across all four: **the write is silent and the read is where it
explodes**, often in a different module, sometimes months later.

## Writing

| Column kind | Do this |
|---|---|
| `jsonb` / `json` | raw JS object or array + `::jsonb` |
| `text[]`, `uuid[]` | a Postgres array **literal** string `{a,b}` + `::text[]` / `::uuid[]`. For uuids use `toUuidArrayLiteral` (`src/server/pg-array.ts`) |
| a list of arbitrary strings | prefer raw array + `::jsonb`, and unwrap with `jsonb_array_elements_text` (see `atlas-artifacts.ts` `getArtifacts`) — safer than quoting an array literal by hand |
| `vector` (pgvector) | the bracketed literal + `::vector` (see `chat/teach/store.ts`) |

Bulk inserts: Bun's `${tx(rows, cols)}` helper **cannot cast per column**, so a
table with any jsonb or array column needs manual `$N` placeholders with the
cast applied to the right ones. `sync.ts` and `history/history-db.ts` both do
this; copy their shape rather than inventing a third.

## Reading

Type the row interface for what the driver actually returns, which is not
always what the column says:

- **`jsonb` → parsed object/array.** So `Record<string, unknown>` or your
  shape, not `string`. But guard with `Array.isArray` before calling an array
  method on one if the row could predate current write code, or if a second
  route reads the same rows (incident 4).
- **`text[]` → a real JS array. `uuid[]` → a string `"{…}"`.** Decoding differs
  by element type. Use `fromUuidArray` (`pg-array.ts`), which also tolerates a
  real array and a bare single uuid.
- **`count(*)` and `sum()` → strings** (Postgres bigint/numeric). Cast in SQL —
  `count(m.id)::int` — or the arithmetic downstream silently concatenates.
- **`timestamptz` → a `Date`.** Row types across this repo say
  `string | Date` and normalize with `new Date(v).toISOString()`; keep doing
  that rather than assuming either.
- **`NULL::jsonb` and `'null'::jsonb` are indistinguishable** on read — both
  arrive as `null`. If "absent" and "explicitly null" must differ, you need a
  second column or a sentinel.

## Before you trust a change to one of these

The unit tests here mock `db.ts` with an in-memory fake, so **SQL correctness
and driver return types are not covered by `bun test`**. A mocked test will
happily agree with a wrong query. Two things that do help:

1. **Assert the cast survives.** Several suites pin `::jsonb` in the generated
   query text (`chain-state.test.ts`, `forum.test.ts`, `preview/db.test.ts`,
   `balances/refresh.test.ts`, `atlas-artifacts.test.ts`,
   `history/history-db.test.ts`). Add one when you add a jsonb column.
2. **Run it against a real database.** Docker is available in the cloud
   container (`sudo dockerd` first — there is no systemd):

```bash
sudo dockerd &                     # cloud container only; skip on a dev box
docker compose up -d               # brings up redlens-pg
DATABASE_URL="postgres://redlens:redlens@localhost:5432/redlens" bun src/server/migrate.ts
# then: a throwaway bun script importing src/server/db.ts, or the real route
# handler with a signSession cookie (CHAT_JWT_SECRET must be set)
docker compose down -v             # tidy up — disk is a fixed allowance
```

Exercising the **real route handler** against real Postgres — not just the
query — is what catches a wrong row type: mint a session with `signSession`,
build a `Request` with the `sky_session` cookie, and call the handler directly.

## Measured behaviour (bun 1.3.11, 2026-09-30, pgvector/pgvector:pg16)

Re-verify with a throwaway script if you are on a newer bun; these are driver
behaviours, not Postgres ones, and they can change under you.

| Bound value | Column | Result |
|---|---|---|
| `{a:1}` + `::jsonb` | jsonb | ok → reads back `object` |
| `{a:1}` no cast | jsonb | ok → reads back `object` |
| `JSON.stringify({a:1})` + `::jsonb` | jsonb | ok → reads back **`string`** |
| `[{…},{…}]` + `::jsonb` | jsonb | ok → reads back `array` |
| `{a:1}` + `::json` | json | ok → reads back `object` |
| `["a","b"]` (± `::text[]`) | text[] | **throws** `malformed array literal: "a,b"` |
| `[]` + `::text[]` | text[] | **throws** `malformed array literal: ""` |
| `"{a,b}"` + `::text[]` | text[] | ok → reads back `["a","b"]` |
| `"{<uuid>}"` + `::uuid[]` | uuid[] | ok → reads back **`"{<uuid>}"` (string)** |
| — | `count(*)` | `"7"` (string); `count(*)::int` → number |
| — | `sum(id)` | `"28"` (string) |
| — | `timestamptz` | `Date` |

## Known stale comment

`src/server/sync.ts` explains its `::jsonb` casts with "the values are JSON
strings, which Postgres won't implicitly coerce to jsonb". That is not true of
the address path it sits above: `retrieval/doc-rows.ts` passes **raw** JS
values there (and says so). The cast requirement it states is still the house
convention; the reason it gives is wrong, so do not generalize from it.
