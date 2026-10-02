# Reports

**When adding a new report** (a new `/reports/<slug>` route, `ReportId`, `src/components/reports/*` page, or `src/lib/*Index.ts` module), read and follow `.claude/skills/new-report/SKILL.md` (skill: `new-report`) — the checklist for CSV export, URL-synced filtering, in-report search, analytics, result counts, and registration that every report must satisfy. Report pages build on the shared harness: `ReportShell.tsx` owns the page chrome (title, filter summary, count/CSV row, loading/no-rows states, `report_view`) and the `useReportQuery.ts` hooks own URL-synced filter state + the one canonical `report_filter` event — never hand-roll either.

- **Report data logic lives in pure `src/lib/*` modules, not in the components**, so it's testable without React. Keep it that way when adding one.
- **Stale Dates recomputes client-side** from `docs.json` + the actual date on every visit — no build step, no worker — so it can't serve a stale view.
