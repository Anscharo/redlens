import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { useNavigation } from "./hooks/useNavigation";
import { useUrlState, urlString } from "./hooks/useUrlState";
import { ROUTES, type NavPage, type SearchScope } from "./lib/routes";
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
import { ChatWidget } from "./components/chat/ChatWidget";

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
const ActiveDataReport = lazy(() =>
  lazyRetry(() => import("./components/reports/ActiveDataReport")).then((m) => ({ default: m.ActiveDataReport })),
);
const RewardsReport = lazy(() =>
  lazyRetry(() => import("./components/reports/RewardsReport")).then((m) => ({ default: m.RewardsReport })),
);
const ProcessesReport = lazy(() =>
  lazyRetry(() => import("./components/reports/ProcessesReport")).then((m) => ({ default: m.ProcessesReport })),
);
const ReportsIndex = lazy(() =>
  lazyRetry(() => import("./components/ReportsIndex")).then((m) => ({ default: m.ReportsIndex })),
);
const ProvenancePage = lazy(() =>
  lazyRetry(() => import("./components/ProvenancePage")).then((m) => ({ default: m.ProvenancePage })),
);
const RadarPage = lazy(() =>
  lazyRetry(() => import("./components/radar/RadarPage")).then((m) => ({ default: m.RadarPage })),
);
const AdminEntry = lazy(() =>
  lazyRetry(() => import("./admin/AdminEntry")).then((m) => ({ default: m.AdminEntry })),
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

  const { query, activeMode, isMixed, inputRef, handleChange, clearQuery, wrapModeClick, broadSearch, state, handleHintClick } =
    useSearchInput(location, navigate, scope);
  const { navigateToNode, handleViewChange } = useNavigation({
    navigate,
    nodeId,
  });

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

  // Window-scroll mode: routes that don't need the "fixed shell, inner scroll"
  // layout opt in here. The root grows with content (min-h-dvh) and the
  // overflow-hidden wrappers are dropped, so the browser's native
  // history.scrollRestoration handles back/forward for free.
  const windowScroll =
    location.startsWith(ROUTES.REPORTS) || location.startsWith(ROUTES.RADAR);

  return (
    <div
      className={`app-shell flex flex-col pb-6 ${windowScroll ? "min-h-dvh" : "h-dvh"}`}
      style={{ background: "var(--bg)" }}
    >
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
      />
      <div className={`flex-1 flex ${windowScroll ? "" : "overflow-hidden"}`}>
        {showTree && (
          <ErrorBoundary fallback={<PanelError />}>
            <Drawer
              open={treeOpen}
              onClose={() => setTreeOpen(false)}
              defaultWidth={242}
              resizable
              minWidth={180}
              maxWidth={600}
              storageKey="redlens:tree-sidebar-width"
            >
              <TreeSidebar
                nodeId={nodeId}
                onNavigate={handleTreeNavigate}
                onShiftNavigate={setSplitId}
              />
            </Drawer>
          </ErrorBoundary>
        )}
        <div className={`flex-1 flex flex-col ${windowScroll ? "" : "overflow-hidden"}`}>
          <ErrorBoundary
            resetKey={location}
            fallback={(error) => (
              <div className="flex flex-col items-center justify-center flex-1 py-24 gap-4">
                <p className="text-sm mono" style={{ color: "var(--error-text)" }}>page failed to load</p>
                <p className="text-xs mono text-tan-3 text-center max-w-md">{error.message}</p>
              </div>
            )}
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
                onSplitChange={setSplitId}
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
                <OpFacilitatorsReport />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_ACTIVE_DATA}>
              <Suspense fallback={<Loading />}>
                <ActiveDataReport />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_REWARDS}>
              <Suspense fallback={<Loading />}>
                <RewardsReport />
              </Suspense>
            </Route>
            <Route path={ROUTES.REPORTS_PROCESSES}>
              <Suspense fallback={<Loading />}>
                <ProcessesReport onNavigate={navigateToNode} />
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
      {__CHAT_ENABLED__ && <ChatWidget />}
    </div>
  );
}
