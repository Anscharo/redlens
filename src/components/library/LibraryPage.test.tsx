// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { LibraryData } from "../../lib/library";

// Track analytics + data loading are mocked; tab-content components are mocked
// too so this file stays a unit test of LibraryPage's own tab-switching / title
// / error / loading logic — not a re-test of LibraryShape, LibraryGlossary,
// LibraryConcepts/Audit, LibraryToc, or LibraryTopicIndex (each owns its own
// tests, or is out of scope here).
const trackMock = vi.fn();
vi.mock("../../lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const loadLibraryCalls = vi.fn();
let loadLibraryImpl: (base?: string) => Promise<LibraryData> = () => Promise.reject(new Error("not configured"));
vi.mock("../../lib/library", () => ({
  loadLibrary: (base?: string) => {
    loadLibraryCalls(base);
    return loadLibraryImpl(base);
  },
}));

const useDataSourceMock = vi.fn();
vi.mock("../../lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));

vi.mock("./LibraryShape", () => ({
  LibraryShape: ({ data }: { data: LibraryData }) => (
    <div data-testid="library-shape">shape: {data.atlasCommit}</div>
  ),
}));
vi.mock("./LibraryGlossary", () => ({
  LibraryGlossary: () => <div data-testid="library-glossary">glossary</div>,
}));
vi.mock("./LibraryConcepts", () => ({
  LibraryConcepts: () => <div data-testid="library-concepts">concepts</div>,
  LibraryAudit: () => <div data-testid="library-audit">audit</div>,
}));
vi.mock("./LibraryToc", () => ({
  LibraryToc: () => <div data-testid="library-toc">toc</div>,
}));
vi.mock("./LibraryTopicIndex", () => ({
  LibraryTopicIndex: () => <div data-testid="library-topic-index">topics</div>,
}));

import { LibraryPage } from "./LibraryPage";

let baseSeq = 0;
const freshBase = () => `/api/test-library-base-${++baseSeq}/`;

const libraryFixture: LibraryData = {
  atlasCommit: "abc1234deadbeef",
  totals: { docs: 10, bytes: 2048, glossaryTerms: 3 },
  chunkTree: [],
  scopeTree: [],
  docTypes: [],
  neededResearch: [],
};

function wrap(path = "/reports/library") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  loadLibraryCalls.mockClear();
  trackMock.mockClear();
  useDataSourceMock.mockReturnValue({ base: freshBase(), preview: null });
  loadLibraryImpl = () => Promise.resolve(libraryFixture);
});

afterEach(cleanup);

describe("LibraryPage", () => {
  it("sets the document title", () => {
    render(<LibraryPage tab="shape" />, { wrapper: wrap() });
    expect(document.title).toBe("Atlas Library: Sky Atlas by Redline");
  });

  it("fires report_view analytics once on mount with the library report id", () => {
    render(<LibraryPage tab="shape" />, { wrapper: wrap() });
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("report_view", { report: "library" });
  });

  it("passes the data-source base through to loadLibrary", () => {
    const base = freshBase();
    useDataSourceMock.mockReturnValue({ base, preview: null });
    render(<LibraryPage tab="shape" />, { wrapper: wrap() });
    expect(loadLibraryCalls).toHaveBeenCalledWith(base);
  });

  it("shows a loading state on the shape tab before library data resolves", () => {
    loadLibraryImpl = () => new Promise(() => {});
    render(<LibraryPage tab="shape" />, { wrapper: wrap() });
    expect(screen.getByText(/loading/)).toBeInTheDocument();
    expect(screen.queryByTestId("library-shape")).toBeNull();
  });

  it("renders LibraryShape with the loaded data on the shape tab", async () => {
    render(<LibraryPage tab="shape" />, { wrapper: wrap() });
    expect(await screen.findByTestId("library-shape")).toHaveTextContent("abc1234deadbeef");
  });

  it("shows an error state on the shape tab when library data fails to load", async () => {
    loadLibraryImpl = () => Promise.reject(new Error("boom"));
    render(<LibraryPage tab="shape" />, { wrapper: wrap() });
    expect(await screen.findByText(/library data failed to load: boom/)).toBeInTheDocument();
  });

  it("renders LibraryGlossary on the glossary tab without a loading/error state", () => {
    render(<LibraryPage tab="glossary" />, { wrapper: wrap("/reports/library/glossary") });
    expect(screen.getByTestId("library-glossary")).toBeInTheDocument();
    expect(screen.queryByText(/loading/)).toBeNull();
  });

  it("renders LibraryConcepts plus the Toc and Topic index columns on the concepts tab", () => {
    render(<LibraryPage tab="concepts" />, { wrapper: wrap("/reports/library/concepts") });
    expect(screen.getByTestId("library-concepts")).toBeInTheDocument();
    expect(screen.getByTestId("library-toc")).toBeInTheDocument();
    expect(screen.getByTestId("library-topic-index")).toBeInTheDocument();
  });

  it("renders LibraryAudit on the audit tab, without the Toc/Topic index columns", () => {
    render(<LibraryPage tab="audit" />, { wrapper: wrap("/reports/library/audit") });
    expect(screen.getByTestId("library-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("library-toc")).toBeNull();
    expect(screen.queryByTestId("library-topic-index")).toBeNull();
  });

  it("renders a nav with all four tabs, marking the active one", () => {
    render(<LibraryPage tab="audit" />, { wrapper: wrap("/reports/library/audit") });
    const nav = screen.getByRole("navigation", { name: /library pages/i });
    const links = ["Shape", "Concepts", "Audit", "Glossary"].map((name) =>
      screen.getByRole("link", { name }),
    );
    for (const link of links) expect(nav).toContainElement(link);
    expect(screen.getByRole("link", { name: "Shape" })).toHaveAttribute("href", "/reports/library");
    expect(screen.getByRole("link", { name: "Concepts" })).toHaveAttribute("href", "/reports/library/concepts");
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/reports/library/audit");
    expect(screen.getByRole("link", { name: "Glossary" })).toHaveAttribute("href", "/reports/library/glossary");
  });
});
