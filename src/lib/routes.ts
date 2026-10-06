import { REPORTS, reportPath } from "./reports/registry";
import type { ScopeConfig } from "./reports/types";

export type { ScopeConfig };

export const ROUTES = {
  HOME: "/",
  ATLAS: "/atlas",
  RADAR: "/radar",
  RADAR_ACTOR: "/radar/:slug",
  RADAR_ACTOR_SETTLEMENTS: "/radar/:slug/settlements",
  SEARCH_HINTS: "/search-hints",
  PROVENANCE: "/provenance",
  PRIVACY: "/privacy",
  UPDATES: "/updates",
  FEATURES: "/features",
  CONNECT: "/connect",
  COLLECTIONS: "/collections",
  SHARED_COLLECTION: "/c/:id",
  CONVERSATIONS: "/conversations",
  HISTORY: "/me/history",
  REPORTS: "/reports",
  REPORTS_CROSSVIEW: "/reports/crossview",
  REPORTS_CROSSVIEW_CONCEPTS: "/reports/crossview/concepts",
  REPORTS_CROSSVIEW_AUDIT: "/reports/crossview/audit",
  REPORTS_CROSSVIEW_GLOSSARY: "/reports/crossview/glossary",
  REPORTS_OF_RESPONSIBILITIES: "/reports/of-responsibilities",
  REPORTS_GOVOPS_RESPONSIBILITIES: "/reports/gov-ops-responsibilities",
  REPORTS_ACTIVE_DATA: "/reports/active-data",
  REPORTS_REWARDS: "/reports/rewards",
  REPORTS_PROCESSES: "/reports/processes",
  REPORTS_STALE_DATES: "/reports/stale-dates",
  REPORTS_OEA_ASSESSMENT: "/reports/oea-assessment",
  REPORTS_RISK_RULES: "/reports/risk-rules",
  REPORTS_RISK_RUBRIC: "/reports/risk-rules/rubric",
  REPORTS_ONCHAIN_ADDRESSES: "/reports/onchain-addresses",
  REPORTS_MOD_FREQUENCY: "/reports/mod-frequency",
  REPORTS_POTENTIAL_MISTAKES: "/reports/potential-mistakes",
} as const;

// The preview INDEX is deliberately absent from ROUTES: main.tsx resolves
// `/preview` from window.location before the SPA router mounts, so it has no
// <Route> and cannot be reached with wouter's navigate() — that would leave
// App with nothing matching. Reach it with a full page load.
export const PREVIEW_INDEX_PATH = "/preview";

export type NavPage = "atlas" | "radar" | "reports";

export const NAV_PAGE_ROUTES: Record<NavPage, string> = {
  atlas: ROUTES.ATLAS,
  radar: ROUTES.RADAR,
  reports: ROUTES.REPORTS,
};

// Which top-nav section (if any) a location belongs to, for highlighting the
// active nav item and picking the search scope. Prefix-matched since e.g.
// every /reports/* sub-route counts as "reports".
export function activeNavPageFor(location: string): NavPage | null {
  if (location.startsWith(ROUTES.REPORTS)) return "reports";
  if (location.startsWith(ROUTES.RADAR)) return "radar";
  if (location.startsWith(ROUTES.ATLAS)) return "atlas";
  return null;
}

// Window-scroll mode: routes that don't need the "fixed shell, inner scroll"
// layout opt in here. The root grows with content (min-h-dvh) and the
// overflow-hidden wrappers are dropped, so the browser's native
// history.scrollRestoration handles back/forward for free.
export function usesWindowScroll(location: string): boolean {
  return (
    location.startsWith(ROUTES.REPORTS) ||
    location.startsWith(ROUTES.RADAR) ||
    location === ROUTES.COLLECTIONS ||
    location === ROUTES.CONVERSATIONS ||
    location === ROUTES.HISTORY
  );
}

export type SearchScope = "atlas" | "radar" | "reports";

export const SCOPE_CONFIG: Record<SearchScope, ScopeConfig> = {
  atlas:   { label: "atlas",   placeholder: "Search the Atlas or type /h for query help" },
  radar:   { label: "radar",   placeholder: "Search actors, instances, params, addresses" },
  reports: { label: "reports", placeholder: "Search reports — name, category, or topic" },
};

// Per-report search-pill config, keyed by exact route: on a report page the
// pill shows a short report name and typing filters that report's rows in
// place. The rubric page has none (it is prose, not a report) and falls back to
// the generic "reports" pill.
export const REPORT_SCOPE_CONFIG: Partial<Record<string, ScopeConfig>> = Object.fromEntries(
  REPORTS.flatMap((r) => ("scope" in r ? [[reportPath(r.id), r.scope]] : [])),
);

// Report route → the `atlas_report_*` tool that returns it in one call. Every
// report is name-aware in chat through REPORT_TITLES; only these get the
// "pull/query this report in one call" treatment. system-prompt.ts validates
// the names against the live tool registry before they reach the model.
export const REPORT_CHAT_TOOLS: Partial<Record<string, string>> = Object.fromEntries(
  REPORTS.flatMap((r) => ("chatTool" in r ? [[reportPath(r.id), r.chatTool]] : [])),
);

// Top-level pages that carry a constant title, for the same consumers as
// REPORT_TITLES below. Keyed by route. /radar/<slug> is deliberately absent —
// its title is the actor's name, which only the page itself knows.
export const PAGE_TITLES: Record<string, string> = {
  [ROUTES.RADAR]: "Radar",
};

// Report id (the /reports/<id> slug) → display title, for the reports index,
// visit history, OG cards and the chat's page context. The rubric sub-page is
// absent: it is prose, not a listed report.
export const REPORT_TITLES: Record<string, string> = Object.fromEntries(REPORTS.map((r) => [r.id, r.title]));

// Report id → one line on what it shows. These are SAbR's own report concepts,
// so the chat's page-context line carries this text too: without it the model
// has only a title to answer "what is this" with.
export const REPORT_DESCRIPTIONS: Record<string, string> = Object.fromEntries(REPORTS.map((r) => [r.id, r.description]));

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

// Rewrite the chatbot's in-app citation form `[Title](/atlas/<id>)` — which only
// works because the in-app markdown renderer intercepts that path — into an
// absolute, portable URL (`<origin>/atlas?id=<id>`) for content that leaves the
// app, e.g. a downloaded Markdown export opened locally or on another host.
// Reuses atlasUrl, so it degrades to the relative `/atlas?id=<id>` in a DOM-free
// context (still the correct route shape, just not origin-qualified).
// A PR preview citation (`/preview/<sha>/atlas?id=<id>`) is already a real
// route, so it only gains the origin.
export const absolutizeAtlasLinks = (markdown: string): string =>
  markdown
    .replace(/\]\(\/atlas\/([^)\s]+)\)/g, (_m, id: string) => `](${atlasUrl(id)})`)
    .replace(/\]\((\/preview\/[^)\s]+)\)/g, (_m, path: string) => `](${typeof window !== "undefined" ? window.location.origin : ""}${path})`);
export const actorHref = (slug: string, fragment?: string) =>
  `${ROUTES.RADAR}/${slug}${fragment ? `#${fragment}` : ""}`;
export const settlementsHref = (slug: string) => `${ROUTES.RADAR}/${slug}/settlements`;
export const reportHref = (id: string) => `${ROUTES.REPORTS}/${id}`;
