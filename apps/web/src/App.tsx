import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useLocation, useSearchParams, Switch, Route, Redirect } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { useNavigation } from "./hooks/useNavigation";
import { usePageAnalytics } from "./hooks/usePageAnalytics";
import { usePageVisitTracking } from "./hooks/usePageVisitTracking";
import { useModifierKeyAttrs } from "./hooks/useModifierKeyAttrs";
import { useContextHints } from "./hooks/useContextHints";
import { track } from "./lib/analytics";
import { useUrlState, urlString } from "./hooks/useUrlState";
import { ROUTES, REPORT_SCOPE_CONFIG, activeNavPageFor, usesWindowScroll, type SearchScope } from "@/lib/routes";
import { SIMPLE_ROUTES, RadarPage, SharedCollectionOpener, AdminEntry, lazyRetry } from "./lib/lazyRoutes";
import { LEGACY_REDIRECTS, LEGACY_REDIRECT_PREFIXES } from "./lib/legacyRedirects";
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
import { chatEnabled } from "./lib/chatEnabled";

// Deliberately NOT in lib/lazyRoutes.tsx: this stays local to App.tsx, right
// next to the __CHAT_ENABLED__ guard it's only ever rendered behind, so the
// guard's dead-code-elimination reasoning isn't disturbed by crossing a module
// boundary. Note the chunk itself is still EMITTED in chat-off builds — this
// unconditional lazy() keeps the dynamic import reachable for Rollup — but
// nothing ever fetches it: the route is unregistered and the widget unmounted
// (verified by worktree A/B, 2026-08-12). Runtime isolation is the guarantee.
const ConversationsPage = lazy(() =>
  lazyRetry(() => import("./components/conversations/ConversationsPage")).then((m) => ({
    default: m.ConversationsPage,
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
  // Mirror Alt/Shift onto <html> for the CSS-only chevron preview and the
  // shift-click hints. Lives here because the reader and the tree sidebar
  // mount independently.
  useModifierKeyAttrs();
  // Feeds the footer's hint line from data-mod-hint / data-focus-hint markers
  // anywhere in the app. Mounted here for the same reason as the line above:
  // the reader and the tree sidebar mount independently.
  useContextHints();

  const nodeId = location === ROUTES.ATLAS ? searchParams.get("id") : null;
  // History is the default tab, so an absent (or unrecognized) ?view= lands there.
  const atlasView =
    searchParams.get("view") === "annotations"
      ? ("annotations" as const)
      : searchParams.get("view") === "glossary"
        ? ("glossary" as const)
        : ("history" as const);
  const activeNavPage = activeNavPageFor(location);

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
  // Browser-local visit log: record report / radar / constellations page views
  // with their filter state (docs, actors and searches are captured at their own
  // sites, where the human label is available). Surfaced on /history.
  usePageVisitTracking(location);

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

  const windowScroll = usesWindowScroll(location);

  // Shared props context for the SIMPLE_ROUTES table (see lib/lazyRoutes.tsx)
  // — the subset of this render's values any of those routes' props() need.
  const routeCtx = { query, mode: activeMode, navigateToNode };

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
            {SIMPLE_ROUTES.map(({ path, Component, props }) => (
              <Route key={path} path={path}>
                <Suspense fallback={<Loading />}>
                  <Component {...(props ? props(routeCtx) : {})} />
                </Suspense>
              </Route>
            ))}
            <Route path={ROUTES.RADAR_ACTOR}>
              {(params: { slug: string }) => (
                <Suspense fallback={<Loading />}>
                  <RadarPage actorSlug={params.slug} query={query} />
                </Suspense>
              )}
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
            {LEGACY_REDIRECTS.map(([from, to]) => (
              <Route key={from} path={from}>
                <Redirect to={to} replace />
              </Route>
            ))}
            {LEGACY_REDIRECT_PREFIXES.map((path) => (
              <Route key={path} path={path}>
                {/* wouter names a `:name*` wildcard param literally "tab*" (asterisk
                    included), not "tab" — using params.tab here silently dropped the
                    tab segment on every legacy URL, redirecting e.g. /library/glossary
                    to bare /reports/crossview instead of /reports/crossview/glossary. */}
                {(params: { "tab*"?: string }) => (
                  <Redirect to={`${ROUTES.REPORTS_CROSSVIEW}${params["tab*"] ? `/${params["tab*"]}` : ""}`} replace />
                )}
              </Route>
            ))}
            <Route path={ROUTES.SHARED_COLLECTION}>
              {(params: { id: string }) => (
                <Suspense fallback={<Loading />}>
                  <SharedCollectionOpener id={params.id} />
                </Suspense>
              )}
            </Route>
            {/* __CHAT_ENABLED__ (bare, build-time define) MUST stay the outer
                guard here — it's what lets the minifier prove this whole
                render branch dead and strip it out of chat-off builds (the
                ConversationsPage chunk is still emitted — see the lazy() note
                above — but never fetched). chatEnabled() alone is a function call the
                minifier can't evaluate at build time, so chat would ship even
                when disabled. Do not "simplify" this to chatEnabled() alone.
                `!preview` is also load-bearing: ConversationsPage calls the
                non-optional useChatOpen(), and the preview shell
                (PreviewGate.tsx) mounts <App/> without a ChatOpenProvider —
                same reasoning as the ChatWidget/ProfileButton `!preview`
                guards below, just needed one route earlier since this one is
                reachable by direct URL even though nothing links to it in
                preview. */}
            {__CHAT_ENABLED__ && chatEnabled() && !preview && (
              <Route path={ROUTES.CONVERSATIONS}>
                <Suspense fallback={<Loading />}>
                  <ConversationsPage />
                </Suspense>
              </Route>
            )}
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
      {/* __CHAT_ENABLED__ (bare, build-time define) MUST stay the outer guard
          — see the comment on the /conversations route above; same reasoning
          applies to the widget mount. */}
      {__CHAT_ENABLED__ && chatEnabled() && !preview && <ChatWidget />}
    </div>
  );
}
