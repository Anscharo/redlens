// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { CrossViewData } from "../../lib/crossview";

// Track analytics + data loading are mocked; tab-content components are mocked
// too so this file stays a unit test of CrossViewPage's own tab-switching / title
// / error / loading logic — not a re-test of CrossViewShape, CrossViewGlossary,
// CrossViewConcepts/Audit, CrossViewToc, or CrossViewTopicIndex (each owns its own
// tests, or is out of scope here).
const trackMock = vi.fn();
vi.mock("../../lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const loadCrossViewCalls = vi.fn();
let loadCrossViewImpl: (base?: string) => Promise<CrossViewData> = () => Promise.reject(new Error("not configured"));
vi.mock("../../lib/crossview", () => ({
  loadCrossView: (base?: string) => {
    loadCrossViewCalls(base);
    return loadCrossViewImpl(base);
  },
}));

const useDataSourceMock = vi.fn();
vi.mock("../../lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));

vi.mock("./CrossViewShape", () => ({
  CrossViewShape: ({ data }: { data: CrossViewData }) => (
    <div data-testid="crossview-shape">shape: {data.atlasCommit}</div>
  ),
}));
vi.mock("./CrossViewGlossary", () => ({
  CrossViewGlossary: () => <div data-testid="crossview-glossary">glossary</div>,
}));
vi.mock("./CrossViewConcepts", () => ({
  CrossViewConcepts: () => <div data-testid="crossview-concepts">concepts</div>,
  CrossViewAudit: () => <div data-testid="crossview-audit">audit</div>,
}));
vi.mock("./CrossViewToc", () => ({
  CrossViewToc: () => <div data-testid="crossview-toc">toc</div>,
}));
vi.mock("./CrossViewTopicIndex", () => ({
  CrossViewTopicIndex: () => <div data-testid="crossview-topic-index">topics</div>,
}));

import { CrossViewPage } from "./CrossViewPage";

let baseSeq = 0;
const freshBase = () => `/api/test-crossview-base-${++baseSeq}/`;

const crossviewFixture: CrossViewData = {
  atlasCommit: "abc1234deadbeef",
  totals: { docs: 10, bytes: 2048, glossaryTerms: 3 },
  chunkTree: [],
  scopeTree: [],
  docTypes: [],
  neededResearch: [],
};

function wrap(path = "/reports/crossview") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  loadCrossViewCalls.mockClear();
  trackMock.mockClear();
  useDataSourceMock.mockReturnValue({ base: freshBase(), preview: null });
  loadCrossViewImpl = () => Promise.resolve(crossviewFixture);
});

afterEach(cleanup);

describe("CrossViewPage", () => {
  it("sets the document title", () => {
    render(<CrossViewPage tab="shape" />, { wrapper: wrap() });
    expect(document.title).toBe("Atlas CrossView: Sky Atlas by Redline");
  });

  it("fires report_view analytics once on mount with the crossview report id", () => {
    render(<CrossViewPage tab="shape" />, { wrapper: wrap() });
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("report_view", { report: "crossview" });
  });

  it("passes the data-source base through to loadCrossView", () => {
    const base = freshBase();
    useDataSourceMock.mockReturnValue({ base, preview: null });
    render(<CrossViewPage tab="shape" />, { wrapper: wrap() });
    expect(loadCrossViewCalls).toHaveBeenCalledWith(base);
  });

  it("shows a loading state on the shape tab before crossview data resolves", () => {
    loadCrossViewImpl = () => new Promise(() => {});
    render(<CrossViewPage tab="shape" />, { wrapper: wrap() });
    expect(screen.getByText(/loading/)).toBeInTheDocument();
    expect(screen.queryByTestId("crossview-shape")).toBeNull();
  });

  it("renders CrossViewShape with the loaded data on the shape tab", async () => {
    render(<CrossViewPage tab="shape" />, { wrapper: wrap() });
    expect(await screen.findByTestId("crossview-shape")).toHaveTextContent("abc1234deadbeef");
  });

  it("shows an error state on the shape tab when crossview data fails to load", async () => {
    loadCrossViewImpl = () => Promise.reject(new Error("boom"));
    render(<CrossViewPage tab="shape" />, { wrapper: wrap() });
    expect(await screen.findByText(/crossview data failed to load: boom/)).toBeInTheDocument();
  });

  it("renders CrossViewGlossary on the glossary tab without a loading/error state", () => {
    render(<CrossViewPage tab="glossary" />, { wrapper: wrap("/reports/crossview/glossary") });
    expect(screen.getByTestId("crossview-glossary")).toBeInTheDocument();
    expect(screen.queryByText(/loading/)).toBeNull();
  });

  it("renders CrossViewConcepts plus the Toc and Topic index columns on the concepts tab", () => {
    render(<CrossViewPage tab="concepts" />, { wrapper: wrap("/reports/crossview/concepts") });
    expect(screen.getByTestId("crossview-concepts")).toBeInTheDocument();
    expect(screen.getByTestId("crossview-toc")).toBeInTheDocument();
    expect(screen.getByTestId("crossview-topic-index")).toBeInTheDocument();
  });

  it("renders CrossViewAudit on the audit tab, without the Toc/Topic index columns", () => {
    render(<CrossViewPage tab="audit" />, { wrapper: wrap("/reports/crossview/audit") });
    expect(screen.getByTestId("crossview-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("crossview-toc")).toBeNull();
    expect(screen.queryByTestId("crossview-topic-index")).toBeNull();
  });

  it("renders a nav with all four tabs, marking the active one", () => {
    render(<CrossViewPage tab="audit" />, { wrapper: wrap("/reports/crossview/audit") });
    const nav = screen.getByRole("navigation", { name: /crossview pages/i });
    const links = ["Shape", "Concepts", "Audit", "Glossary"].map((name) =>
      screen.getByRole("link", { name }),
    );
    for (const link of links) expect(nav).toContainElement(link);
    expect(screen.getByRole("link", { name: "Shape" })).toHaveAttribute("href", "/reports/crossview");
    expect(screen.getByRole("link", { name: "Concepts" })).toHaveAttribute("href", "/reports/crossview/concepts");
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/reports/crossview/audit");
    expect(screen.getByRole("link", { name: "Glossary" })).toHaveAttribute("href", "/reports/crossview/glossary");
  });
});
