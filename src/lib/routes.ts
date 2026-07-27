export const ROUTES = {
  HOME: "/",
  ATLAS: "/atlas",
  RADAR: "/radar",
  RADAR_ACTOR: "/radar/:slug",
  CONSTELLATIONS: "/constellations",
  SEARCH_HINTS: "/search-hints",
  PROVENANCE: "/provenance",
  PRIVACY: "/privacy",
  UPDATES: "/updates",
  CONNECT: "/connect",
  COLLECTIONS: "/collections",
  SHARED_COLLECTION: "/c/:id",
  REPORTS: "/reports",
  REPORTS_OF_RESPONSIBILITIES: "/reports/of-responsibilities",
  REPORTS_GOVOPS_RESPONSIBILITIES: "/reports/gov-ops-responsibilities",
  REPORTS_ACTIVE_DATA: "/reports/active-data",
  REPORTS_REWARDS: "/reports/rewards",
  REPORTS_PROCESSES: "/reports/processes",
  REPORTS_STALE_DATES: "/reports/stale-dates",
  REPORTS_OEA_ASSESSMENT: "/reports/oea-assessment",
  REPORTS_RISK_RULES: "/reports/risk-rules",
  REPORTS_RISK_RUBRIC: "/reports/risk-rules/rubric",
} as const;

export type NavPage = "atlas" | "constellations" | "radar" | "reports";

export const NAV_PAGE_ROUTES: Record<NavPage, string> = {
  atlas: ROUTES.ATLAS,
  constellations: ROUTES.CONSTELLATIONS,
  radar: ROUTES.RADAR,
  reports: ROUTES.REPORTS,
};

export type SearchScope = "atlas" | "constellations" | "radar" | "reports";

export interface ScopeConfig {
  label: string;
  placeholder: string;
}

export const SCOPE_CONFIG: Record<SearchScope, ScopeConfig> = {
  atlas:          { label: "atlas",         placeholder: "Search the Atlas or type /h for query help" },
  constellations: { label: "constellation", placeholder: "Filter by name — e.g. Spark, Aave, Bonapublica" },
  radar:          { label: "radar",         placeholder: "Filter actors — name, role" },
  reports:        { label: "reports",       placeholder: "Filter reports" },
};

// Per-report search-pill config: on a report page the pill shows a short
// report name and typing filters that report's rows in place. Keyed by exact
// route. The rubric page is deliberately absent (it's prose, not a report) —
// it falls back to the generic "reports" pill.
export const REPORT_SCOPE_CONFIG: Partial<Record<string, ScopeConfig>> = {
  [ROUTES.REPORTS_OF_RESPONSIBILITIES]:     { label: "op-fac",  placeholder: "Filter duties — facilitator, agent, text" },
  [ROUTES.REPORTS_GOVOPS_RESPONSIBILITIES]: { label: "govops",  placeholder: "Filter duties — govops, agent, text" },
  [ROUTES.REPORTS_ACTIVE_DATA]:             { label: "active",  placeholder: "Filter rows — title, party, agent" },
  [ROUTES.REPORTS_REWARDS]:                 { label: "rewards", placeholder: "Filter instances — name, partner, address" },
  [ROUTES.REPORTS_PROCESSES]:               { label: "proc",    placeholder: "Filter processes — title, doc no" },
  [ROUTES.REPORTS_STALE_DATES]:             { label: "stale",   placeholder: "Filter claims — date, doc, text" },
  [ROUTES.REPORTS_OEA_ASSESSMENT]:          { label: "oea",     placeholder: "Filter tasks — title, agent, text" },
  [ROUTES.REPORTS_RISK_RULES]:              { label: "risk",    placeholder: "Filter rules — title, doc no, text" },
};

// Reports whose data is also exposed to the chat agent as a one-call
// `atlas_report_*` tool. Keyed by report route → tool name. Only these reports
// get the "I'm viewing this report and can pull/query it" chat treatment; the
// reports absent here (processes, stale-dates, oea-assessment, risk-rules) have
// no backing chat tool, so the chat stays in its generic atlas mode there.
// The tool names are validated server-side (src/server/chat/system-prompt.ts)
// against the live tool registry before they ever reach the model.
export const REPORT_CHAT_TOOLS: Partial<Record<string, string>> = {
  [ROUTES.REPORTS_OF_RESPONSIBILITIES]: "atlas_report_facilitator_responsibilities",
  [ROUTES.REPORTS_GOVOPS_RESPONSIBILITIES]: "atlas_report_govops_responsibilities",
  [ROUTES.REPORTS_ACTIVE_DATA]: "atlas_report_active_data",
  [ROUTES.REPORTS_REWARDS]: "atlas_report_rewards",
};

// Canonical report id → display title. Single source of truth shared by the
// reports index (ReportsIndex) and visit-history capture (useReportVisitTracking).
// Keyed by report id (the /reports/<id> slug); the rubric sub-page is deliberately
// absent (it's prose, not a listed report).
export const REPORT_TITLES: Record<string, string> = {
  "of-responsibilities": "Operational Facilitator Responsibilities",
  "gov-ops-responsibilities": "Operational GovOps Responsibilities",
  "oea-assessment": "OEA Task Assessment",
  "active-data": "Active Data Index",
  rewards: "Integrator Reward Relationships",
  "risk-rules": "Risk Rules Assessment",
  "stale-dates": "Stale Dates",
  processes: "Atlas Processes",
};

// URL builders for SPA links. Use these with wouter's <Link to={...}> so back-button
// restores the exact destination URL.
export const atlasHref = (id: string) => `${ROUTES.ATLAS}?id=${id}`;
// Local ambient shim: some *Index.ts modules that call atlasUrl (for CSV
// building) are also imported by src/server/reports/*.ts, which type-checks
// under tsconfig.server.json's DOM-free `lib` — a bare `window` reference
// there is a compile error (TS2304), not just a runtime no-op. This
// module-scoped `declare` shadows the ambient DOM `window` only within this
// file and is erased at runtime, so the `typeof window` guard below still
// behaves identically in both the browser and the DOM-free server build.
declare const window: { location: { origin: string } } | undefined;

// Absolute variant for contexts that leave the app (CSV exports, copied links)
// where a bare "/atlas?id=…" isn't clickable. Window-guarded so lib modules that
// build this (e.g. report CSV builders) stay importable from a DOM-free/server
// context — falls back to the relative href there.
export const atlasUrl = (id: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}${atlasHref(id)}`;
// For an optional referenced-doc id (a CSV column that may have no doc to
// link) — every report with an optional reference should reach for this
// instead of repeating the `id ? atlasUrl(id) : ""` ternary by hand.
export const atlasUrlOrEmpty = (id?: string | null) => (id ? atlasUrl(id) : "");
export const actorHref = (slug: string, fragment?: string) =>
  `${ROUTES.RADAR}/${slug}${fragment ? `#${fragment}` : ""}`;
export const reportHref = (id: string) => `${ROUTES.REPORTS}/${id}`;
