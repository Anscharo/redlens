---
name: new-report
description: >
  Checklist and conventions for building a new report under /reports/* in
  RedLens. Use whenever adding, creating, or scaffolding a report — a new page
  in src/components/reports/, a new ReportId, a new /reports/<slug> route, or a
  data module in src/lib/*Index.ts. Follow this every time a new report is
  created so all reports stay consistent: CSV export, URL-synced filtering,
  scoped in-report search, analytics, result counts, and registration.
  Keywords: report, reports, new report, add a report, /reports, ReportId,
  ReportsIndex, CSV export, download CSV, FilterPills, CategoryPills, useUrlState,
  ReportShell, useReportQuery, useReportFilter, report_view, report_filter,
  report_export, active data index, stale dates.
license: MIT
metadata:
  author: anscharo
---

# New Report Checklist

Every report at `/reports/<slug>` must clear this list before it ships. Reports are
public, shareable, auditable artifacts — treat consistency across them as a feature.
Work from an existing report as the reference implementation: **`ActiveDataReport.tsx`**
+ **`activeDataIndex.ts`** is the fullest example (data module, CSV, URL filters,
analytics, counts).

## Rule zero: build the page on the shared harness

Every report page renders inside **`ReportShell`** (`src/components/reports/ReportShell.tsx`)
and wires its filters through the **`useReportQuery.ts` hooks** — the harness owns the page
chrome and the analytics, so pages can't forget or fork them:

- `ReportShell` renders the eyebrow/h1/description, the `controls` slot (pills), the
  `FilterSummary`, the count + CSV row (`count`/`actions` props — `actions` is normally
  `<DownloadCsvButton/>`), the loading state (`loading`), the shared no-rows line (`noRows`),
  and a `fullWidth` slot for wide scrolling tables. It also sets the document title and fires
  `report_view` once `ready` (extra properties via `viewProps`) — **pages never call
  `useDocumentTitle` or `track("report_view")` themselves.**
- Filter state comes from `useReportFilter` / `useReportEnum` / `useReportSelect` /
  `useReportList` / `useReportSwitch` (`src/components/reports/useReportQuery.ts`). Each wraps
  `useUrlState` and emits the one canonical `report_filter` event
  (`{ report, filter_type, value, active }`) through `trackReportFilter` — **never call
  `track("report_filter")` directly**, and never invent a second property name for the
  dimension (`filter_type` is the unified schema every saved PostHog insight references).
- Parse the header-box query with `useReportQuery(query, mode)` and filter rows through the
  shared `reportFilter.ts` logic.

## The three non-negotiables

1. **CSV download — two buttons, via the shared `DownloadCsvButton`.** Render
   `src/components/reports/DownloadCsvButton.tsx`, which provides **both** report downloads:
   - **Download full report** — always visible, always exports the *full, unfiltered* dataset.
   - **Download filtered report** — shown only while a search or filter is active, exports the
     *currently filtered* rows (its filename gets a best-effort marker of the active query/filters).

   Pass both builders and counts (`build`/`rowCount` for the filtered view, `buildFull`/`fullRowCount`
   for the full set) plus the report's `query` and its active `filters` array (the same values you
   hand `<FilterSummary>`, so the filtered button's visibility stays in sync). The builders are thunks
   — the CSV string is assembled on click, never on render. Don't hand-roll a single-button download.
   Export through the **shared** CSV helper `src/lib/csv.ts` (`toCSV(headers, rows)` / `downloadCSV`);
   create it if missing, with RFC-4180 escaping: wrap every field in `"`, and double embedded quotes
   (`"` → `""`). **Do not** hand-roll per-report escaping — `activeDataRowsToCSV` in `activeDataIndex.ts`
   still carries its own local `csv()` escaper (correct, but a duplicate); build new reports on the
   shared `toCSV`/`downloadCSV` and migrate that local helper over when you touch it.
   `DownloadCsvButton` fires `track("report_export", { report: "<slug>", format: "csv", scope, row_count })`
   on click (`scope` is `"full"` or `"filtered"`).

2. **Filtering, via the shared filter UI.** State lives in the `useReportQuery.ts` hooks
   (rule zero) so every filter/tab is a URL param (shareable, bookmarkable, back-button-safe)
   and every toggle emits the canonical `report_filter` event automatically. Render filters
   with the shared **`FilterPills`** / **`CategoryPills`** components and the `data-active`
   styling pattern — do not invent a new filter chrome. Compose multiple filters in distinct
   params (e.g. `?agent=…&entity=…&cat=…`).

3. **In-report search.** Typing in the header search box while on a report route sets the
   local `q` URL param instead of redirecting to atlas search (the scoped-search infra in
   `useSearchInput` / `SearchScope` already routes it there for non-`atlas` scopes). Your
   report must **read `q` and filter its rows client-side** so search narrows the report you
   are on. Match against the same fields the table shows.

## Also required (every report does these)

4. **Pure data module in `src/lib/<name>Index.ts`.** All row-building / filtering / CSV
   logic lives in a plain module with no React imports, so it's unit-testable. Add a
   colocated **`<name>Index.test.ts`** (test colocation rule). The `.tsx` component is a thin
   renderer over the module's output.

5. **Register the report** in all four places:
   - `src/types.ts` — add the slug to the `ReportId` union.
   - `src/lib/routes.ts` — add `REPORTS_<NAME>: "/reports/<slug>"`.
   - `src/App.tsx` — add a `<Route>` with a lazy `<Suspense fallback={<Loading />}>`.
   - `src/components/ReportsIndex.tsx` — add a `ReportCard` (`id`/`title`/`description`) to
     the right section. (`report_open` is auto-tracked in `App.tsx` on route entry — don't
     re-add it.)

6. **Result count + empty state.** Pass `count` (e.g. `` `${filtered.length} <unit>` ``) and
   `noRows={filtered.length === 0}` to `ReportShell` — it renders the count row and the shared
   no-rows line (never a blank page). The one sanctioned exception is a count that belongs
   inside a tab panel: render `ReportCountRow` there yourself (Modification Frequency is the
   example).

6a. **CSV rows referencing an atlas doc always carry a `UUID` column** (the raw `doc.id`,
   never a doc_no — see the doc_no-vs-UUID rule) **plus an `Atlas Link` column** built with
   `atlasUrl(id)` from `src/lib/routes.ts` (an absolute, window-guarded variant of `atlasHref`
   — safe to call from a DOM-free `src/lib/*Index.ts` module or a server-side report builder;
   use `atlasUrlOrEmpty(id)` — same file — for an *optional* reference instead of hand-rolling
   `id ? atlasUrl(id) : ""`). A row can reference more than one first-class doc (i.e. one with
   its own Doc No/Title columns — e.g. an Active Data doc + its Controller doc, or an ICD + its
   Payments Controller) — give each its own `UUID`/`Atlas Link` pair, named to disambiguate
   (`Active Data UUID`, `Controller UUID`, …). See `staleDatesToCSV` in `src/lib/staleDates.ts`
   for the reference implementation.

6b. **Never collapse multiple docs into one CSV row** (a joined `"A.3.1; A.4.1"` cell, or a
   single row standing in for several per-agent replicas). A table/UI view is allowed to group
   same-titled per-agent-artifact copies into one row for readability (`dutyCollapse.ts`'s
   `sources`/`mergedDocNos` mechanism, mirrored in `OeaTask.copies`) — but the CSV export must
   re-expand every such row back to one row per doc, so each row's UUID/Atlas Link points at
   exactly one doc. Use `expandSources` (`src/lib/dutyCollapse.ts`) when your row type carries
   a `sources: MergedSource[]` field (`facilitatorRowsToCSV`/`govopsRowsToCSV`); for a
   differently-shaped collapse (e.g. `oeaRowsToCSV`'s `expandTaskCopies`), build it on the
   shared `expandCopies(row, copies, applyCopy)` skeleton rather than hand-rolling the
   guard-and-map again. **Any field narrowed per copy must be narrowed correctly, not fudged**:
   an expanded row's Agent/Facilitator/etc. must reflect only what that SPECIFIC doc's own
   data says — never a fallback to the representative row's value (a different physical doc)
   and never the pre-collapse union pretending to apply to every copy (see `MergedSource.facilitators`
   in `dutyCollapse.ts` for how `facilitatorResponsibilities.ts` tracks a per-copy value
   alongside the row-level union when the two can legitimately differ). Because expansion can
   emit more CSV rows than the on-screen grouped count, compute `DownloadCsvButton`'s
   `rowCount`/`fullRowCount` from the expanded count, not `rows.length` — use `expandedRowCount`
   (`src/lib/dutyCollapse.ts`) for `sources`-shaped rows, or `oeaCsvRowCount`
   (`src/lib/oeaReport.ts`) as the pattern for a differently-shaped collapse.

7. **`report_view` + document title come from `ReportShell`** (rule zero) — pass `report`,
   `title`, and `ready` (defaults to `!loading`); extra event properties (row counts, rubric
   version…) go in `viewProps`. Never fire `report_view` or set the title by hand.

8. **Deterministic sort.** Sort rows by a stable key (`localeCompare(…, { numeric: true })`
   over a doc_no/title) so table order and CSV order are reproducible across visits.

9. **Loading & error states.** Data loads (`loadAtlas` / `loadGraph` / etc.) run in parallel
   (use `useLoaded` from `src/hooks/useAtlasData.ts` rather than a bespoke effect); pass
   `loading` to `ReportShell` for the pending state, and render a visible error state on
   failure — never an eternal spinner.

10. **Freshness.** If the report asserts anything time-relative (dates, "upcoming"),
    recompute client-side on every visit rather than baking it into a build artifact — see
    `staleDates.ts` for the pattern.

## Reference-only (already in CLAUDE.md — don't restate, just comply)

- Semantic HTML (`<table>`, `<button>`, `<a>`/`<Link>`, headings); `<Link>`/anchors over
  `onNavigate` callbacks for row navigation.
- Max ~150 lines / ≤3 components per file — split big tables into subcomponents
  (`OGCategoryTable`, `RewardsPrimitiveTable` are examples).
- **Never hardcode doc_nos as identifiers** — key on UUIDs; doc_nos only in comments.
- `node:` prefixed stdlib imports in any build-side code.
- Add one end-user-facing bullet to `patch-notes.md` in the same PR.

## Definition of done

- [ ] `DownloadCsvButton` wired with both full + filtered exports via `src/lib/csv.ts` (escaping correct)
- [ ] CSV rows include a `UUID` + `Atlas Link` (`atlasUrl()`) column per referenced doc
- [ ] No CSV row merges multiple docs — collapsed table rows are expanded 1-doc-per-row
- [ ] Page renders inside `ReportShell`; filters use the `useReportQuery.ts` hooks
- [ ] Filters URL-synced (via the hooks) + rendered with `FilterPills`/`CategoryPills`
- [ ] Header search filters the report in place (`q` param)
- [ ] Pure `src/lib/<name>Index.ts` + colocated `.test.ts`
- [ ] Registered in `types.ts`, `routes.ts`, `App.tsx`, `ReportsIndex.tsx`
- [ ] `count`/`noRows`/`loading` passed to the shell; visible error state on load failure
- [ ] `report_export` tracked via `DownloadCsvButton` (`report_view`/`report_filter` come from the harness)
- [ ] Deterministic sort; `patch-notes.md` bullet added
