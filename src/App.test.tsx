// @vitest-environment jsdom
// Smoke test only (per test-plan): App.tsx is the shell (routing/layout/URL
// sync) — its route components, search hook (which spins up a real search
// Worker), and data-fetching children (Footer, PreviewBanner) are mocked so
// this test can mount the shell in jsdom without a worker or network.
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("./hooks/useSearchInput", () => ({
  useSearchInput: () => ({
    query: "",
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
  }),
}));
vi.mock("./hooks/useNavigation", () => ({
  useNavigation: () => ({ navigateToNode: vi.fn(), handleViewChange: vi.fn() }),
}));
vi.mock("./hooks/usePageAnalytics", () => ({ usePageAnalytics: vi.fn() }));
vi.mock("./hooks/useReportVisitTracking", () => ({ useReportVisitTracking: vi.fn() }));
vi.mock("./components/SearchBar", () => ({ SearchBar: () => <div data-testid="search-bar" /> }));
vi.mock("./components/SearchResults", () => ({ SearchResults: () => <div data-testid="search-results" /> }));
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
// ModFrequencyReport is a real (unmocked) lazy route (see below) — stub its
// data so it doesn't hit the network.
vi.mock("./lib/docs", () => ({ loadDocs: () => Promise.resolve({}) }));
vi.mock("./lib/history", () => ({
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

  it("renders the modification frequency report route", async () => {
    render(<App />, { wrapper: wrap("/reports/mod-frequency") });
    // ModFrequencyReport is a real (unmocked) lazy route — its heading proves the Route mounts.
    expect(await screen.findByRole("heading", { level: 1, name: "Modification Frequency" })).toBeInTheDocument();
  });

  it("renders the crossview shape tab at /reports/crossview", async () => {
    render(<App />, { wrapper: wrap("/reports/crossview") });
    expect(await screen.findByTestId("crossview-page")).toHaveTextContent("crossview:shape");
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
