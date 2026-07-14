import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { useNavigation } from "./hooks/useNavigation";
import { usePageAnalytics } from "./hooks/usePageAnalytics";
import { track } from "./lib/analytics";
import { useUrlState, urlString } from "./hooks/useUrlState";
import { ROUTES, REPORT_SCOPE_CONFIG, type NavPage, type SearchScope } from "./lib/routes";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { AtlasView } from "./components/atlas/AtlasView";
import { TreeSidebar } from "./components/tree/TreeSidebar";
import { Drawer } from "./components/Drawer";
import { prefetchNodeContent } from "./components/NodeContent";
import { Loading } from "./components/Loading";
import { SearchHintsPage } from "./components/SearchHints";
import { HomePage } from "./components/HomePage";
import { DevPanel } from "./DevPanel";
import { Footer } from "./components/Footer";
import { ErrorBoundary, PanelError } from "./components/ErrorBoundary";
import { isStaleChunkError } from "./lib/staleChunk";
import { ChatWidget } from "./components/chat/ChatWidget";
import { PreviewBanner } from "./components/preview/PreviewBanner";
import { useDataSource } from "./lib/dataSource";

// Retries a failed dynamic import once before propagating the error.
// Silently handles transient "Failed to fetch dynamically imported module"
// errors that occur when a chunk isn't cached yet on first navigation.
function lazyRetry<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch(() => factory());
}

const ConstellationsPage = lazy(() =>
  lazyRetry(() => import("./components/ConstellationsPage")).then((m) => ({ default: m.ConstellationsPage })),
);
const OpFacilitatorsReport = lazy(() =>
  lazyRetry(() => import("./components/reports/OpFacilitatorsReport")).then((m) => ({ default: m.OFReport })),
);
const OpGovOpsReport = lazy(() =>
  lazyRetry(() => import("./components/reports/OpGovOpsReport")).then((m) => ({ default: m.OGReport })),
);
const ActiveDataReport = lazy(() =>
  lazyRetry(() => import("./components/reports/ActiveDataReport")).then((m) => ({ default: m.ActiveDataReport })),
);
const RewardsReport = lazy(() =>
  lazyRetry(() => import("./components/reports/RewardsReport")).then((m) => ({ default: m.RewardsReport })),
);
const ProcessesReport = lazy(() =>
  lazyRetry(() => import("./components/reports/ProcessesReport")).then((m) => ({ default: m.ProcessesReport })),
);
const StaleDatesReport = lazy(() =>
  lazyRetry(() => import("./components/reports/StaleDatesReport")).then((m) => ({ default: m.StaleDatesReport })),
);
const OeaAssessmentReport = lazy(() =>
  lazyRetry(() => import("./components/reports/OeaAssessmentReport")).then((m) => ({ default: m.OeaAssessmentReport })),
);
const RiskRulesReport = lazy(() =>
  lazyRetry(() => import("./components/reports/RiskRulesReport")).then((m) => ({ default: m.RiskRulesReport })),
);
const RubricPage = lazy(() =>
  lazyRetry(() => import("./components/reports/RubricPage")).then((m) => ({ default: m.RubricPage })),
);
const ReportsIndex = lazy(() =>
  lazyRetry(() => import("./components/ReportsIndex")).then((m) => ({ default: m.ReportsIndex })),
);
const ProvenancePage = lazy(() =>
  lazyRetry(() => import("./components/ProvenancePage")).then((m) => ({ default: m.ProvenancePage })),
);
const UpdatesPage = lazy(() =>
  lazyRetry(() => import("./components/UpdatesPage")).then((m) => ({ default: m.UpdatesPage })),
);
const ConnectPage = lazy(() =>
  lazyRetry(() => import("./components/ConnectPage")).then((m) => ({ default: m.ConnectPage })),
);
const RadarPage = lazy(() =>
  lazyRetry(() => import("./components/radar/RadarPage")).then((m) => ({ default: m.RadarPage })),
);
const AdminEntry = lazy(() =>
  lazyRetry(() => import("./admin/AdminEntry")).then((m) => ({ default: m.AdminEntry })),
);
const CollectionsPage = lazy(() =>
  lazyRetry(() => import("./components/collections/CollectionsPage")).then((m) => ({ default: m.CollectionsPage })),
);
const SharedCollectionOpener = lazy(() =>
  lazyRetry(() => import("./components/collections/SharedCollectionOpener")).then((m) => ({
    default: m.SharedCollectionOpener,
  })),
);

const splitCodec = urlString(null);

prefetchNodeContent();

export default function App() {
  const [location, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  // Atlas comparison pane lives in ?split=<uuid> so shift-click + back/forward
  // restore the same side-by-side view, and the URL is shareable.
  const [splitId, setSplitId] = useUrlState("split", splitCodec);
  const [treeOpen, setTreeOpen] = useState(false);

  const nodeId = location === ROUTES.ATLAS ? searchParams.get("id") : null;
  const atlasView =
    searchParams.get("view") === "history"
      ? ("history" as const)
      : searchParams.get("view") === "glossary"
        ? ("glossary" as const)
        : ("annotations" as const);
  const activeNavPage: NavPage | null = location.startsWith(ROUTES.CONSTELLATIONS)
    ? "constellations"
    : location.startsWith(ROUTES.REPORTS)
      ? "reports"
      : location.startsWith(ROUTES.RADAR)
        ? "radar"
        : location.startsWith(ROUTES.ATLAS)
          ? "atlas"
          : null;

  const scope: SearchScope = activeNavPage ?? "atlas";
  // On a specific report page the pill shows the report's short name and the
  // box filters that report's rows (query stays in ?q= on the same route).
  const reportScopeCfg = REPORT_SCOPE_CONFIG[location];

  const { query, activeMode, isMixed, inputRef, handleChange, clearQuery, wrapModeClick, broadSearch, state, handleHintClick, recentSearches, selectRecent } =
    useSearchInput(location, navigate, scope);
  const { navigateToNode, handleViewChange } = useNavigation({
    navigate,
    nodeId,
  });

  // Analytics: init + per-route $pageview tagged with the product super property.
  usePageAnalytics(location);

  // Enter in the search box jumps focus to the first result (entity hit or doc).
  // Returns whether a result was actually focused, so SearchBar only swallows
  // the keystroke when there was somewhere to go.
  const focusFirstResult = useCallback(() => {
    const first = document.querySelector<HTMLElement>(".search-result-link");
    if (!first) return false;
    first.focus();
    return true;
  }, []);

  // Track opening a comparison pane (null → uuid transition only).
  const handleSplitChange = useCallback(
    (sid: string | null) => {
      if (sid && sid !== splitId) track("atlas_split_open", { node_id: nodeId, split_id: sid });
      else if (!sid && splitId) track("reader_split_close", { node_id: nodeId, split_id: splitId });
      setSplitId(sid);
    },
    [setSplitId, splitId, nodeId],
  );

  // Track opening a specific report (not the /reports index), deduped per report.
  const lastReport = useRef<string | null>(null);
  useEffect(() => {
    const prefix = `${ROUTES.REPORTS}/`;
    if (location.startsWith(prefix)) {
      const reportId = location.slice(prefix.length);
      if (reportId && lastReport.current !== reportId) {
        lastReport.current = reportId;
        track("report_open", { report_id: reportId });
      }
    } else {
      lastReport.current = null;
    }
  }, [location]);

  const showTree =
    location === ROUTES.HOME || location === ROUTES.ATLAS || location === ROUTES.SEARCH_HINTS;
  const handleTreeNavigate = useCallback(
    (id: string) => {
      navigateToNode(id);
      setTreeOpen(false);
    },
    [navigateToNode],
  );

  useEffect(() => {
    setTreeOpen(false);
  }, [location]);

  // In preview mode, land on the reader instead of the home/search splash so
  // pasting /preview/:id drops straight into the proposed atlas. Only the BARE
  // root redirects — searching navigates to HOME?q=… (results live there), and
  // bouncing that back to the reader would drop the query + loop.
  const { preview } = useDataSource();
  useEffect(() => {
    if (preview && location === ROUTES.HOME && !searchParams.get("q")) {
      navigate(ROUTES.ATLAS, { replace: true });
    }
  }, [preview, location, searchParams, navigate]);

  // Window-scroll mode: routes that don't need the "fixed shell, inner scroll"
  // layout opt in here. The root grows with content (min-h-dvh) and the
  // overflow-hidden wrappers are dropped, so the browser's native
  // history.scrollRestoration handles back/forward for free.
  const windowScroll =
    location.startsWith(ROUTES.REPORTS) ||
    location.startsWith(ROUTES.RADAR) ||
    location === ROUTES.COLLECTIONS;

  return (
    <div
      className={`app-shell flex flex-col pb-6 ${windowScroll ? "min-h-dvh" : "h-dvh"}`}
      style={{ background: "var(--bg)" }}
    >
      <PreviewBanner />
      <SearchBar
        inputRef={inputRef}
        query={query}
        mode={activeMode}
        isMixed={isMixed}
        onChange={handleChange}
        onClear={clearQuery}
        onSetMode={wrapModeClick}
        activePage={activeNavPage}
        scope={scope}
        scopeCfg={reportScopeCfg}
        showModes={scope === "atlas" || !!reportScopeCfg}
        recentSearches={recentSearches}
        onRecentSelect={selectRecent}
        onSubmit={focusFirstResult}
      />
      <div className={`flex-1 flex ${windowScroll ? "" : "overflow-hidden"}`}>
        {showTree && (
          <ErrorBoundary fallback={(error) => <PanelError error={error} />}>
            <Drawer
              open={treeOpen}
              onClose={() => setTreeOpen(false)}
              defaultWidth={280}
              resizable
              minWidth={180}
              maxWidth={600}
              storageKey="redline-sky-atlas:tree-sidebar-width"
            >
              <TreeSidebar
                nodeId={nodeId}
                onNavigate={handleTreeNavigate}
                onShiftNavigate={handleSplitChange}
              />
            </Drawer>
          </ErrorBoundary>
        )}
        <div className={`flex-1 flex flex-col ${windowScroll ? "" : "overflow-hidden"}`}>
          <ErrorBoundary
            resetKey={location}
            fallback={(error) =>
              isStaleChunkError(error) ? (
                <PanelError error={error} />
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 py-24 gap-4">
                  <p className="text-sm mono" style={{ color: "var(--error-text)" }}>page failed to load</p>
                  <p className="text-xs mono text-tan-3 text-center max-w-md">{error.message}</p>
                </div>
              )
            }
          >
          <Switch>
            <Route path={ROUTES.HOME}>
              {query.startsWith("__dev") ? (
                <DevPanel query={query} />
              ) : query ? (
                <SearchResults
                  state={state}
                  query={query}
                  mode={activeMode}
                  onHintClick={handleHintClick}
                  onBroadSearch={broadSearch}
                />
              ) : (
                <HomePage />
              )}
            </Route>
            <Route path={ROUTES.ATLAS}>
              <AtlasView
                id={nodeId ?? ""}
                onNavigate={navigateToNode}
                view={atlasView}
                onViewChange={handleViewChange}
                splitId={splitId}
                onSplitChange={handleSplitChange}
                onOpenTree={() => setTreeOpen(true)}
              />
            </Route>
            <Route path={ROUTES.REPORTS}>
              <Suspense fallback={<Loading />}>
                <ReportsIndex query={query} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_OF_RESPONSIBILITIES}>
              <Suspense fallback={<Loading />}>
                <OpFacilitatorsReport query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_GOVOPS_RESPONSIBILITIES}>
              <Suspense fallback={<Loading />}>
                <OpGovOpsReport query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_ACTIVE_DATA}>
              <Suspense fallback={<Loading />}>
                <ActiveDataReport query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_REWARDS}>
              <Suspense fallback={<Loading />}>
                <RewardsReport query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_STALE_DATES}>
              <Suspense fallback={<Loading />}>
                <StaleDatesReport query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_OEA_ASSESSMENT}>
              <Suspense fallback={<Loading />}>
                <OeaAssessmentReport query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_RISK_RULES}>
              <Suspense fallback={<Loading />}>
                <RiskRulesReport query={query} mode={activeMode} onNavigate={navigateToNode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_RISK_RUBRIC}>
              <Suspense fallback={<Loading />}>
                <RubricPage />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_PROCESSES}>
              <Suspense fallback={<Loading />}>
                <ProcessesReport onNavigate={navigateToNode} query={query} mode={activeMode} />
              </Suspense>
            </Route>
            <Route path={ROUTES.CONSTELLATIONS}>
              <Suspense fallback={<Loading />}>
                <ConstellationsPage query={query} />
              </Suspense>
            </Route>
            <Route path={ROUTES.RADAR_ACTOR}>
              {(params: { slug: string }) => (
                <Suspense fallback={<Loading />}>
                  <RadarPage actorSlug={params.slug} query={query} />
                </Suspense>
              )}
            </Route>
            <Route path={ROUTES.RADAR}>
              <Suspense fallback={<Loading />}>
                <RadarPage query={query} />
              </Suspense>
            </Route>
            <Route path={ROUTES.SEARCH_HINTS}>
              <SearchHintsPage
                onHintClick={(q) => {
                  const np = new URLSearchParams();
                  if (q) np.set("q", q);
                  if (splitId) np.set("split", splitId);
                  const qs = np.toString();
                  navigate(qs ? `${ROUTES.HOME}?${qs}` : ROUTES.HOME);
                }}
              />
            </Route>
            <Route path={ROUTES.PROVENANCE}>
              <Suspense fallback={<Loading />}>
                <ProvenancePage />
              </Suspense>
            </Route>
            <Route path={ROUTES.UPDATES}>
              <Suspense fallback={<Loading />}>
                <UpdatesPage />
              </Suspense>
            </Route>
            <Route path={ROUTES.CONNECT}>
              <Suspense fallback={<Loading />}>
                <ConnectPage />
              </Suspense>
            </Route>
            <Route path={ROUTES.COLLECTIONS}>
              <Suspense fallback={<Loading />}>
                <CollectionsPage />
              </Suspense>
            </Route>
            <Route path={ROUTES.SHARED_COLLECTION}>
              {(params: { id: string }) => (
                <Suspense fallback={<Loading />}>
                  <SharedCollectionOpener id={params.id} />
                </Suspense>
              )}
            </Route>
            <Route path="/admin/:rest*">
              <Suspense fallback={<Loading />}>
                <AdminEntry />
              </Suspense>
            </Route>
          </Switch>
          </ErrorBoundary>
        </div>
      </div>
      <Footer />
      {__CHAT_ENABLED__ && !preview && <ChatWidget />}
    </div>
  );
}
