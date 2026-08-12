---
name: atlas-pr-check
description: >
  Runbook for reviewing a next-gen-atlas PR against RedLens. Triggered by phrases
  like "let's review PR ##", "how would PR ## affect the atlas", "check atlas PR",
  "does PR ## break anything", "what does atlas PR ## change". Covers invoking
  pnpm check:pr, reading .cache/pr-check/ reports, classifying build/test failures
  as parser format changes vs structural schema changes, and describing relationship
  deltas to the user.
  Keywords: atlas PR check, review PR, how would PR affect atlas, check:pr,
  build failure, graph structural change, parser failure, relationship delta.
license: MIT
metadata:
  author: anscharo
  version: "1.1"
---

# atlas-pr-check

Runbook for running and interpreting the atlas PR compatibility check.

## Invocation

```bash
pnpm check:pr <pr-number>
# e.g.: pnpm check:pr 42
```

Only **OPEN** PRs are accepted. Closed / merged PRs are rejected at the start.

The script (requires the `gh` CLI on PATH for PR metadata):
1. Fetches the PR's head SHA from `sky-ecosystem/next-gen-atlas`
2. Creates a **disposable git worktree** at HEAD — all builds run there, so the
   main checkout's `public/` and pinned submodule are never touched
3. Builds a baseline at the PR's **merge base** with atlas main (seeded from the
   cached `public/` build when the merge base matches `manifest.atlasCommit`)
4. Fetches `refs/pull/<N>/head` into the worktree's atlas submodule (handles fork PRs)
5. Runs `pnpm build:at <sha>` (index → graph → manifest) at the PR head
6. Runs `pnpm test`
7. On **success** — writes a relationship-delta report (PR vs merge base) with a
   full `diff -ru` of graph snapshots (untruncated)
8. On **failure** — writes a diagnosis report and exits 1
9. Removes the worktree either way — no cleanup needed afterwards

Report location: `.cache/pr-check/pr<N>-<sha7>.md`

---

## On success: describing the relationship delta

The report's "Relationship delta" section shows entity and edge-count changes
between the current artifact baseline and the freshly built PR artifacts.

Tell the user:
- Which **entity types** gained or lost members (e.g. `agent +3`, `foundation +1`)
- Which **edge types** gained or lost relationships (e.g. `prime_agent_for +3`)
- Whether any **new** entity or edge types appeared (listed under "New entity types" / "New edge types")
- If nothing changed → say so explicitly: the PR adds content that the parsers
  already handle fully; no code changes are needed

The report also includes a **"Graph snapshot diff"** section — a standard `diff -ru`
output (not vitest output) comparing baseline snapshots against the PR's snapshots.
This is untruncated. Read it to understand exactly which named entities, instances,
params, and role pairs changed. If the section says "(no snapshot changes)", the PR
adds no graph-visible content.

If new edge or entity types appear, consider whether `.claude/skills/parse-atlas/SKILL.md`
needs a new entry documenting the pattern (see "When to update" below).

---

## On failure: failure taxonomy

Read the report's "Failed phase" field and "Build log" section, then apply the
decision tree below.

### Decision tree

A report titled **"Atlas PR check — BASELINE FAILED"** means the build failed at
the PR's **merge base**, before the PR's changes were even applied. This is
pre-existing breakage in the atlas snapshot the PR is based on (common for stale
PRs branched from an old main — e.g. a duplicate UUID later fixed upstream).
It is not the PR's fault and not fixable in RedLens; the PR needs an upstream
rebase before it can be checked.

Otherwise the "Failed phase" in the report is `build:at <sha>` or `pnpm test`.
`build:at` is a wrapper — scan the build log for the **last `$ pnpm build:*`
line** to find the actual sub-command that failed.

```
Failed phase = build:at <sha>?
  Last $ line = pnpm build:index  → Parser / format change  (#1)
  Last $ line = pnpm build:graph  → Structural schema change  (#2)

Failed phase = pnpm test?  → which test file failed?
  parser.test.ts             → #1
  graph.test.ts              → #2
  address-annotate*.test.ts  → Address classification change  (#3)
  artifacts.test.ts          → Cascade — fix root cause (#1 or #2) first
  reproducible.test.ts       → Non-determinism — investigate ordering / timestamps
```

---

### Category 1 — Parser / format change

**Symptoms:** `build:index` exits non-zero, or `parser.test.ts` fails (node count
wrong, UUID missing from `docs.json`, field shape unexpected).

**Root cause:** Atlas changed its heading syntax, introduced a new doc type, or
added / reordered a field in the document header.

**Action — update parsers and tests only. Do not touch the parse-atlas skill.**

1. Read the raw diff (the script leaves `origin/pr/<N>` fetched in the submodule):
   `git -C vendor/next-gen-atlas diff "$(git -C vendor/next-gen-atlas merge-base origin/pr/<N> origin/main)" origin/pr/<N> -- content/ | head -200`
2. Identify what changed in the heading format or doc type list
3. Update `scripts/lib/atlas-parser.mjs` to handle the new format
4. Update `scripts_tests/parser.test.ts` if any assertion expectations changed
5. Verify: `pnpm build:index && pnpm test`

**If the PR regroups FILES rather than changing markdown syntax** (upstream has
done this twice: #236 atomized the monolith, #294 consolidated the tree into ~16
composed files) the fix belongs in `scripts/lib/atlas-source.mjs` (working
checkouts) and `scripts/lib/atlas-git-source.mjs` (the per-commit history walk),
not in the parser. Add a layout arm to `detectLayout` / `detectFormat` — never a
fallback, since an unreadable checkout and an old layout look identical from an
empty result. Then prove the regrouping is content-neutral before accepting it:

```
node scripts/aux/ab-parse-check.mjs vendor/next-gen-atlas <extracted-pr-tree>
```

Identical output across all 9 node fields means no artifact, contentHash, graph
snapshot, or history entry should move — and a snapshot diff is then a real
finding, not migration noise.

---

### Category 2 — Structural schema change

**Symptoms:** `build:graph` exits non-zero, or `graph.test.ts` fails (entity
missing, edge type not emitted, doc_no pattern unmatched, ICD param shape changed).

**Root cause:** Atlas introduced a new structural convention — new entity kind,
new role relationship, new doc_no pattern, new ICD parameter form, or a new way
of expressing an existing relationship.

**Action — update code AND the parse-atlas skill.**

1. Read the atlas diff (same merge-base→PR-head form as category 1):
   `git -C vendor/next-gen-atlas diff "$(git -C vendor/next-gen-atlas merge-base origin/pr/<N> origin/main)" origin/pr/<N> -- content/ | head -400`
2. Identify the new pattern (new heading under a Scope/Article, new ICD field, etc.)
3. Update `.claude/skills/parse-atlas/SKILL.md` (see "When to update" section below)
4. Update the relevant `scripts/lib/graph-*.mjs` module to extract the new pattern
5. Add a test assertion to `scripts_tests/graph.test.ts` for the new edge / entity
6. Verify: `pnpm build:graph && pnpm test`

---

### Category 3 — Address classification change

**Symptoms:** `address-annotate.test.ts` or `address-annotate-robustness.test.ts`
fails. `detectChain` returns null for a new chain, or ROLE_VOCAB is missing a label.

**Root cause:** Atlas added addresses on a new chain, or introduced a role label
not in ROLE_VOCAB.

**Action — update address-extraction skill AND code.**

1. Read `.claude/skills/address-extraction/SKILL.md` for the current patterns
2. Update `scripts/lib/address-chains.mjs` if a new chain pattern is needed
3. Update `scripts/lib/address-annotate.mjs` if ROLE_VOCAB needs a new entry
4. **Sync constraint:** if the EVM regex changed, also update `src/components/NodeContent.tsx`
   (the rehypeEthAddresses plugin uses the same regex — see address-extraction skill)
5. Update `.claude/skills/address-extraction/SKILL.md` with the new chain / role entry
6. Verify: `pnpm build:graph && pnpm test`

---

## When to update the parse-atlas skill

Update `.claude/skills/parse-atlas/SKILL.md` **only for category 2 structural
changes** — new Atlas conventions that affect entity/edge extraction.

Add the new entry under the appropriate section:
- New role → "Role-as-edge principle"
- New entity type → "Terminology" or "The Sky concept layers"
- New doc_no pattern → the relevant document type section
- New ICD structure → add a new subsection

Always include an Atlas source reference (doc_no or UUID) in the new entry.
Bump the `version` field in the frontmatter.

Do **not** update the skill for parser format fixes, test-only changes, or address
classification changes (those go in the address-extraction skill).
