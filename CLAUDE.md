# SAbR — Redline Portal

The public name of this app is **Redline Portal** (subtitle: Sky Atlas by Redline); the chat is **Redline Portal Chat**. Use those in anything a user, reader or model-visible prompt can see — UI copy, page titles, link previews, the chat system prompt and facts, README and PRIVACY. **SAbR** is the internal name only: code, comments, docs, CLAUDE.md files and skills. Load-bearing identifiers stay `redlens`: the GitHub repo, Postgres/Docker names, Railway services, `/redlens` paths, GitHub App slugs, and user-agents. Exception: the atlas-updater GitHub App slug is `redline-atlas-updater` (product name) — `claude.yml` `allowed_bots` and the healer/update workflows use that; do not "fix" it to `redlens`.

A search-first interface for the Sky ecosystem's [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas). The atlas is included as a git submodule at `vendor/next-gen-atlas/`; source documents live at `vendor/next-gen-atlas/content/**`. **Upstream has regrouped those files twice and will again — never assume a file layout.** All three layouts are supported and detected, never guessed: a single composed `Sky Atlas/Sky Atlas.md` (pre-#236), one `document.md` per node (atomized, #236–#294), and ~16 composed files in `content/` — one per top-level Scope plus one per Agent artifact (consolidated, [#294](https://github.com/sky-ecosystem/next-gen-atlas/pull/294) on). The markdown *syntax* is unchanged across all three; only the grouping differs — but the consolidated bucket files are **file-relative** (every file opens at `#`, whatever depth its subtree has) and are **not bucket-contiguous** (`A.6.1.2` lives in the `A.6` file yet is emitted after every Prime file), so the loader must order documents and re-derive heading levels from doc numbers exactly as upstream's `partition.py` does; concatenating the files as-is orphaned all 11 artifact roots server-side for a month while the reader's doc_no-derived tree hid it (fixed 2026-09-10, guarded by `scripts_tests/atlas-source-levels.test.ts` and a `check:atlas` tripwire). Layout knowledge lives in exactly two modules and nowhere else: `scripts/lib/atlas-source.mjs` (working checkouts — mirrors upstream's `sync/atlas_source.py`) and `scripts/lib/atlas-git-source.mjs` (git tree-ishes, for the per-commit history walk). Both **throw** on an unrecognised or implausibly small checkout rather than falling back — an empty parse must never be read as "some other layout", because that is also what a truncated clone looks like. Prove a new regrouping is content-neutral with `bun scripts/aux/ab-parse-check.mjs <dirA> <dirB>` (compares all 9 node fields). Atlas-derived artifacts (`docs.json`, `graph.json`, `relations.json`, `search-index.json`, `glossary.json`, `addresses.atlas.json`, `manifest.json`, `history/`) are **not committed to git** — they are built ephemerally at container startup (by the Dockerfile) or synced into Postgres (doc content + history + embeddings, by the Railway atlas worker service). The in-process updater polls `sync_state.atlas_sha` and rebuilds in-memory indexes from DB rows on drift — no git access needed at runtime.

**Atlas Markdown syntax reference**: `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` — canonical spec for heading format, document numbering, document types, extra fields, and nesting rules. Read this before touching the parser.

## Subsystem notes

Rules that matter only inside one subsystem live in a CLAUDE.md in that directory, which loads when you work there:

- `apps/web/CLAUDE.md`: the frontend — search-bar behaviour, the browser half of the meaning lane, styling and themes, the base path, component rules, open audit follow-ups.
- `src/server/retrieval/CLAUDE.md`: the server half of meaning search — the embedding model and the settings that follow it, briefings, leaf attribution, scoped queries, the route's budgets and re-embed check, `sync:briefings`.
- `src/server/history/CLAUDE.md`: per-document history, document versions and the PR-metadata cache.
- `scripts/CLAUDE.md`: the build pipeline pass by pass, the script folders, address extraction and the chain registry, and the full reference for the census, sweep, briefing, settlement and environment-pruning commands.
- `src/server/chat/CLAUDE.md` and `apps/web/src/components/chat/CLAUDE.md`: the chat loop and its reliability harness.
- `src/server/facts/CLAUDE.md`: chat facts and the on-device similarity lanes.
- `src/server/preview/CLAUDE.md`: PR previews.
- `apps/web/src/components/reports/CLAUDE.md`: building a report page.
- `scripts/eval/CLAUDE.md`: the `eval:*` bakeoffs.

## Commands

One line each. The full behaviour, flags and caveats of each command are in the subsystem file named after it.

```bash
pnpm build           # frontend pipeline: index → glossary → addresses → graph → oea-report → manifest → bundle → tools → tsc → vite (steps declared in scripts/lib/build-steps.mjs; scripts/CLAUDE.md)
pnpm build:index     # parses content/** → public/docs.json + public/search-index.json + public/addresses.atlas.json (chain only; annotation added by build-graph)
pnpm build:glossary  # extracts Definitions sections → public/glossary.json
pnpm build:addresses # chainlog + Etherscan enrichment → public/addresses.json (on-chain fields only)
pnpm build:graph     # relation extraction → public/graph.json + public/relations.json; annotates and enriches public/addresses.atlas.json
pnpm build:manifest  # sha256 digest of all artifacts → public/manifest.json
pnpm build:at        # reproducible build at a specific atlas commit
pnpm build:history   # atlas git log → atlas_history in Postgres, incremental (src/server/history/CLAUDE.md)
pnpm build:doc-versions # atlas git log → atlas_doc_versions: one row per document fingerprint change (src/server/history/CLAUDE.md)
pnpm history:prs     # fills the committed .cache/github-prs PR-metadata cache build:history reads; off the build chain (src/server/history/CLAUDE.md)
pnpm prehist:genesis | prehist:mip | prehist:aep  # (ancient-history branch) pre-git origins, run in that order; see scripts/prehist/HISTORY.md
pnpm snap:chainstate # viem multicall snapshot → the chain_state row in Postgres; off the build chain, the worker runs it daily (scripts/CLAUDE.md)
pnpm pull-atlas      # git submodule update --init --recursive (populate submodule after a shallow clone)
pnpm atlas:worker    # full atlas worker cycle: drift check → build → sync all Postgres tables
pnpm dev             # one-command local dev (see Local dev below)
pnpm preview         # serve the production build locally
REPRO=1 pnpm test    # reproducibility check — two builds at the same atlas SHA must be byte-identical
pnpm test:snap       # graph snapshot tests — fail if relations.json structure changed (graph-snapshots/); test:snap:update accepts a deliberate change
pnpm check:atlas     # MERGE GATE for atlas bumps: refuses a build that did not read the whole atlas (scripts/CLAUDE.md)
pnpm census:check | census:govops | census:risk | census:chains | census:concepts  # drift censuses against .github/*-baseline.json; --update rewrites; always exit 0 (scripts/CLAUDE.md)
pnpm census:embed-units # embedding-unit family census (histograms of ICD/directory/hub sizes; no fold/skip decisions)
pnpm settlements:parse # Soter settlement workbooks → public/settlements.json; two automated callers, neither optional (scripts/CLAUDE.md, skill settlement-reports)
pnpm mistakes:status | mistakes:plan | mistakes:merge | mistakes:bootstrap | mistakes:render  # the Potential Mistakes sweep (scripts/CLAUDE.md, skill mistakes-report)
pnpm briefings:status | briefings:plan | briefings:merge | briefings:pull  # document briefings, bulk pass and database pull (scripts/CLAUDE.md)
pnpm sync:briefings  # the atlas worker's briefing tail: seed, write, embed (src/server/retrieval/CLAUDE.md)
pnpm chains:add      # add a chain to src/data/chain-registry.json, verified; never hand-edit the derived chain tables (scripts/CLAUDE.md)
pnpm pau:candidates  # PAU registry queue: atlas vs src/data/pau-registry.json, --rpc wiring checks, --draft; never edits the registry (skill pau-triage)
pnpm env:prune       # delete dead GitHub deployment-environment records; dry run unless --apply (scripts/CLAUDE.md)
pnpm env:example     # writes .env.example from the env registry in src/server/env/; --check fails on drift (scripts/CLAUDE.md)
pnpm eval:*          # chat and retrieval bakeoffs; see scripts/eval/CLAUDE.md. Evals outside scripts/eval/ need OPENROUTER_APP_KIND=eval (see Conventions)
```

### Local dev

```bash
pnpm dev
```

`pnpm dev` is one-command: a preflight (`scripts/aux/dev-preflight.mjs`) runs, in order: `pnpm install` (only when `pnpm-lock.yaml`'s content hash changed — stamped in `node_modules/.dev-deps-hash`, so the steady state pays no install); ensures the Docker daemon is up (launches Docker Desktop on macOS, instructs on Linux); brings the Postgres container up + healthy (`docker compose`); runs the atlas worker in `--no-fetch` mode to sync Postgres to the **checked-out** atlas commit (build index+graph → `sync.ts` → history; embeddings only if an API key is set); builds the atlas artifacts (`docs.json`, `graph.json`, `relations.json`, `glossary.json`, `search-index.json`, `addresses.atlas.json` — none committed) if they're missing; and refreshes the Soter settlement workbooks (`public/settlements.json`, ~2s, never fatal — an offline boot keeps the file already on disk). Then it starts the Bun API server + Vite together.

Local dev builds the **checked-out** submodule commit, NOT `origin/main` — advancing to upstream is the cron worker's job (`pnpm atlas:worker`, no `--no-fetch`). Syncing the DB to the checked-out commit also stops the in-process updater from looping to drag live back to a stale local `sync_state.atlas_sha`.

Escape hatches: `DEV_NO_INSTALL=1` (skip the install check), `DEV_NO_WORKER=1` (DB up but skip the atlas sync; the server migrates at boot), `DEV_NO_DB=1` (skip Docker/Postgres entirely — reader works off disk artifacts; history/chat/preview need a DB), `DEV_NO_BUILD=1` (skip the artifact build *and* the settlement refresh), `DEV_NO_SETTLEMENTS=1` (skip only the settlement refresh). After a shallow clone run `pnpm pull-atlas` first to populate the submodule.

### Process inventory scripts

The curated process inventory (`public/processes.json` + `public/processes-ignored.json`) is reconciled against atlas drift by the `processes:*` scripts, which are off the `pnpm build` chain. See `.claude/skills/processes-triage/SKILL.md` ("Entry points") for which are human entry-points vs CI-only, and the triage runbook.

### Atlas healer (weekly drift sweep)

`.github/workflows/atlas-healer.yml` runs Mondays: rebuilds artifacts, runs every census in verify mode (no `--update`), reconstructs what the hourly atlas bumps auto-accepted that week, verifies graph snapshots, sweeps failed atlas-update runs, and opens an `atlas-health` issue whose `@claude` mention triggers triage via `.claude/skills/atlas-healer/SKILL.md` (the silence-ordered checklist + fix-PR-vs-finding rules). It also opens the `processes-review` issue when the inventory is dirty — `processes-autoclose.yml` closes it. Build-side tripwires live in `scripts/lib/graph-tripwires.mjs`: `[drift] tripwire:` stderr lines when a structural gate (doc_no regex or `type ===` filter) matches zero docs, and bucketed `[drift-count]` stderr lines for unresolved-counter regressions — both flow into the same warnings-baseline diff atlas-update.yml uses.

## Architecture

### Data pipeline

Each build pass is its own script under `scripts/required/`, with shared modules in `scripts/lib/`. The step list is declared once, in `scripts/lib/build-steps.mjs`, with one named profile per site that runs a slice of it; add a pass by adding a step and editing the profiles, never by editing one call site. `scripts/CLAUDE.md` describes every pass, the address artifact split, the heading regex and node fields, and the script folders.

**Chain registry: `src/data/chain-registry.json` is the single source of truth.** Four structures derive from it and must never be hand-maintained. Add a chain with `pnpm chains:add <name>` and run `pnpm census:chains` after (`scripts/CLAUDE.md`; address detection is in the `address-extraction` skill).

### Frontend

`App.tsx` is the shell (routing, URL sync, layout); the main atlas view is `apps/web/src/components/atlas/AtlasView.tsx`. Three workers live under `apps/web/src/workers/`: search (MiniSearch), atlas tree and graph. Search-bar behaviour, the meaning lane's browser half, styling and themes, and component rules are in `apps/web/CLAUDE.md`; the meaning lane's server half is in `src/server/retrieval/CLAUDE.md`.

### Citation dictate (non-negotiable) — cite every normative claim in context

**A "report" is anything that resembles Atlas analysis and is written to a file, to remote storage (Notion, etc.), or added to the SAbR site.** In any such report — and when citing during "atlas mode" conversation — **every concrete normative claim about what "must" / "has to" / "needs to" / "should" happen (or a threshold like "≥ 7 signers", "at least", "minimum of", "cannot", "required", "prohibited") MUST carry an Atlas reference _in context_.** We never merely *declare* a requirement; we cite the Atlas doc that dictates it.

- **In context means**: inline on the same line (an atlas `doc_no` like `A.2.7.1.1.1.1.4`, a UUID, or an `/atlas?id=…` link — a "Source" table cell on the same row counts), **or** a footnote the claim references directly (`… ≥ 7 signers.[^t]` with `[^t]: … A.2.7.1.1 …`), **or** — for verbatim Atlas quotes — a `>` blockquote whose attribution lead-in line carries the citation (`Threshold Requirements · A.2.11… :` above the quote). A detached trailing "References" section the claim does not point at **does not** satisfy this — the reference must be reachable *from the claim*. Never edit a verbatim Atlas quote to insert a citation; attribute the block instead.
- **The report data layer usually already has the provenance** (e.g. `buildMultisigsReport` computes `threshold_doc_no` / `purpose_doc_no` / `signer_docs`). Surface it in the prose — don't discard it when authoring the human-readable narrative.
- **Mechanical gate**: `scripts/lib/report-citations.ts` detects normative claims lacking an in-context citation. Run `pnpm cite:check <report.md>` on any file/site report draft before shipping it. The Notion report publisher wires the same detector and **refuses to publish** uncited claims (that integration ships with the Notion publishing pipeline; `--allow-uncited` is the only, deliberately loud, escape hatch). Do not weaken or bypass this gate to get a report out — an uncited claim means find the citation or soften the claim to a description of what the atlas *says*.

## Conventions / preferences

- **One lockfile: `pnpm-lock.yaml`.** pnpm is the only package manager — it installs for local dev, for all of CI, and inside both Docker images. Bun is the *runtime* (the server, every repo script, the atlas worker), not the installer. After any `package.json` dependency change run `pnpm install` and commit the refreshed `pnpm-lock.yaml` alongside it; `pnpm install --frozen-lockfile` in CI fails on a stale one. (There used to be a second `bun.lock` for the images, which nothing verified — it went stale silently and only surfaced as a Railway build failure. `oven/bun` ships no Node, so the images get pnpm from its standalone build rather than corepack.)
- **Use semantic HTML elements**: `h1`–`h6` for headings, `<button>` for actions, `<a>` for navigation, `<article>`/`<section>`/`<header>` for sectioned content. Prefer native elements over `<div>`/`<span>` with ARIA roles when a semantic element fits.
- **Don't add hover/click logic in JS when CSS will do it.**
- **The home button is a plain HTML link** (`<a href="/">`), not an `onClick` handler.
- **Search quality > bundle size** for the MiniSearch index. Full-content indexing is intentional.
- **Scroll-to is a fast fixed-duration glide** (`src/lib/animatedScroll.ts`): 220ms ease-out over the full distance, so duration never grows with distance. Never use native `behavior: "smooth"` — the user found it sluggish. Reduced-motion falls back to instant.
- **Sticky header collisions**: any scroll target needs `scrollMarginTop: "64px"`.
- **OpenRouter calls carry an `X-Title` app name, and evals must be labelled as evals.** `src/server/openrouter-attribution.ts` is the one source: `Sky Atlas Redline (<Railway env name>)` when deployed, `(Local)` without a Railway env var, `Sky Atlas Redline Evals` for eval traffic. Any script under `scripts/eval/` is detected automatically (from `process.argv[1]`). An eval or bakeoff living anywhere else (`scripts/aux/`, an ad-hoc `bun -e`, a test harness) must run with `OPENROUTER_APP_KIND=eval` or its spend lands in the production/Local bucket in OpenRouter's dashboard. A new code path that calls OpenRouter with raw `fetch` must spread `openrouterAttributionHeaders()` into its headers (chat, embeddings and Jev already do) — don't hardcode a title. The same split reaches PostHog: `src/server/ai-telemetry.ts` emits `$ai_generation` / `$ai_embedding` events for the calls `@posthog/ai` can't see (Jev, embeddings), with `chat_surface` (`jev:<task>` + a `jev_task` property, `embed-query`, `embed-batch`) and an `environment` property that every chat event carries too. A new Jev caller must pass `lane`; a new raw OpenRouter fetch should call `captureAiCall`.
- **Don't override git user.name/email.** Trust global config.
- **Show stats before touching the UI** when changing the build pipeline. The user wants to see counts/samples before any visual change consumes new data.
- **Keep `patch-notes.md` (repo root) current, but not noisy.** It backs the homepage "Recent improvements" log. When a change ships a user-visible feature or fix, add a one-line bullet in the same PR. If you are modifying or extending something that was just added today / in the same unreleased PR, do **not** add another bullet for the follow-up; treat it as part of the same unreleased feature. If the follow-up significantly changes what users will experience, revise the existing bullet instead of adding a second one (for example, do not add "Improved chatbot search" right after "Added Chatbot" unless the original note needs to be broadened). Date each `## YYYY-MM-DD` group by **the day the change becomes public** — the day it deploys/merges to main, or the day its feature flag is turned on — **not** the day the PR opens; newest date first. Write each bullet **for the end user**: past-tense verb + object, plain language describing something a user would find interesting (e.g. "Added a Stale Dates report", "Lightened colors for better visibility") — never dev/PM framing. Format is enforced by `pnpm check:patch-notes` (pre-commit hook + CI), which requires strict newest-first dates.
- **Keep the Features guide (`src/lib/featuresData.ts`) in sync — it is the single source of truth for "what can this app do".** It backs `/features`, the page the home page's "New here?" banner and the feedback modal's "Everything you can do" link both point at, **and the chat's product-documentation fact injects it verbatim** (`src/server/facts/features.ts`), so anything stale there is stale for every first-time user *and* for every "what can this app do" answer the chat gives. Whenever a PR ships a **user-visible** capability — a new route or page, a new report, a new panel/tab, a new gesture or keyboard affordance, a new query-syntax feature, a new MCP surface — add or update its entry in the same PR, alongside the `patch-notes.md` bullet. The two are not redundant: patch notes say *what changed and when*, the Features guide says *what exists and how to use it*. Rules for entries:
  - Name the **real control** the user has to find ("the save (disk) icon", "the `Selected · N` pill"), not an abstraction. If you rename or move a control, grep `featuresData.ts` for its old name.
  - **Never hardcode a count the app derives elsewhere** (number of reports, number of MCP tools). Those drift within days — `src/lib/reports/registry.ts` owns the report list and `/connect` reads the live tool count. Describe the set instead of counting it.
  - Gesture copy must match `src/lib/hintText.ts` — that's the wording the footer hint shows on the same control.
  - Anything behind a flag or per-environment (chat, sign-in providers, preview) belongs in `note`, phrased so it stays true in a deployment where the flag is off.
- **Every repo script runs under Bun** (`bun scripts/…` in `package.json`, CI and both images); Node stays only for pnpm and the tooling binaries it launches (tsc, vite, vitest). Write a new script module as `.ts`, not `.mjs` plus a hand-kept `.d.mts`. When you substantially change an existing `.mjs`, convert it and delete its `.d.mts`.
- **Each build pass gets its own script** (`scripts/required/build-<thing>.mjs`) and its own `pnpm build:<thing>`. Don't add new passes to `build-index.mjs`. Shared logic belongs in `scripts/lib/`.
- **Max 3 components per file** (only if 2 are <8 lines).
- **Size limits, in code lines (blank and comment lines are free):** file warn 120 / fail 180; function warn 20 / fail 50; functions in `.tsx` get 1.5× (30 / 75). oxlint's `max-lines` / `max-lines-per-function` enforce them through `pnpm check:size` in CI and the pre-commit hook (report-only until `continue-on-error` is removed from `ci.yml`). Hard limits and the grandfathered files are in `.oxlintrc.size.json`; each grandfathered file is pinned at its current size, so it fails if it grows. When you shrink one, lower its number in the same PR, and never add or raise an entry without saying why. Advisory limits (`.oxlintrc.size-warn.json`) apply only to changed files. Split along seams that already exist (labelled sections, repeated blocks). A one-caller helper that hides what the code does is worse than a long function.
- **New features plug in; they don't edit the middle of shared code.** Each extensible thing (build steps, chat facts, routes, worker steps, report metadata, edge patterns) is a list of self-describing entries. Adding a feature means new files plus at most one appended line per registry. If a feature needs edits inside an existing function, a switch, or a hand-kept parallel table, first turn that hub into a registry in its own PR. Derive every secondary table (titles, routes, docs, `.env.example`) from the one declaration, never by hand.
- **Declare every environment variable in `src/server/env/`.** Reading a new one means adding its entry to a group file there and running `pnpm env:example`; never edit `.env.example` by hand.
- **Comments are present-tense contracts.** State what holds and why ("ethereum stays last so a label naming both resolves to the L2"). Don't narrate history: no dates, PR numbers, "used to", or incident stories; those go in the commit and PR body. State a rule once, next to the code that enforces it, and point to it from elsewhere (`see pg-array.ts`). `pnpm check:comments` flags added comment lines that narrate (report-only, like `check:size`). Mark a line `history-ok` only where the date or PR number is atlas data.
- **Node stdlib imports use `node:` prefix**: `import fs from "node:fs"`, `import path from "node:path"`, etc. Never bare `"fs"` or `"path"`.
- **Never `JSON.stringify` a value into a `jsonb` column.** Pass the raw JS object/array with a `::jsonb` cast — Bun encodes once for the cast, so pre-stringifying stores a jsonb *string scalar* that inserts silently and explodes in a reader months later (it has, four times: `balances`, `member_ids`, a `uuid[]` e2e failure, a replay crash). Postgres **array** columns are the opposite: a JS array does not bind at all (`malformed array literal`), so they need a literal `{a,b}` + `::text[]`/`::uuid[]` — use `toUuidArrayLiteral`/`fromUuidArray` (`src/server/pg-array.ts`). Read types also differ from the column type (`text[]` decodes to an array but `uuid[]` does not; `count(*)` returns a string without `::int`; `timestamptz` returns a `Date`), and the unit tests mock `db.ts`, so **SQL and driver return types are not covered by `bun test`** — verify against a real Postgres. Full measured matrix and the verification recipe: `.claude/skills/postgres-jsonb/SKILL.md` (skill: `postgres-jsonb`).
- **Prefer MCP atlas tools over grep** for atlas content exploration: `atlas_get`, `atlas_search`, `atlas_neighbors`. Use grep only for exact known strings (UUIDs, addresses, regex patterns).
- **Never hardcode doc_nos as identifiers.** Doc numbers (e.g. `A.2.2.8.1`) are editorial labels that change whenever the atlas is renumbered — PR #235 proved this. UUIDs are the stable identity. Rules:
  - To look up a specific document: use its UUID as the key into `docs[uuid]` or `byParent.get(uuid)`.
  - To record a doc_no in source for human reference: put it in a comment next to the UUID (`// A.1.6`), never as the lookup key.
  - Doc_no **prefix matching** (`.startsWith("A.6.1.1.")`) for scope membership is also fragile: if the scope's own doc_no changes, every descendant prefix breaks. Prefer UUID-based ancestor checking via `parent_of` edges when refactoring those paths. Existing prefix matches are annotated with `// fragile: doc_no prefix` until migrated.
  - **Exception — spec-defined structural suffix patterns**: `ATLAS_MARKDOWN_SYNTAX.md` explicitly defines these suffixes as invariant parts of the format: `.0.3.X` (Annotation), `.0.4.X` (Action Tenet), `.1.X` (Scenario), `.varX` (Scenario Variation), `.0.6.X` (Active Data), `NR-X` (Needed Research). Regex and `startsWith`/`endsWith` checks against these structural suffixes are stable and correct — the spec guarantees them, they are not editorial doc_nos.

## Cursor Cloud specific instructions

Environment is provisioned by the startup update script (`pnpm install` + `pnpm pull-atlas`) plus a snapshot that already has Node (via nvm, ≥22.22 — a transitive dep requires it), pnpm (corepack), Bun (symlinked at `/usr/local/bin/bun`), and Docker installed. Non-obvious runtime caveats:

- **Start the Docker daemon before `pnpm dev`.** This container has no systemd init, so `systemctl start docker` does not work — run `sudo dockerd` in a background/tmux session and wait for it to come up. `pnpm dev`'s preflight brings up the `redlens-pg` Postgres container itself, but it needs a running daemon first (or use `DEV_NO_DB=1 pnpm dev` for a reader-only, DB-less run). See the "Local dev" section above for what `pnpm dev` orchestrates and the `DEV_NO_*` escape hatches.
- **Dev serves the app on Vite `:5173`, the Bun API on `:3000`.** In dev, atlas artifacts (`docs.json`, `search-index.json`, …) are served by Vite from `public/`; the Bun server only serves them under `/api/atlas/<sha>/`. So `curl localhost:3000/docs.json` 404s by design — hit `:5173` for the artifacts and the SPA. `GET :3000/api/health` returns the sync status (`atlas_sha`/`db_sha` match when healthy).
- **The `boot-embeddings` step can fail noisily when `OPENROUTER_API_KEY` is set**, with a `PostgresError: malformed array literal`. This is the optional semantic-embeddings background task; it does not crash the server or block the core reader/search/graph/reports (lexical MiniSearch search is unaffected and `/api/health` stays OK). Ignore it for reader/search work, or run without the key set to silence it.
- **Bun runs off pnpm's `node_modules`** — no separate `bun install` is needed to run the server/worker, and there is no second lockfile to keep in sync any more. After a `package.json` dependency change run `pnpm install` only; do not run `bun install` (it would write a `bun.lock` that nothing reads).
