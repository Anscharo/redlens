---
name: atlas-healer
description: >
  Weekly runbook for detecting and repairing atlas drift that threatens
  SAbR parsers and assumptions. Triggered by the atlas-healer.yml weekly
  workflow (an issue labeled "atlas-health" mentioning @claude), or by
  phrases like "run the healer", "atlas health check", "weekly atlas sweep",
  "did the atlas break anything this week". Covers gathering drift signals,
  the silence-ordered triage checklist, and the fix-PR vs finding split.
license: MIT
---

# Atlas Healer — weekly drift triage & repair

The atlas advances hourly (`atlas-update.yml`) and every bump **auto-accepts**
census baselines and graph snapshots in the same commit that reports drift.
Your job, once a week: reconstruct what was silently accepted, decide whether
any atlas change threatens a parser or assumption, repair what is mechanical,
and surface the rest — so the app keeps working and **no new atlas info is
silently dropped**.

Read the priorities in order. The ordering is by *silence*: the most dangerous
failures produce no warning anywhere, so absence of warnings is not health.

## 1. Gather signals

Artifacts are gitignored — build first: `pnpm build:index && pnpm build:graph`
(capture stderr of both) and `pnpm build:glossary`. Then:

1. **What changed upstream** — the `atlas_recent_changes` MCP tool with
   `since` = 7 days ago (`k` up to 200); the issue header carries last week's
   and today's atlas SHA if you'd rather bound it exactly with
   `atlas_changed_between`. Both name every changed document by doc_no, title
   and UUID with its PR. Do NOT reach for `git log --stat` on the submodule:
   it only named documents while the atlas stored one per file, and now lists
   bucket files (`content/A.1 - The-Governance-Scope.md | 1841 +++---`) — the
   MCP tools read `atlas_history`, so they are layout-blind.
   Also run `git -C vendor/next-gen-atlas diff <old>..HEAD -- ATLAS_MARKDOWN_SYNTAX.md`.
   A spec diff is the leading indicator of a new structural convention.
2. **What was silently auto-accepted this week** —
   `git log -p --since='1 week ago' -- .github/atlas-census-baseline.json .github/govops-census-baseline.json .github/risk-census-baseline.json .github/concepts-census-baseline.json .github/atlas-warnings-baseline.txt`
   and `git log --stat --since='1 week ago' -- graph-snapshots/__snapshots__`.
   This is the drift the hourly bumps recorded and then erased. Review every
   hunk: baseline *additions* are new uncovered structure; baseline *removals*
   may be matcher breaks reported as resolution.
3. **Live censuses (no `--update`)** — `pnpm census:check`, `pnpm census:govops`,
   `pnpm census:risk`, `pnpm census:concepts`; collect `[drift]` stderr lines.
4. **Process inventory** — `pnpm processes:check`; read `.cache/processes-audit.md`
   (missing UUIDs, ★ new candidates).
5. **Build warnings vs baseline** — `comm -13 <(sort -u .github/atlas-warnings-baseline.txt) <(sort -u <captured stderr>)`
   (the idiom from atlas-update.yml). The capture now includes the `[drift] tripwire:`
   zero-match lines and `[drift-count]` unresolved-counter buckets — a changed
   bucket line (e.g. `10-49` where the baseline says `1-9`) is a regression.
6. **Verify-mode tests** — `pnpm test:snap` and `pnpm test` (the hourly flow
   only ever runs snapshot *update*; verify catches what update papers over).
7. **Ops sweep** — failed `atlas-update.yml` runs this week (a run failure means
   the atlas silently stopped advancing); age of open `atlas-drift` /
   `processes-review` issues; risk-census backlog trend.

## 2. Triage checklist (silence-ordered)

### A. Structural gates — silent total loss

If any `[drift] tripwire:` line fired, an atlas renumber/rename zeroed a gate.
The doc_no gates live in `scripts/lib/graph-patterns.mjs` (`isPrimeAgent`,
`isExecutorAgent`, `isFacilitatorDoc`, `isGovOpsDoc`, `isActiveData`,
`isEcosystemAccord`, `isPartyDetails`, `isGrantDoc`); consequences cascade to
Radar, rewards, active-data, and all role edges. Ask `atlas_recent_changes`
for `change_type: "moved"` over the week — that is the renumber signal, stated
directly rather than inferred from file paths. If anything moved under
A.6 / A.2.8 / A.2.13, check each gate regex against the new numbering even if
no tripwire fired (partial renumbers shrink, not zero).
Cross-check entity counts in the snapshot diff (step 1.2) — a large drop in
any `edge_type` count is the same class of failure.

### B. New or renamed doc types

An `[drift] unknown document type "X"` warning means a type was added **or
renamed**. Added: thread it through all six lists — `KNOWN_DOC_TYPES`
(`scripts/lib/atlas-parser.mjs`), `NON_PROCESS_TYPES`
(`scripts/lib/process-keywords.mjs`), `NON_STEP_TYPES`
(`src/lib/processesIndex.ts`), `EXCLUDED_TYPES` (`src/lib/riskRules.ts`), the
duty-scan skip list (`scripts/lib/graph-entity-edges.mjs`, pattern 2s-ter),
`TYPE_ALIASES` (`src/lib/conceptsCensus.ts`). Renamed: additionally every
`type ===` filter keyed to the old name silently empties — the type tripwires
in `graph-tripwires.mjs` catch "Active Data Controller" / "Active Data" /
"Core" / "Scope"; check consumers before extending them to the new name.

### C. New structural suffix family

If the spec diff defines a new supporting-doc pattern (like `.0.3.X` /
`.varX` / `NR-X`), it must be threaded through **four independent doc_no
regexes** — `src/lib/docRefResolver.ts`, `scripts/lib/history-classify.mjs`,
`scripts/required/check-atlas-census.mjs`, `src/lib/dutyCollapse.ts` — plus
`isAnnotation` in `graph-patterns.mjs` and `semParent` in
`src/lib/crossviewShape.ts`. Missing one fails differently per consumer, all
silently.

### D. Phrasing drift in extraction patterns

For each new "did not parse" / "unresolved" stderr line and each doc the
coverage census flags: read the actual atlas text (prefer `atlas_get` /
`atlas_search` MCP tools) and classify — a *rephrase* of a known pattern
(mechanical: extend the regex in the owning `scripts/lib/graph-*.mjs` module,
citing the sentence) vs a *new convention* (finding; also update
`.claude/skills/parse-atlas/SKILL.md`, per the atlas-pr-check taxonomy).
Watch the patterns that **never warn** when they stop matching:
facilitator/govops assignment sentences and composite parties
(`graph-entities.mjs`), role bindings ("The X role is held by Y"),
multisig/bridge *child titles* ("…Signers", "…Number Of Signers",
"Validators", "Quorum Requirement"), ICD `Parameters` children, and the
exact titles `Definitions` (glossary) and `Distribution Reward Payments`
(`src/lib/rewardsIndex.ts`).

### E. Duplicated-regex sync obligations

Verify these stay in sync (drift here produces disagreeing artifacts, not
errors): GovOps spelling `graph-duties.mjs` ↔ `src/lib/govopsResponsibilities.ts`;
RP regexes `graph-patterns.mjs` ↔ `src/lib/activeDataIndex.ts`; ICD param key
names `graph-instances.mjs` ↔ `build-graph.mjs` ↔ `src/lib/rewardsIndex.ts`;
YAML name unquoting `atlas-parser.mjs` ↔ `build-history.mjs`; MiniSearch
options `build-index.mjs` ↔ `src/lib/searchOptions.ts`; address regexes
build-side ↔ `NodeContent.tsx` / `rehypeEthAddresses.ts` (see the
`address-extraction` skill).

### F. Report-layer assumptions

- **Crossview**: concepts-census member churn or an emptied census means
  `docs/crossview/concepts.md` prose may be stale — route through the
  `analyst-crossview` skill; never mechanically edit analyst prose.
- **Processes**: missing UUIDs / new candidates route through the
  `processes-triage` skill (curation is a human-methodology flow).
- **Rewards**: the `.2.5.1` / `.2.5.2` doc_no arithmetic and exact ICD param
  keys in `src/lib/rewardsIndex.ts` — check after any A.6 renumber.
- **Vocabulary drift**: a new agent token missing from `TOKEN_SYMBOLS`
  (`scripts/lib/address-annotate.mjs`); a new chain defaulting to ethereum
  (`CHAIN_HINTS` in `scripts/lib/address-chains.mjs`); new date phrasings
  outside `src/lib/staleDates.ts` regexes; new risk vocabulary outside
  `src/lib/riskRules.ts`.

### G. Hardcoded UUID anchors

`graph-entities.mjs` registry-UUID "not found" warnings (ERG membership,
Aligned/Ranked Delegates, CCRA binding, Spell Team) and
`[drift] concepts-census: crossview GROUPS root UUID … no longer in the atlas`:
find the successor doc by title/content, verify it is the same document
(not a coincidental title match), and update the UUID constant with its
doc_no comment.

## 3. Posture — what to do with each finding

**Mechanical, low-risk → one fix PR** (branch `atlas-healer/YYYY-MM-DD`):
extending a phrasing regex to cover a documented rephrase, threading a new
doc type through the six lists, re-syncing a duplicated regex, updating a
dead UUID anchor to its verified successor, adding a token symbol / chain
hint. Every fix cites the atlas evidence (UUID + quoted sentence) in the
commit message, and `pnpm test && pnpm test:snap` must pass. Prefer widening
a pattern minimally over rewriting it.

**Judgment calls → findings in the atlas-health issue**: new structural
conventions, anything changing report semantics, anything touching curated
content (`public/processes.json` verdicts, `docs/crossview/concepts.md`
prose, risk assessments), any pattern change whose effect extends beyond the
motivating example. State exactly what changed in the atlas, what it
threatens, and the proposed fix.

**Never**: run `pnpm risk:assess` (LLM spend + human review required);
`--update` any baseline without explaining in the issue what was accepted;
"fix" a snapshot diff by regenerating it without reading it.

**Always end with a health report** (comment on the atlas-health issue):
what changed upstream this week (from `atlas_recent_changes`, cited by doc_no
— the issue body no longer carries a changed-file list), what the hourly flow auto-accepted, what
you fixed (PR link), what needs a human, and the trend lines (risk backlog
size, `[drift-count]` buckets, open drift-issue age). "Nothing to report,
all signals clean" is a valid, explicit outcome — say it rather than
inventing work.
