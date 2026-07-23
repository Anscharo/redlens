// @vitest-environment jsdom
// Smoke test only (per test-plan): App.tsx is the shell (routing/layout/URL
// sync) — its route components, search hook (which spins up a real search
// Worker), and data-fetching children (Footer, PreviewBanner) are mocked so
// this test can mount the shell in jsdom without a worker or network.
import { it, expect, describe, afterEach, vi } from "vitest";
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
vi.mock("./DevPanel", () => ({ DevPanel: () => <div data-testid="dev-panel" /> }));
vi.mock("./components/Footer", () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock("./components/chat/ChatWidget", () => ({ ChatWidget: () => <div data-testid="chat-widget" /> }));
vi.mock("./components/preview/PreviewBanner", () => ({ PreviewBanner: () => null }));

import App from "./App";

function wrap(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("mounts the shell on the home route: search bar, footer, and the home page outlet", async () => {
    render(<App />, { wrapper: wrap("/") });

    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    // Chat is disabled in the test build (__CHAT_ENABLED__ = false).
    expect(screen.queryByTestId("chat-widget")).toBeNull();
  });

  it("renders the atlas reader route", async () => {
    render(<App />, { wrapper: wrap("/atlas?id=some-uuid") });
    expect(await screen.findByTestId("atlas-view")).toBeInTheDocument();
  });
});
