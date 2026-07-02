export const ROUTES = {
  HOME: "/",
  ATLAS: "/atlas",
  RADAR: "/radar",
  RADAR_ACTOR: "/radar/:slug",
  CONSTELLATIONS: "/constellations",
  SEARCH_HINTS: "/search-hints",
  PROVENANCE: "/provenance",
  CONNECT: "/connect",
  REPORTS: "/reports",
  REPORTS_OF_RESPONSIBILITIES: "/reports/of-responsibilities",
  REPORTS_GOVOPS_RESPONSIBILITIES: "/reports/gov-ops-responsibilities",
  REPORTS_ACTIVE_DATA: "/reports/active-data",
  REPORTS_REWARDS: "/reports/rewards",
  REPORTS_PROCESSES: "/reports/processes",
  REPORTS_STALE_DATES: "/reports/stale-dates",
} as const;

export type NavPage = "atlas" | "constellations" | "radar" | "reports";

export const NAV_PAGE_ROUTES: Record<NavPage, string> = {
  atlas: ROUTES.ATLAS,
  constellations: ROUTES.CONSTELLATIONS,
  radar: ROUTES.RADAR,
  reports: ROUTES.REPORTS,
};

export type SearchScope = "atlas" | "constellations" | "radar" | "reports";

export const SCOPE_CONFIG: Record<SearchScope, { label: string; placeholder: string }> = {
  atlas:          { label: "atlas",         placeholder: "Search the Atlas or type /hints for query help" },
  constellations: { label: "constellation", placeholder: "Filter by name — e.g. Spark, Aave, Bonapublica" },
  radar:          { label: "radar",         placeholder: "Filter actors — name, role" },
  reports:        { label: "reports",       placeholder: "Filter reports" },
};

// URL builders for SPA links. Use these with wouter's <Link to={...}> so back-button
// restores the exact destination URL.
export const atlasHref = (id: string) => `${ROUTES.ATLAS}?id=${id}`;
export const actorHref = (slug: string, fragment?: string) =>
  `${ROUTES.RADAR}/${slug}${fragment ? `#${fragment}` : ""}`;
export const reportHref = (id: string) => `${ROUTES.REPORTS}/${id}`;
