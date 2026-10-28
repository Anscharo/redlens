import { useLocation } from "wouter";
import { useSearchInput } from "./hooks/useSearchInput";
import { usePageAnalytics } from "./hooks/usePageAnalytics";
import { usePageVisitTracking } from "./hooks/usePageVisitTracking";
import { useReportOpenTracking } from "./hooks/useReportOpenTracking";
import { usePreviewShell } from "./hooks/usePreviewShell";
import { useTreeDrawer } from "./hooks/useTreeDrawer";
import { useModifierKeyAttrs } from "./hooks/useModifierKeyAttrs";
import { useContextHints } from "./hooks/useContextHints";
import { activeNavPageFor, usesWindowScroll, type SearchScope } from "@/lib/routes";
import { AppHeader } from "./components/AppHeader";
import { HomeLink } from "./components/HomeLink";
import { NavBar } from "./components/NavBar";
import { ShellSearch } from "./components/ShellSearch";
import { TreeDrawer } from "./components/tree/TreeDrawer";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { AppRoutes } from "./components/routes/AppRoutes";
import { prefetchNodeContent } from "./components/NodeContent";
import { Footer } from "./components/Footer";
import { ChatWidget } from "./components/chat/ChatWidget";
import { PreviewBanner } from "./components/preview/PreviewBanner";
import { chatEnabled } from "./lib/chatEnabled";

prefetchNodeContent();

// Enter in the search box jumps focus to the first result (entity hit or doc).
// Returns whether a result was actually focused, so the search input only swallows
// the keystroke when there was somewhere to go.
function focusFirstResult(): boolean {
  const first = document.querySelector<HTMLElement>(".search-result-link");
  if (!first) return false;
  first.focus();
  return true;
}

export default function App() {
  const [location, navigate] = useLocation();
  const tree = useTreeDrawer(location);
  // Mirror Alt/Shift onto <html> for the CSS-only chevron preview and the
  // shift-click hints, and feed the footer's hint line from data-mod-hint /
  // data-focus-hint markers. Both live here because the reader and the tree
  // sidebar mount independently.
  useModifierKeyAttrs();
  useContextHints();

  const activeNavPage = activeNavPageFor(location);
  const scope: SearchScope = activeNavPage ?? "atlas";
  const search = useSearchInput(location, navigate, scope);

  // Analytics: init + per-route $pageview tagged with the product super property.
  usePageAnalytics(location);
  // Browser-local visit log of report / radar page views with their filter
  // state, surfaced on /history. Docs, actors and searches are captured at
  // their own sites, where the human label is available.
  usePageVisitTracking(location);
  useReportOpenTracking(location);
  const setPreviewTab = usePreviewShell(location, navigate);

  const windowScroll = usesWindowScroll(location);

  return (
    <div
      className={`app-shell flex flex-col pb-6 ${windowScroll ? "min-h-dvh" : "h-dvh"}`}
      style={{ background: "var(--bg)" }}
    >
      <PreviewBanner onTabTitle={setPreviewTab} />
      <AppHeader>
        <HomeLink />
        <NavBar activePage={activeNavPage} />
        <ShellSearch search={search} scope={scope} onSubmit={() => search.searchAnyway() || focusFirstResult()} />
      </AppHeader>
      <div className={`flex-1 flex ${windowScroll ? "" : "overflow-hidden"}`}>
        <TreeDrawer open={tree.open} onClose={tree.closeTree} />
        <div className={`flex-1 flex flex-col ${windowScroll ? "" : "overflow-hidden"}`}>
          <RouteErrorBoundary>
            <AppRoutes search={search} onOpenTree={tree.openTree} />
          </RouteErrorBoundary>
        </div>
      </div>
      <Footer />
      {/* __CHAT_ENABLED__ (bare, build-time define) MUST stay the outer guard;
          the comment on the /conversations route in components/routes/AppRoutes.tsx
          explains why, and the same reasoning applies to the widget mount. The
          widget also runs inside a preview: it needs no ChatOpenProvider
          (useChatOpenOptional), and its page context names the preview so
          "this PR" resolves. */}
      {__CHAT_ENABLED__ && chatEnabled() && <ChatWidget />}
    </div>
  );
}
