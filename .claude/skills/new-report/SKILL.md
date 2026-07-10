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
  report_view, report_filter, report_export, active data index, stale dates.
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

## The three non-negotiables

1. **CSV download.** A visible **Download CSV** `<button>` that exports the *currently
   filtered* rows (not the full set). Export through a **shared** CSV helper —
   `src/lib/csv.ts` (`toCSV(headers, rows)`). Create it if it doesn't exist yet, with
   RFC-4180 escaping: wrap every field in `"`, and double embedded quotes (`"` → `""`).
   **Do not** hand-roll per-report escaping — `activeDataRowsToCSV` in `activeDataIndex.ts`
   still carries its own local `csv()` escaper (correct, but a duplicate); build new reports
   on the shared `toCSV`/`downloadCSV` and migrate that local helper over when you touch it.
   Fire `track("report_export", { report: "<slug>", format: "csv" })` on click.

2. **Filtering, via the shared filter UI.** Use `useUrlState` so every filter/tab lives
   in a URL param (shareable, bookmarkable, back-button-safe). Render filters with the
   shared **`FilterPills`** / **`CategoryPills`** components and the `data-active` styling
   pattern — do not invent a new filter chrome. Compose multiple filters in distinct params
   (e.g. `?agent=…&entity=…&cat=…`). Fire
   `track("report_filter", { report: "<slug>", filter_type, value, active })` on toggle.

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

6. **Result count + empty state.** Show `{filtered.length} <unit>` near the controls, and a
   plain empty-state message when a filter/search yields zero rows (never a blank page).

7. **`track("report_view", { report: "<slug>" })`** once on mount, and
   **`useDocumentTitle("<Title>: Sky Atlas by Redline")`**.

8. **Deterministic sort.** Sort rows by a stable key (`localeCompare(…, { numeric: true })`
   over a doc_no/title) so table order and CSV order are reproducible across visits.

9. **Loading & error states.** Data loads (`loadAtlas` / `loadGraph` / etc.) run in parallel;
   render a loading state while pending and a visible error state on failure — never an
   eternal spinner.

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

- [ ] Download CSV button exports filtered rows via `src/lib/csv.ts` (escaping correct)
- [ ] Filters URL-synced via `useUrlState` + `FilterPills`/`CategoryPills`
- [ ] Header search filters the report in place (`q` param)
- [ ] Pure `src/lib/<name>Index.ts` + colocated `.test.ts`
- [ ] Registered in `types.ts`, `routes.ts`, `App.tsx`, `ReportsIndex.tsx`
- [ ] Result count + empty state; loading + error states
- [ ] `report_view` / `report_filter` / `report_export` tracked; `useDocumentTitle` set
- [ ] Deterministic sort; `patch-notes.md` bullet added
