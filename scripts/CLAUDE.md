# Scripts: build pipeline, censuses, sweeps and chain registry

This file covers the `scripts/` tree. It holds the build pipeline and its step list, the atlas parser shape, on-chain address extraction, the chain registry, the atlas census and merge-gate commands, the Potential Mistakes sweep, document briefings, settlements, GitHub environment pruning and the graph snapshot tests. History scripts (`build:history`, `history:prs`, `build:doc-versions`, `prehist:*`) are in `src/server/history/CLAUDE.md`. The `eval:*` bakeoffs are in `scripts/eval/CLAUDE.md`.

## Script directories

Each build pass is its own script. They run in order in `pnpm build`.

- `scripts/required/` holds the build pipeline entry-points wired into `pnpm build:*`.
- `scripts/lib/` holds shared modules (parsing, regexes, extraction phases) imported by those entry-points. It also holds `atlas-html.mjs`, `history-identity.mjs`, `ordered-containment.mjs` and `run-thread.mjs`. These are HTML-era parsing and matching primitives shared between `scripts/htmlhist/` and `scripts/prehist/` (same reasoning as `history-classify.mjs`).
- `scripts/aux/` holds offline, one-off and experimental scripts that are not part of the core build chain. Examples are `tva.sh`, `add-chain.mjs` (the `chains:add` fetcher, deliberately off the build chain since it hits the network) and `coverage-areas.mjs` (the CI coverage meter, not a build entry-point). knip's unused-file check excludes the whole directory for that reason, so a new script there needs no `knip.json` entry.
- `scripts/assess/` and `scripts/eval/` are their own feature subsystems, not one-offs.
  - `scripts/assess/` is the OEA/risk LLM-assessment pipeline (`assess-*.ts`, `oea:assess`/`risk:assess`).
  - `scripts/eval/` is the chat eval/verifier harness (`eval-*.ts` + `eval-corpora/`, `eval:*`).
- `scripts/htmlhist/` is the self-contained HTML-era history reconstruction feature (the `htmlhist:*` entry-points, their exclusive libs and the `HISTORY.md` runbook). It is off the `pnpm build` chain.
- `scripts/prehist/` is the sibling pre-git-origins reconstruction feature (the `prehist:*` entry-points, run on the `ancient-history` branch, see `scripts/prehist/HISTORY.md`). It is also off the `pnpm build` chain.

## Build pipeline

### Build passes

- **`scripts/required/build-index.mjs`** parses `Sky Atlas.md`. It emits `public/docs.json` (`Record<uuid, AtlasNode>`), `public/search-index.json` (serialized MiniSearch index), and a minimal `public/addresses.atlas.json` (`{ addr: { chain } }`). Annotation (roles, labels, tokens) is deferred to `build-graph` Phase 2.6. It imports `lib/atlas-parser.mjs` and `lib/address-chains.mjs`.
- **`scripts/required/build-glossary.mjs`** finds all `Definitions` sections and collects direct `[Core]` children as terms. It emits `public/glossary.json` keyed by lowercased term.
- **`scripts/required/build-addresses.mjs`** fetches the Sky chainlog and calls Etherscan `getsourcecode` per unique address. A read-through disk cache lives at `.cache/etherscan/<chainid>/<addr>.json`. It emits `public/addresses.json` (on-chain fields only: `chain`, `chainlogId`, `etherscanName`, `isContract`, `isProxy`, `implementation`). It does **not** delete `public/addresses.atlas.json`. It imports `lib/address-enrich.mjs`.

**Address artifact split:**

- `public/addresses.atlas.json` is atlas-derived: `chain`, `explorerUrl`, `roles`, `entityLabel`, `aliases`, `expectedTokens`. `build-index` writes it and `build-graph` Phase 4.5 enriches it. It is a permanent artifact.
- `public/addresses.json` is on-chain: `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?`. `build-addresses` writes it. It never contains atlas annotation fields.
- Frontend `loadAddresses()` loads both in parallel, merges per-address, and resolves `label = chainlogId ?? entityLabel ?? etherscanName`.

- **`scripts/required/build-graph.mjs`** does pattern-driven relation extraction.
  - **Phase 2.6** runs before entity extraction. It scans all doc content for addresses and applies structural role/label/token annotation. This replaces what was previously in `build-index`.
  - **Phase 2.5** scans Instance entities for address-valued ICD params and emits `has_address` edges.
  - **Phase 4.5** (five passes) enriches `public/addresses.atlas.json` with ICD-derived roles and labels, entity-linked labels, doc-title labels, and chainlog fallback.
  - It emits `public/graph.json` and `public/relations.json`. There is no loopback to `build-index`. See `.claude/skills/parse-atlas/SKILL.md`.
  - A Prime Agent entity's `meta.params` holds the controller-wide RateLimitIDs it states outside any instance (its "… Rate Limit IDs" sections), read with the same param walk as an instance's (`lib/graph-prime-rate-limits.ts`).
  - It imports `lib/graph-patterns.mjs`, `lib/graph-instances.mjs`, `lib/graph-entities.mjs` (Phase 1), `lib/graph-doc-edges.mjs` (Phase 2 doc edges 2a–2h), `lib/graph-entity-edges.mjs` (Phase 2 entity/address edges 2i–2x, one module per pattern under `lib/graph-entity-edges/`, run in the order `patterns.mjs` lists), `lib/graph-multisigs.mjs`, `lib/graph-transfers.mjs`, `lib/graph-bridges.mjs`, `lib/graph-omni.mjs`, `lib/graph-transitions.mjs` (Phase 2.8 patterns 17/18/21/22/23), `lib/address-chains.mjs` and `lib/address-annotate.mjs`.
- **`scripts/required/build-manifest.mjs`** writes a sha256 digest of every shipping artifact.
- **`scripts/required/build-at.mjs`** does a reproducible build at a pinned atlas commit. It orchestrates the other `build:*` scripts.

The history pass (`build-history.mjs`) is documented in `src/server/history/CLAUDE.md`.

### The step list

**The step list itself is declared once, in `scripts/lib/build-steps.mjs`.** Eight sites run some slice of this chain: `package.json`'s `build`, the Dockerfile builder stage, `build-at`, `refresh-atlas-build`, `dev-preflight`, `atlas-worker`, `src/server/atlas-updater.ts` and `src/server/preview/build.ts`. They legitimately run *different* slices. So the file exports a canonical ordered `STEPS` plus one named `PROFILES` entry per site, each carrying a comment for what it opts out of and why.

Every JS orchestrator iterates its profile. Two sites cannot import it: `package.json` and the Dockerfile (including the Dockerfile's hand-maintained `gzip` artifact list). `scripts_tests/build-steps.test.ts` parses them and asserts them against their profile. Add a build pass by adding a step and editing the profiles that should run it, never by hand-editing one call site.

### Parser shape

Heading regex (each node):

```
^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$
```

Each node has: `id` (uuid), `doc_no` (e.g. `A.0.1.1`), `title`, `type`, `depth` (heading level 1–6, **capped at 6** — semantic depth from the doc number may exceed 6), `parentId`, `order`, `content`, `addressRefs`. Parent IDs are resolved via a depth-indexed ancestor stack.

**Atlas document types** (from the syntax spec): Scope, Article, Section, Core, Type Specification, Active Data Controller, Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research. Supporting documents (Annotations, Action Tenets, Scenarios, Scenario Variations, Active Data) use special directory-number patterns (`.0.3.X`, `.0.4.X`, `.1.X`, `.varX`, `.0.6.X`). Needed Research uses global `NR-X` numbering.

`cleanContent()` strips wrapping single-backtick markers from multi-line backtick blocks (an Atlas authoring quirk). It does NOT remove code/backtick _content_.

### Build commands

- `pnpm build:index` parses `content/**` into `public/docs.json`, `public/search-index.json` and `public/addresses.atlas.json` (chain only, annotation is added by build-graph).
- `pnpm build:graph` runs Phase 2.6 address annotation and relation extraction into `public/graph.json` and `public/relations.json`. Phase 4.5 enriches `public/addresses.atlas.json`.
- `pnpm snap:chainstate` takes viem multicall snapshots and upserts the single-row `chain_state` table in Postgres. It needs `DATABASE_URL`. It refuses to replace a good snapshot with an empty fetch. It is deliberately OFF the `pnpm build` chain. The Railway atlas worker runs it on its own time gate (`CHAINSTATE_REFRESH_SECONDS`, default daily), and the frontend reads it back through `GET /api/chain-state`. This entry point is the manual fetch-to-DB escape hatch.

## Graph snapshots (`graph-snapshots/`)

Vitest snapshot tests record the current state of `relations.json`.

- `pnpm test:snap` verifies no drift.
- `pnpm test:snap:update` accepts deliberate changes. Run it after a deliberate atlas PR or a `build-graph` change.
- They use `vitest.snap.config.ts`. It is separate from the main `vitest.config.ts`, which excludes this folder.

## On-chain address extraction

See `.claude/skills/address-extraction/SKILL.md` for the full reference: EVM/Solana regex patterns, the load-bearing hex-boundary lookarounds, chain detection algorithm, `ROLE_VOCAB` classification, and the sync constraint between `address-chains.mjs` and `NodeContent.tsx`.

## Chain registry

**`src/data/chain-registry.json` is the single source of truth.** Four structures derive from it and must never be hand-maintained:

- `CHAINS` + `FUTURE_TO_ETHEREUM` (`scripts/lib/chains.mjs`)
- `CHAIN_HINTS` (`scripts/lib/address-chains.mjs`)
- `EXPLORER` (`src/lib/explorer.ts`)
- `NATIVE_TOKEN` (`src/lib/tokens.ts`)

They were four separate lists until every one of them was shown to fail silently when missed: wrong explorer, never-attributed prose, no balances. Add a chain with `pnpm chains:add <name>`, not by hand, and run `pnpm census:chains` after. Order in the file is load-bearing (ethereum last for label matching, `CHAIN_HINTS` derives the reverse). See the `$order` note in the JSON.

- `pnpm chains:add` resolves a chain from ethereum-lists/chains (the dataset behind chainid.network, via its gh-pages mirror) and writes its entry into `src/data/chain-registry.json`, the single source of truth all four chain structures derive from. It verifies the chainId with an `eth_chainId` round-trip. It refuses a half-entry when the source lists no explorer or no key-free RPC. `--dry-run` prints without writing. `--no-verify` skips the round-trip. It is deliberately OFF the `pnpm build` chain: the build is offline and deterministic (`REPRO=1`), so the fetch happens here and the result is committed as data.
- `pnpm census:chains` is the chain registry census (runs under bun, imports `src/lib/explorer.ts` + `tokens.ts`). It reads every chain string the pipeline reads:
  - `Token Address (X)` titles, `Network`/`Integration Partner Chain` params, and the multisig `address of ... on X is` regex.
  - An inverted prose scan for `<Proper Noun> Chain|Network|Mainnet|Rollup|L2`.
  - An address-anchored scan (`scripts/lib/chain-candidates.ts`) for chain-keyed address lists with a row naming no known chain. This is the half that catches single-word chain names in plain bullet rows, which the other two structurally cannot see.

  All strings are bucketed known / deferred (`FUTURE_TO_ETHEREUM`) / unknown. It warns (`[drift]`) on unknown chain strings not in `.github/chains-census-baseline.json`, i.e. the atlas named a chain the registry would silently collapse to ethereum. It also warns on an incomplete registry entry (missing explorer / proseHints / nativeToken / chainId / rpcUrl, each its own silent failure: wrong explorer, never-attributed prose, no balances) or a broken derivation. It also reports per-chain attributed address counts from `addresses.atlas.json`, so "seen in this atlas build" reflects what the pipeline concluded rather than only what the label scan could parse. `--update` rewrites the baseline (`atlas-update.yml` does this per bump). `--rpc` additionally round-trips `eth_chainId` against every `rpcUrl`. It always exits 0.

## PAU registry

**`src/data/pau-registry.json` is the curated list of every Prime agent's PAU contracts** (controller, ALM proxy, rate limits, diamond AccessControls / AdministeredAgent / facets, the shared BeamState and Configurator, relayers, freezers), per chain and controller generation. Anything that reads PAU state takes its contract list from here, never from the atlas directly. Types and validation live in `src/lib/pauRegistry.ts`; curation is the `pau-triage` skill.

- `pnpm pau:candidates` compares the registry with the atlas and writes `.cache/pau-candidates.{json,md}`. It never edits the registry, and it always exits 0 unless an input is missing.
  - Discovery (`scripts/lib/pau-discover.ts`) reads the address docs under each prime's "ALM Contracts" / "Diamond PAU Contracts" / "Multisigs" sections and the primitive's "Shared Contracts". The prime is the ancestor whose UUID is a prime entity; ancestors come from doc_no arithmetic, never `parentId`; chain and generation are read only from the anchoring section down, because an unrelated ancestor ("Base Elements") would otherwise name a chain. The doc's own placement outranks `addresses.json`, which attributes some PAU addresses to the wrong chain when the same address exists on two.
  - `scripts/lib/pau-diff.ts` reports what the registry lacks, provenance that went stale, and atlas self-contradictions (an address under two roles, or a verified explorer name that contradicts the role).
  - `--rpc` runs the wiring checks (`pau-wiring*.ts`): controller pointers, `hasRole` for monolith relayers and freezers, a diamond's enumerated facets, actors and revokers, and the live controller, read from the RateLimits CONTROLLER grant history (`scripts/lib/explorer-logs.ts`: Etherscan v2 with `ETHERSCAN_API_KEY`, else the chain's Blockscout). Findings the chain makes come back as proposals.
  - `--draft` writes `.cache/pau-registry.draft.json`: the registry plus every missing observation, for triage to edit down.
- The atlas worker's `pau` tick step reads the registry contracts' admin-event history and live state into Postgres; see `src/server/pau/CLAUDE.md`.

## Atlas merge gate and censuses

- `pnpm check:atlas` is the MERGE GATE for atlas bumps. It refuses a build that did not read the whole atlas.
  - It recounts documents in the source by a deliberately dumb, layout-blind scan (line-anchored `id:` frontmatter / `<!-- UUID: -->` headings over every `content/**.md`). It requires an exact match with `public/docs.json`, plus an absolute floor.
  - The recount is INDEPENDENT of `atlas-source.mjs` on purpose. The failure class is the loader not recognising the layout, so a check that asked the loader would just agree with itself.
  - `--against <atlas-sha>` also fails a bump that drops more than `ATLAS_MAX_DOC_DROP` (default 10%) of documents.
  - It runs in `atlas-update.yml` BEFORE the PR is opened (a bad bump never becomes a mergeable PR), in `ci.yml` as a PR check, and in `atlas-healer.yml` against main.
- `pnpm census:check` is the coverage census. It warns (`[drift]`) when uncovered structure clusters appear or grow vs `.github/atlas-census-baseline.json`. `--update` rewrites the baseline (`atlas-update.yml` does this per bump). It always exits 0.
- `pnpm census:govops` is the GovOps report recall census. It buckets every GovOps-mentioning doc (row / excluded-by-rule / residue). It warns (`[drift]`) on residue docs not in `.github/govops-census-baseline.json`, i.e. new GovOps phrasings `graph-duties.mjs` does not recognize. `--update` rewrites the baseline (`atlas-update.yml` does this per bump). It always exits 0.
- `pnpm census:risk` is the Risk Rules Assessment backlog census (runs under bun). It buckets every risk candidate (fresh / rejected-by-triage / backlog). It warns (`[drift]`) on backlog rows not in `.github/risk-census-baseline.json`, i.e. new or changed risk paragraphs `pnpm risk:assess` has not caught up with yet. `--update` rewrites the baseline (`atlas-update.yml` does this per bump). It always exits 0.
- `pnpm census:concepts` is the Atlas CrossView Concepts catalog census (runs under bun, imports `src/lib/conceptsCensus.ts`). It recomputes the 9 deterministic censuses backing `docs/crossview/concepts.md`: registry liveness, empty scaffolding, ghost doc types, transitionary measures, formulas, numbered-step docs, prohibition language, title templates, cross-scope duplication. It warns (`[drift]`) on new or changed members vs `.github/concepts-census-baseline.json`. `--update` rewrites the baseline (`atlas-update.yml` does this per bump). It always exits 0.

## Potential Mistakes sweep

- `pnpm mistakes:plan` computes the INCREMENTAL work plan for the sweep. It writes `.cache/mistakes-sweep/{plan.json,chunks/NNN.md}` for subagents to read.
  - It queues documents whose title, type or body digest moved since `.github/mistakes-sweep-state.json`. `doc_no` is deliberately excluded, so a renumbering does not re-queue 11k docs.
  - It also queues a `linked` bucket: unchanged documents that cross-reference something new, changed or removed. It finds them by inverting the atlas link graph, the same UUID markdown links `build-graph` emits as the `cites` edge. It derives them in-process because `relations.json` is never committed and a link into a deleted doc must be kept, not dropped.
  - Expansion is ONE HOP (a re-queued citer is not itself "changed"). Each linked chunk entry says which target moved. `--no-backlinks` turns it off.
  - `--full` re-queues everything. It is still needed for a pure renumbering, which moves no digest and so expands nothing while invalidating every doc_no-bearing link label.
  - `--limit=N` caps a sitting and leaves the rest queued.
- `pnpm mistakes:merge` folds `.cache/mistakes-sweep/findings/NNN.jsonl` back into `public/potential-mistakes.json` and advances the state.
  - After a `--full` plan it ALSO runs the corpus detectors (`scripts/lib/mistakes-corpus.mjs`). These are deterministic cross-document comparisons the chunked fan-out structurally cannot make, e.g. one template sentence that says `circulating` in six prime artifacts and `total` in two.
  - Rows carrying a `detector` are retired and rebuilt on every full run. That is what makes `--full` mean re-derive, not just re-read. Hand-authored corpus rows have nothing that can rebuild them, and only `--drop-corpus` removes them.
  - Findings a human rejected live in the artifact's `rejected` list, and `suppressRejected` keeps them from coming back.
  - It validates every model-reported row (known UUID, verbatim quote, legal severity/pass) and drops the rest.
  - **A chunk with no output file, or a truncated one, is treated as UNPROCESSED and stays queued.** A killed agent's silence must never be recorded as "read it, found nothing".
  - `--dry-run` prints the counts only.
- `pnpm mistakes:status` shows how many atlas documents changed since the last hand-run sweep. It is read-only.
- `pnpm mistakes:bootstrap` is a one-off. It adopts an existing whole-corpus sweep as the incremental baseline. It refuses unless the artifact's `atlasSha` matches the checked-out submodule.
- `pnpm mistakes:render` re-renders the gitignored `ATLAS-FINDINGS.md` export from the JSON. Run `pnpm cite:check ATLAS-FINDINGS.md` after.

## Document briefings

- `pnpm briefings:status` shows how many documents need a description written or rewritten (placement-aware document briefings). It is read-only. It prints the last two counts of `briefings:pull` (rows that differ from the file, rows at the failure limit) when `DATABASE_URL` is set, and says so in one line when the database is down.
- `pnpm briefings:plan` computes the work plan for the briefing-writing pass and writes `.cache/atlas-briefings/{plan.json,INSTRUCTIONS.md,chunks/NNN.md}` for subagents to read (runs under bun).
  - A briefing is one to three sentences saying what a document is IN CONTEXT (its ancestors, its siblings, the documents that cite it), plus two or three questions it answers. The typical atlas document is one line (median body 124 characters) whose meaning is in its placement, which is not in the text being embedded.
  - It is a sibling of `mistakes:plan` and imports its digest, plan and state functions, with three deliberate differences.
    - The packing unit is a whole SIBLING SET (every child of one doc-number parent, never split, because telling near-identical siblings apart is the point). A chunk is capped at 40 KB and 80 owed rows.
    - Members of a set that need no new row are still rendered, marked `CONTEXT ONLY`.
    - The one-hop expansion runs the other way. A moved document re-queues its children and its link targets, since those are the briefings written from it (`planBriefings`). Until the state's `complete` flag is set, a not-yet-described document does not count as moved, or every sitting of a corpus described in parts would re-queue the finished rows beside it.
  - `--full` re-queues everything.
  - `--limit=N` caps a sitting at the first N of the queue.
  - `--spread=N` caps it at about N taken in runs of 250 evenly from the whole queue, so a partial corpus is a fair sample of the full one, which a retrieval eval over it needs.
  - `--dry-run` prints counts and a sample with no model call.
  - `--force` is needed to replace a work directory that still holds agent output or pilot files (a full pilot is about six million subagent tokens).
  - `--eval-targets` selects the pilot: exactly the documents the retrieval eval's queries compete over (`competingSets`, `scripts/eval/eval-briefing-coverage.ts`, which the eval imports too so the two cannot disagree about what is covered).
- `pnpm briefings:merge` folds agent output into the committed `public/doc-briefings.json` and advances `.github/briefings-state.json`. `--model=NAME` is required. It names the `out/<model>/NNN.jsonl` folder the agents wrote to and is stamped on every row.
  - It validates every row and drops the rest: known UUID, a document the chunk asked for, briefing 40–400 characters that does not merely repeat the document, two or three questions each ending in `?`, and **no doc number and no UUID anywhere**. A doc number in a briefing would invalidate the corpus on every upstream renumbering.
  - A document is recorded as described only when a VALID ROW for it came back. This is stricter than the mistakes sweep, where an intact chunk with no finding means "read it, found nothing". A missing output file or a malformed JSONL line leaves the whole chunk queued.
  - A plan made with `--eval-targets` merges into `.cache/atlas-briefings/pilot-<model>.json` and leaves the state and the committed artifact alone, so two models can be compared on the same chunks. `--adopt` sends a pilot's rows to the committed artifact.
  - `--dry-run` prints the counts and the drop reasons only.
- `pnpm briefings:pull` refreshes `public/doc-briefings.json` and `.github/briefings-state.json` from the `atlas_doc_briefings` rows (needs `DATABASE_URL`, runs under bun).
  - The database is the live record, because the atlas worker writes briefings for new and changed documents there. A hand-run `briefings:plan` would otherwise pay to write what the worker already wrote.
  - It writes through the same `serializeArtifact` as `merge`, so the two cannot disagree on the file's shape.
  - Placeholder rows (`briefing = ''`, they only carry a failure count) are left out.
  - A row counts as described in the state only when its digest matches the live document, so a row written for an older version stays queued.
  - `--dry-run` prints the counts only: rows pulled, rows that differ from the file, rows at the failure limit.
  - It is not wired into CI, because `atlas-update.yml` has no database.
- `pnpm sync:briefings` is the atlas worker's briefing tail (seed, write, embed); it is described in `src/server/retrieval/CLAUDE.md`.

## Settlements

- `pnpm settlements:parse` fetches the soterlabs/settlement-reports xlsx (or `--dir`) and writes `public/settlements.json` plus coverage/reconciliation stats. `--quiet` prints one summary line instead.
  - It is off the `pnpm build` chain (`REPRO=1` is offline). It has exactly two automated callers, both asserted by `scripts_tests/build-steps.test.ts`.
    - The Docker image bakes `dist/settlements.json` after `build:vite`. A fetch failure hides the charts, it does not fail the image.
    - `dev-preflight` refreshes `public/settlements.json` on every `pnpm dev` boot.
  - Radar's Monthly settlement section reads that file. **A missing file is SILENT.** Vite's SPA fallback answers the path with 200 text/html, `loadSettlements()` swallows the parse error, and every radar page hides the section. That is why neither caller is optional.
  - Reading or auditing these workbooks has two load-bearing accounting invariants. Follow `.claude/skills/settlement-reports/SKILL.md` (skill: `settlement-reports`).

## Votes

- `pnpm votes:sync` writes `public/votes.json`: every executive vote (`sky-ecosystem/executive-votes`) and governance poll (`sky-ecosystem/polls`), joined with the vote.sky.money portal API for each spell's pass and execute dates and each poll's id, slug and outcome. The design and the matching it feeds are in `docs/plans/vote-matching.md`.
  - It is off the `pnpm build` chain (`REPRO=1` is offline). It has two automated callers, both asserted by `scripts_tests/build-steps.test.ts`, the way settlements has them.
    - The Docker image bakes `dist/votes.json` (and its `.gz`) after `build:vite`. A fetch failure leaves Stale Dates without vote evidence; it does not fail the image.
    - `dev-preflight` refreshes `public/votes.json` when it is missing or more than six hours old (`DEV_NO_VOTES=1` skips it).
  - Its consumers are Stale Dates' vote evidence and the Executive Votes in the reader panel's onchain section (`src/lib/votes/docVotes.ts`), both built on `src/lib/votes/` (`vote-index.ts` indexes the artifact, `evidence.ts` holds the matching rules, `claim.ts` and `subject.ts` read the atlas side; the subject check matches names, then a rare address from the claim's document, so a renamed party still matches), loaded in the browser by `apps/web/src/lib/votes.ts` and on the server by `src/server/votes.ts`. Both treat a missing or unreadable file as "no vote record" and render without the column.
  - The artifact's types live in `src/lib/votes/types.ts`, shared by the writer and the matcher. Each executive section keeps its body as plain words (`text`) for the subject check, so the file is written compact.
  - Every rule lives in `scripts/lib/votes/` (pure parsers, the portal reader, assembly, stats) and is pinned by `scripts_tests/votes-*.test.ts`. `scripts/lib/votes/record.ts` fetches and assembles the record (plus each poll's body) for both callers, this command and `sync:vote-evidence`; `scripts/aux/sync-votes.ts` is only the file I/O.
  - By default it fetches each repository's main-branch tarball. `--exec-dir` and `--poll-dir` read local checkouts instead. `--no-portal` skips the API, `--dry-run` writes nothing, `--quiet` prints one line.
  - **Executives key on the filename date**, the date atlas prose cites. The frontmatter and the portal can carry a different date for the same spell; the stats list every such drift. Filenames vary (no slug, an `oos-` prefix for out-of-schedule votes), so only the date is required.
  - A drafted executive is committed before its spell is deployed, carrying the template's `$spell_address` placeholder. It is recorded with a null address and no portal row.
  - **Each poll records the atlas pull requests it approved** (`atlasPrs`, every `next-gen-atlas/pull/N` its body links, via `atlasPullRequests` in `poll.ts`). The reader's history list shows it as "approved by poll … · cited by Executive Vote …" under each entry (`VoteIndex.approvals`, `ApprovedByPoll.tsx`; an executive is listed when its authorization links that poll), and the worker's history key (`src/server/vote-evidence/history.ts`) reads PR links through the same extractor. Executives carry no PR of their own; they reach one through the poll their authorization lines link.
  - **Atlas links are kept as written.** A uuid is a stable key. A doc_no only means something against the atlas of the vote's date, so the artifact never resolves one against the current build; that is the matcher's job. Legacy `sky-atlas.powerhouse.io` links keep only their doc_no, because their ids are not next-gen-atlas uuids.
  - **It fails loud on a fetch that parses cleanly but is wrong.** It throws under the floors (`MIN_EXECUTIVES`, `MIN_POLLS` in `assemble.ts`), on a vote file with no date in its name, on an executive address that is neither an address nor the placeholder, on portal paging that collects fewer polls than the portal reports, and when more than `MAX_EXECUTIVES_WITHOUT_PORTAL` deployed executives found no portal row (the portal's list was cut short). Executive paging runs to an empty page, not a short one, because that endpoint reports no total. **A portal failure fails the run**, since a portal-less artifact reads to a consumer as "no vote found"; `--no-portal` is the explicit way to write the repository data alone. The shrink guard refuses to replace an artifact that had more documents or more portal coverage, unless `--allow-shrink` is passed.
  - A malformed percent-escape in a hand-written link is decoded leniently (`safeDecode`), so one typo cannot abort the run. The portal reader reports any key it sees twice instead of silently keeping the later row.

- `pnpm sync:vote-evidence` is the atlas worker's vote-evidence tail (`src/server/sync-vote-evidence.ts`, design in `docs/plans/vote-matching.md` §11). It refetches the vote record, places each claim that names no executive through atlas history (the poll linking the pull request that first wrote it, found with `git log -S` on the worker's full atlas clone), asks Jev (`VOTE_EVIDENCE_MODEL`) to judge the rest, and writes the `vote_evidence` row `GET /api/vote-evidence` serves. The page and the chat's report tool lay it over the rules' verdicts with `applyOverlay` (`src/lib/votes/overlay.ts`), where the thresholds live.
  - Every Jev answer and every history hit is cached in `vote_evidence_cache` by a hash of the exact request, so a run only pays for new or changed claims. `VOTE_EVIDENCE_PER_CYCLE` caps requests per run, a fatal refusal (bad key, no credits) stops them, and a six-minute deadline keeps it inside the worker's tail cap.
  - It is time-gated (`VOTE_EVIDENCE_REFRESH_SECONDS`, an hour) and reruns sooner on a new atlas commit or an unfinished run. Under `--no-fetch` the worker skips it.
  - The questions (`src/server/vote-evidence/requests.ts`) are the ones `pnpm eval:vote-evidence` measures. Change them only with a fresh eval run, since the thresholds were fitted to them.

## Environment variables

- `pnpm env:example` writes `.env.example` from the env registry in `src/server/env/`. `--check` fails on drift instead. `src/server/env/env.test.ts` holds the registry to the code: every variable the server, the worker, the build scripts and `pnpm dev` read is declared, every declared one is read. It checks names only and never prints values.

## GitHub environment pruning

- `pnpm env:prune` deletes the GitHub deployment-environment records Railway's per-PR environments leave behind.
  - Railway de-provisions its own environment when a PR closes. GitHub never removes the repository Environment row it auto-created for that deployment name, so `/settings/environments` accrues one dead row per PR forever (~100 by 2026-09).
  - **DRY RUN BY DEFAULT.** `--apply` deletes.
  - Every keep/delete rule lives in `scripts/lib/prune-plan.ts` (pure, no I/O) and is pinned by `scripts_tests/prune-plan.test.ts`. The entry point is only the I/O around them.
    - A name must parse as a PR env via `prNumberFromRailwayEnv` to be a candidate at all.
    - A candidate whose PR is still open is kept.
    - One whose number resolves to no PR is reported but kept unless `--orphans`.
    - `PROTECTED_ENVIRONMENTS` is unreachable whatever the parse says.
  - `prNumberFromRailwayEnv` is NOT what the deploy gate uses. `e2e.yml` derives its PR number with its own `sed`, which has no word boundary. That is harmless there (it reads a name Railway generated, and a misparse only mis-scopes a skip check). It would be a wrong DELETE here, which is why the boundary lives in the JS function and is tested.
  - An all-404 PR sweep aborts rather than reading as "every PR vanished". A fine-grained token missing Pull requests: read 404s on every PR, and `--orphans` would then delete environments belonging to OPEN PRs.
  - It needs repo-admin rights. That is why `.github/workflows/env-prune.yml` carries its own `ENV_PRUNE_TOKEN` secret. The Actions `GITHUB_TOKEN` CANNOT do this at any `permissions:` setting, because neither `administration` nor `environments` is a grantable key.
  - That workflow runs it on `pull_request_target: closed` for promptness. `pull_request` would withhold the secret from fork PRs. Nothing from the PR is checked out or run, only its number is read.
  - A daily cron is the backstop. It is not redundant. GitHub does not deliver a close event for every PR (notably ones closed while conflicted), and a Railway `deployment_status` landing after a delete re-creates the record.
  - It is off the `pnpm build` chain. It only touches GitHub.
