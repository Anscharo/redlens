// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AnatomyData } from "../../lib/anatomy";

// Track analytics + data loading are mocked; tab-content components are mocked
// too so this file stays a unit test of AnatomyPage's own tab-switching / title
// / error / loading logic — not a re-test of AnatomyShape, AnatomyGlossary,
// AnatomyConcepts/Audit, AnatomyToc, or AnatomyTopicIndex (each owns its own
// tests, or is out of scope here).
const trackMock = vi.fn();
vi.mock("../../lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const loadAnatomyCalls = vi.fn();
let loadAnatomyImpl: (base?: string) => Promise<AnatomyData> = () => Promise.reject(new Error("not configured"));
vi.mock("../../lib/anatomy", () => ({
  loadAnatomy: (base?: string) => {
    loadAnatomyCalls(base);
    return loadAnatomyImpl(base);
  },
}));

const useDataSourceMock = vi.fn();
vi.mock("../../lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));

vi.mock("./AnatomyShape", () => ({
  AnatomyShape: ({ data }: { data: AnatomyData }) => (
    <div data-testid="anatomy-shape">shape: {data.atlasCommit}</div>
  ),
}));
vi.mock("./AnatomyGlossary", () => ({
  AnatomyGlossary: () => <div data-testid="anatomy-glossary">glossary</div>,
}));
vi.mock("./AnatomyConcepts", () => ({
  AnatomyConcepts: () => <div data-testid="anatomy-concepts">concepts</div>,
  AnatomyAudit: () => <div data-testid="anatomy-audit">audit</div>,
}));
vi.mock("./AnatomyToc", () => ({
  AnatomyToc: () => <div data-testid="anatomy-toc">toc</div>,
}));
vi.mock("./AnatomyTopicIndex", () => ({
  AnatomyTopicIndex: () => <div data-testid="anatomy-topic-index">topics</div>,
}));

import { AnatomyPage } from "./AnatomyPage";

let baseSeq = 0;
const freshBase = () => `/api/test-anatomy-base-${++baseSeq}/`;

const anatomyFixture: AnatomyData = {
  atlasCommit: "abc1234deadbeef",
  totals: { docs: 10, bytes: 2048, glossaryTerms: 3 },
  chunkTree: [],
  scopeTree: [],
  docTypes: [],
  neededResearch: [],
};

function wrap(path = "/reports/anatomy") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  loadAnatomyCalls.mockClear();
  trackMock.mockClear();
  useDataSourceMock.mockReturnValue({ base: freshBase(), preview: null });
  loadAnatomyImpl = () => Promise.resolve(anatomyFixture);
});

afterEach(cleanup);

describe("AnatomyPage", () => {
  it("sets the document title", () => {
    render(<AnatomyPage tab="shape" />, { wrapper: wrap() });
    expect(document.title).toBe("Atlas Anatomy: Sky Atlas by Redline");
  });

  it("fires report_view analytics once on mount with the anatomy report id", () => {
    render(<AnatomyPage tab="shape" />, { wrapper: wrap() });
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("report_view", { report: "anatomy" });
  });

  it("passes the data-source base through to loadAnatomy", () => {
    const base = freshBase();
    useDataSourceMock.mockReturnValue({ base, preview: null });
    render(<AnatomyPage tab="shape" />, { wrapper: wrap() });
    expect(loadAnatomyCalls).toHaveBeenCalledWith(base);
  });

  it("shows a loading state on the shape tab before anatomy data resolves", () => {
    loadAnatomyImpl = () => new Promise(() => {});
    render(<AnatomyPage tab="shape" />, { wrapper: wrap() });
    expect(screen.getByText(/loading/)).toBeInTheDocument();
    expect(screen.queryByTestId("anatomy-shape")).toBeNull();
  });

  it("renders AnatomyShape with the loaded data on the shape tab", async () => {
    render(<AnatomyPage tab="shape" />, { wrapper: wrap() });
    expect(await screen.findByTestId("anatomy-shape")).toHaveTextContent("abc1234deadbeef");
  });

  it("shows an error state on the shape tab when anatomy data fails to load", async () => {
    loadAnatomyImpl = () => Promise.reject(new Error("boom"));
    render(<AnatomyPage tab="shape" />, { wrapper: wrap() });
    expect(await screen.findByText(/anatomy data failed to load: boom/)).toBeInTheDocument();
  });

  it("renders AnatomyGlossary on the glossary tab without a loading/error state", () => {
    render(<AnatomyPage tab="glossary" />, { wrapper: wrap("/reports/anatomy/glossary") });
    expect(screen.getByTestId("anatomy-glossary")).toBeInTheDocument();
    expect(screen.queryByText(/loading/)).toBeNull();
  });

  it("renders AnatomyConcepts plus the Toc and Topic index columns on the concepts tab", () => {
    render(<AnatomyPage tab="concepts" />, { wrapper: wrap("/reports/anatomy/concepts") });
    expect(screen.getByTestId("anatomy-concepts")).toBeInTheDocument();
    expect(screen.getByTestId("anatomy-toc")).toBeInTheDocument();
    expect(screen.getByTestId("anatomy-topic-index")).toBeInTheDocument();
  });

  it("renders AnatomyAudit on the audit tab, without the Toc/Topic index columns", () => {
    render(<AnatomyPage tab="audit" />, { wrapper: wrap("/reports/anatomy/audit") });
    expect(screen.getByTestId("anatomy-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("anatomy-toc")).toBeNull();
    expect(screen.queryByTestId("anatomy-topic-index")).toBeNull();
  });

  it("renders a nav with all four tabs, marking the active one", () => {
    render(<AnatomyPage tab="audit" />, { wrapper: wrap("/reports/anatomy/audit") });
    const nav = screen.getByRole("navigation", { name: /anatomy pages/i });
    const links = ["Shape", "Concepts", "Audit", "Glossary"].map((name) =>
      screen.getByRole("link", { name }),
    );
    for (const link of links) expect(nav).toContainElement(link);
    expect(screen.getByRole("link", { name: "Shape" })).toHaveAttribute("href", "/reports/anatomy");
    expect(screen.getByRole("link", { name: "Concepts" })).toHaveAttribute("href", "/reports/anatomy/concepts");
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/reports/anatomy/audit");
    expect(screen.getByRole("link", { name: "Glossary" })).toHaveAttribute("href", "/reports/anatomy/glossary");
  });
});
