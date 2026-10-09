import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { ROUTES } from "@/lib/routes";
import { reportPath } from "@/lib/reports/registry";
import type { ReportId } from "@/types";
import type { SearchMode } from "../hooks/useSearchInput";

// Retries a failed dynamic import once before propagating the error.
// Silently handles transient "Failed to fetch dynamically imported module"
// errors that occur when a chunk isn't cached yet on first navigation.
export function lazyRetry<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch(() => factory());
}

// Wraps React.lazy + lazyRetry + picking a named export in one call, so each
// route below only states its import path and the export name it needs.
// NOTE: ConversationsPage is deliberately NOT defined here — it stays local
// to components/routes/AppRoutes.tsx, next to the __CHAT_ENABLED__ guard it's
// only ever rendered behind, so that guard's dead-code-elimination proof
// (chat-off builds strip the whole chunk) isn't disturbed by crossing a
// module boundary.
function lazyImport<M extends Record<string, ComponentType<any>>, K extends keyof M>(
  factory: () => Promise<M>,
  key: K,
): LazyExoticComponent<M[K]> {
  return lazy(() => lazyRetry(factory).then((m) => ({ default: m[key] })));
}

export const OpFacilitatorsReport = lazyImport(() => import("../components/reports/OpFacilitatorsReport"), "OFReport");
export const OpGovOpsReport = lazyImport(() => import("../components/reports/OpGovOpsReport"), "OGReport");
export const ActiveDataReport = lazyImport(() => import("../components/reports/ActiveDataReport"), "ActiveDataReport");
export const RewardsReport = lazyImport(() => import("../components/reports/RewardsReport"), "RewardsReport");
export const OnchainAddressesReport = lazyImport(() => import("../components/reports/OnchainAddressesReport"), "OnchainAddressesReport");
export const ProcessesReport = lazyImport(() => import("../components/reports/ProcessesReport"), "ProcessesReport");
export const StaleDatesReport = lazyImport(() => import("../components/reports/StaleDatesReport"), "StaleDatesReport");
export const PotentialMistakesReport = lazyImport(() => import("../components/reports/PotentialMistakesReport"), "PotentialMistakesReport");
export const ModFrequencyReport = lazyImport(() => import("../components/reports/ModFrequencyReport"), "ModFrequencyReport");
export const OeaAssessmentReport = lazyImport(() => import("../components/reports/OeaAssessmentReport"), "OeaAssessmentReport");
export const RiskRulesReport = lazyImport(() => import("../components/reports/RiskRulesReport"), "RiskRulesReport");
export const RubricPage = lazyImport(() => import("../components/reports/RubricPage"), "RubricPage");
export const ReportsIndex = lazyImport(() => import("../components/ReportsIndex"), "ReportsIndex");
export const ProvenancePage = lazyImport(() => import("../components/ProvenancePage"), "ProvenancePage");
export const PrivacyPage = lazyImport(() => import("../components/PrivacyPage"), "PrivacyPage");
export const UpdatesPage = lazyImport(() => import("../components/UpdatesPage"), "UpdatesPage");
export const ConnectPage = lazyImport(() => import("../components/ConnectPage"), "ConnectPage");
export const FeaturesPage = lazyImport(() => import("../components/FeaturesPage"), "FeaturesPage");
export const RadarPage = lazyImport(() => import("../components/radar/RadarPage"), "RadarPage");
export const CrossViewPage = lazyImport(() => import("../components/crossview/CrossViewPage"), "CrossViewPage");
export const AdminEntry = lazyImport(() => import("../admin/AdminEntry"), "AdminEntry");
export const VisitsPage = lazyImport(() => import("../components/visits/VisitsPage"), "VisitsPage");
export const CollectionsPage = lazyImport(() => import("../components/collections/CollectionsPage"), "CollectionsPage");
export const SharedCollectionOpener = lazyImport(
  () => import("../components/collections/SharedCollectionOpener"),
  "SharedCollectionOpener",
);

// Context handed to each SIMPLE_ROUTES entry's props() factory — the subset
// of the shell's render-time values any of these routes need.
export interface RouteCtx {
  query: string;
  mode: SearchMode;
}

export interface SimpleRoute {
  path: string;
  Component: ComponentType<any>;
  props?: (ctx: RouteCtx) => Record<string, unknown>;
}

const searchProps = (c: RouteCtx) => ({ query: c.query, mode: c.mode });

// The page for each report in src/lib/reports/registry.ts, at /reports/<id>.
// Keyed by ReportId, so a registered report without a page fails to compile.
const REPORT_PAGES: Record<ReportId, Omit<SimpleRoute, "path">> = {
  "of-responsibilities": { Component: OpFacilitatorsReport, props: searchProps },
  "gov-ops-responsibilities": { Component: OpGovOpsReport, props: searchProps },
  "oea-assessment": { Component: OeaAssessmentReport, props: searchProps },
  "onchain-addresses": { Component: OnchainAddressesReport, props: searchProps },
  rewards: { Component: RewardsReport, props: searchProps },
  "risk-rules": { Component: RiskRulesReport, props: searchProps },
  processes: { Component: ProcessesReport, props: searchProps },
  "active-data": { Component: ActiveDataReport, props: searchProps },
  crossview: { Component: CrossViewPage, props: () => ({ tab: "shape" }) },
  "potential-mistakes": { Component: PotentialMistakesReport, props: searchProps },
  "stale-dates": { Component: StaleDatesReport, props: searchProps },
  "mod-frequency": { Component: ModFrequencyReport, props: searchProps },
};

// Report/page routes that are just <Suspense><Component .../></Suspense> with
// no route params and no custom children — rendered by AppRoutes' Switch with
// one .map() instead of repeating that wrapper by hand. Routes needing
// :param-derived props (RADAR_ACTOR, RADAR_ACTOR_PAGE,
// SHARED_COLLECTION), a custom child (SEARCH_HINTS), a redirect, the
// __CHAT_ENABLED__-guarded CONVERSATIONS route, or the admin catch-all stay
// explicit in components/routes/AppRoutes.tsx.
export const SIMPLE_ROUTES: SimpleRoute[] = [
  { path: ROUTES.REPORTS, Component: ReportsIndex, props: (c) => ({ query: c.query }) },
  ...(Object.entries(REPORT_PAGES) as [ReportId, Omit<SimpleRoute, "path">][]).map(([id, page]) => ({ path: reportPath(id), ...page })),
  { path: ROUTES.REPORTS_RISK_RUBRIC, Component: RubricPage },
  { path: ROUTES.RADAR, Component: RadarPage, props: (c) => ({ query: c.query }) },
  { path: ROUTES.PROVENANCE, Component: ProvenancePage },
  { path: ROUTES.PRIVACY, Component: PrivacyPage },
  { path: ROUTES.UPDATES, Component: UpdatesPage },
  { path: ROUTES.CONNECT, Component: ConnectPage },
  { path: ROUTES.REPORTS_CROSSVIEW_CONCEPTS, Component: CrossViewPage, props: () => ({ tab: "concepts" }) },
  { path: ROUTES.REPORTS_CROSSVIEW_AUDIT, Component: CrossViewPage, props: () => ({ tab: "audit" }) },
  { path: ROUTES.REPORTS_CROSSVIEW_GLOSSARY, Component: CrossViewPage, props: () => ({ tab: "glossary" }) },
  { path: ROUTES.FEATURES, Component: FeaturesPage },
  { path: ROUTES.COLLECTIONS, Component: CollectionsPage },
  { path: ROUTES.HISTORY, Component: VisitsPage },
];
