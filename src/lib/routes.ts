export const ROUTES = {
  HOME: "/",
  ATLAS: "/atlas",
  RADAR: "/radar",
  RADAR_ACTOR: "/radar/:slug",
  CONSTELLATIONS: "/constellations",
  SEARCH_HINTS: "/search-hints",
  PROVENANCE: "/provenance",
  UPDATES: "/updates",
  CONNECT: "/connect",
  COLLECTIONS: "/collections",
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

// URL builders for SPA links. Use these with wouter's <Link to={...}> so back-button
// restores the exact destination URL.
export const atlasHref = (id: string) => `${ROUTES.ATLAS}?id=${id}`;
export const actorHref = (slug: string, fragment?: string) =>
  `${ROUTES.RADAR}/${slug}${fragment ? `#${fragment}` : ""}`;
export const reportHref = (id: string) => `${ROUTES.REPORTS}/${id}`;
