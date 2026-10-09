// @vitest-environment jsdom
// Smoke test only (per test-plan): App.tsx is the shell (routing/layout/URL
// sync) — its route components, search hook (which spins up a real search
// Worker), and data-fetching children (Footer, PreviewBanner) are mocked so
// this test can mount the shell in jsdom without a worker or network.
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Mutable so a test can put a query in the box; reset in beforeEach.
const searchInput = vi.hoisted(() => ({ query: "", searchAnyway: (): boolean => false }));
vi.mock("./hooks/useSearchInput", () => ({
  useSearchInput: () => ({
    query: searchInput.query,
    activeMode: "broad",
    isMixed: false,
    inputRef: { current: null },
    handleChange: vi.fn(),
    clearQuery: vi.fn(),
    wrapModeClick: vi.fn(),
    broadSearch: vi.fn(),
    state: { status: "idle" },
    handleHintClick: vi.fn(),
    recentSearches: [],
    selectRecent: vi.fn(),
    searchAnyway: searchInput.searchAnyway,
  }),
}));
vi.mock("./hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToNode: vi.fn(), handleViewChange: vi.fn() }),
  useNavigateToNode: () => vi.fn(),
}));
vi.mock("./hooks/usePageAnalytics", () => ({ usePageAnalytics: vi.fn() }));
vi.mock("./hooks/usePageVisitTracking", () => ({ usePageVisitTracking: vi.fn() }));
vi.mock("./components/SearchBar", () => ({
  SearchBar: ({ onSubmit }: { onSubmit: () => void }) => (
    <button type="button" data-testid="search-bar" onClick={onSubmit}>submit</button>
  ),
}));
vi.mock("./components/SearchResults", () => ({
  SearchResults: () => (
    <div data-testid="search-results">
      <a className="search-result-link" href="/atlas?id=hit">hit</a>
    </div>
  ),
}));
vi.mock("./components/SearchHints", () => ({
  SearchHintsPage: ({ onHintClick }: { onHintClick: (q: string) => void }) => (
    <button type="button" data-testid="search-hints" onClick={() => onHintClick("fees")}>hint</button>
  ),
}));
vi.mock("./lib/radarRoute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/radarRoute")>()),
  RadarActorRoute: ({ slug, page }: { slug: string; page?: string }) => (
    <div data-testid="radar-actor">{`${slug}/${page ?? ""}`}</div>
  ),
}));
vi.mock("./components/collections/SharedCollectionOpener", () => ({
  SharedCollectionOpener: ({ id }: { id: string }) => <div data-testid="shared-collection">{id}</div>,
}));
vi.mock("./components/atlas/AtlasView", () => ({ AtlasView: () => <div data-testid="atlas-view" /> }));
vi.mock("./components/tree/TreeSidebar", () => ({ TreeSidebar: () => <div data-testid="tree-sidebar" /> }));
vi.mock("./components/NodeContent", () => ({ prefetchNodeContent: vi.fn() }));
vi.mock("./components/HomePage", () => ({ HomePage: () => <div data-testid="home-page">home</div> }));
vi.mock("./components/crossview/CrossViewPage", () => ({
  CrossViewPage: ({ tab }: { tab: string }) => <div data-testid="crossview-page">crossview:{tab}</div>,
}));
vi.mock("./DevPanel", () => ({ DevPanel: () => <div data-testid="dev-panel" /> }));
vi.mock("./components/Footer", () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock("./components/chat/ChatWidget", () => ({ ChatWidget: () => <div data-testid="chat-widget" /> }));
vi.mock("./components/preview/PreviewBanner", () => ({ PreviewBanner: () => null }));
// OnchainAddressesReport and ModFrequencyReport (unlike the other report routes
// above) are left real — they're the route-mount smoke tests below — so their
// data loaders need a resolved value; empty is enough to clear the loading state
// and reach the real component. loadDocs serves both.
vi.mock("./lib/docs", () => ({ loadDocs: () => Promise.resolve({}) }));
vi.mock("./lib/addresses", () => ({ loadAddresses: () => Promise.resolve({}) }));
vi.mock("@/lib/balances", () => ({
  loadBalances: () => Promise.resolve({ lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {} }),
  requestBalancesRefresh: () => Promise.resolve({ lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {} }),
  // The shared <Address> pill reads these through sharedBalances.ts.
  peekCachedBalances: () => undefined,
  loadBalancesCached: () => Promise.resolve({ lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {} }),
}));
vi.mock("@/lib/history", () => ({
  loadModCounts: () => Promise.resolve([]),
  loadModTimeline: () => Promise.resolve([]),
}));

import App from "./App";

function wrap(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

// Drawer (part of the shell) reads window.matchMedia on mount; jsdom lacks it.
// Without this stub App throws during render, ErrorBoundary swallows it, and the
// mocked outer content below still renders — so the test would pass while App is
// actually crashing. Stub it so the shell mounts for real.
beforeEach(() => {
  searchInput.query = "";
  searchInput.searchAnyway = () => false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("mounts the shell on the home route: search bar, footer, and the home page outlet", async () => {
    render(<App />, { wrapper: wrap("/") });

    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    // Chat is disabled in the test build (__CHAT_ENABLED__ = false).
    expect(screen.queryByTestId("chat-widget")).toBeNull();
    // Guard: the shell mounted for real, not into an ErrorBoundary fallback.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the atlas reader route", async () => {
    render(<App />, { wrapper: wrap("/atlas?id=some-uuid") });
    expect(await screen.findByTestId("atlas-view")).toBeInTheDocument();
  });

  it("renders the privacy policy route", async () => {
    render(<App />, { wrapper: wrap("/privacy") });
    // PrivacyPage is a real (unmocked) lazy route — its h1 proves the Route mounts.
    expect(await screen.findByRole("heading", { level: 1, name: /privacy policy/i })).toBeInTheDocument();
  });

  it("renders the on-chain addresses report route", async () => {
    render(<App />, { wrapper: wrap("/reports/onchain-addresses") });
    // OnchainAddressesReport is a real (unmocked) lazy route — its h1 proves the Route mounts.
    expect(await screen.findByRole("heading", { level: 1, name: "On-Chain Addresses" })).toBeInTheDocument();
  });

  it("renders the modification frequency report route", async () => {
    render(<App />, { wrapper: wrap("/reports/mod-frequency") });
    // ModFrequencyReport is a real (unmocked) lazy route — its heading proves the Route mounts.
    expect(await screen.findByRole("heading", { level: 1, name: "Modification Frequency" })).toBeInTheDocument();
  });

  it("renders the crossview shape tab at /reports/crossview", async () => {
    render(<App />, { wrapper: wrap("/reports/crossview") });
    expect(await screen.findByTestId("crossview-page")).toHaveTextContent("crossview:shape");
  });

  it("renders the crossview glossary tab at its own route, not the shared shape tab", async () => {
    // Guards the SIMPLE_ROUTES table (src/lib/lazyRoutes.tsx): all four
    // CrossView routes share one Component but each supplies its own `tab`
    // via props() — this would stay green even if every entry accidentally
    // shared one closure, so it's paired with the shape-tab test above.
    render(<App />, { wrapper: wrap("/reports/crossview/glossary") });
    expect(await screen.findByTestId("crossview-page")).toHaveTextContent("crossview:glossary");
  });

  it("redirects the removed Contents tab URL to /reports/crossview", async () => {
    const { hook, history } = memoryLocation({ path: "/reports/crossview/contents", record: true });
    render(<App />, { wrapper: ({ children }) => <Router hook={hook}>{children}</Router> });
    await screen.findByTestId("crossview-page");
    expect(history?.at(-1)).toBe("/reports/crossview");
  });

  it("redirects the legacy /library/:tab* URL to /reports/crossview/:tab", async () => {
    const { hook, history } = memoryLocation({ path: "/library/glossary", record: true });
    render(<App />, { wrapper: ({ children }) => <Router hook={hook}>{children}</Router> });
    await screen.findByTestId("crossview-page");
    expect(history?.at(-1)).toBe("/reports/crossview/glossary");
  });

  it("redirects the legacy bare /library URL to /reports/crossview", async () => {
    const { hook, history } = memoryLocation({ path: "/library", record: true });
    render(<App />, { wrapper: ({ children }) => <Router hook={hook}>{children}</Router> });
    await screen.findByTestId("crossview-page");
    expect(history?.at(-1)).toBe("/reports/crossview");
  });

  it("redirects the former /reports/library URL to /reports/crossview", async () => {
    const { hook, history } = memoryLocation({ path: "/reports/library/concepts", record: true });
    render(<App />, { wrapper: ({ children }) => <Router hook={hook}>{children}</Router> });
    await screen.findByTestId("crossview-page");
    expect(history?.at(-1)).toBe("/reports/crossview/concepts");
  });
});

describe("App routes", () => {
  function renderAt(path: string) {
    const { hook, history } = memoryLocation({ path, record: true });
    render(<App />, { wrapper: ({ children }) => <Router hook={hook}>{children}</Router> });
    return history;
  }

  it("shows search results on the home route once there is a query", async () => {
    searchInput.query = "fees";
    renderAt("/");
    expect(await screen.findByTestId("search-results")).toBeInTheDocument();
    expect(screen.queryByTestId("home-page")).toBeNull();
  });

  it("opens the dev panel for a __dev query", async () => {
    searchInput.query = "__dev";
    renderAt("/");
    expect(await screen.findByTestId("dev-panel")).toBeInTheDocument();
  });

  it("runs a search hint's example search from /search-hints", async () => {
    const history = renderAt("/search-hints");
    fireEvent.click(await screen.findByTestId("search-hints"));
    expect(history?.at(-1)).toMatch(/^\/\?q=fees/);
  });

  it("passes the slug and subpage to the radar actor route", async () => {
    renderAt("/radar/spark/info");
    expect(await screen.findByTestId("radar-actor")).toHaveTextContent("spark/info");
  });

  it("opens a shared collection from its link", async () => {
    renderAt("/c/abc123");
    expect(await screen.findByTestId("shared-collection")).toHaveTextContent("abc123");
  });
});

describe("App search submit", () => {
  it("focuses the first result when the search has nothing to re-run", async () => {
    searchInput.query = "fees";
    render(<App />, { wrapper: wrap("/") });
    const link = within(await screen.findByTestId("search-results")).getByRole("link");
    fireEvent.click(screen.getByTestId("search-bar"));
    expect(link).toHaveFocus();
  });

  it("leaves focus alone when there is no result to move to", () => {
    render(<App />, { wrapper: wrap("/") });
    const before = document.activeElement;
    fireEvent.click(screen.getByTestId("search-bar"));
    expect(document.activeElement).toBe(before);
  });

  it("does not move focus when Enter re-ran a held search", async () => {
    searchInput.query = "fees";
    searchInput.searchAnyway = () => true;
    render(<App />, { wrapper: wrap("/") });
    const link = within(await screen.findByTestId("search-results")).getByRole("link");
    fireEvent.click(screen.getByTestId("search-bar"));
    expect(link).not.toHaveFocus();
  });
});
