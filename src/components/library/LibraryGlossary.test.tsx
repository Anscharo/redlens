// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Glossary } from "../../lib/glossaryLookup";

// loadGlossary is mocked per-base so the base-keyed cache in src/lib/glossary.ts
// can be exercised directly, mirroring ConceptCensus.test.tsx's approach for
// its own base-keyed loadAtlas cache.
const loadGlossaryCalls = vi.fn();
let loadGlossaryImpl: (base?: string) => Promise<Glossary> = () => Promise.reject(new Error("not configured"));
vi.mock("../../lib/glossary", () => ({
  loadGlossary: (base?: string) => {
    loadGlossaryCalls(base);
    return loadGlossaryImpl(base);
  },
}));

const useDataSourceMock = vi.fn();
vi.mock("../../lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));

import { LibraryGlossary } from "./LibraryGlossary";

let baseSeq = 0;
const freshBase = () => `/api/test-glossary-base-${++baseSeq}/`;

const glossaryFixture: Glossary = {
  accord: [
    {
      term: "Accord",
      content: "A binding agreement.",
      nodeId: "id-accord",
      docNo: "A.0.3.1",
      sourceDocNo: "A.0.3.1",
      sourceContext: null,
    },
  ],
};

function wrap() {
  const { hook } = memoryLocation({ path: "/reports/library/glossary", record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  loadGlossaryCalls.mockClear();
  useDataSourceMock.mockReturnValue({ base: freshBase(), preview: null });
  loadGlossaryImpl = () => Promise.resolve(glossaryFixture);
});

afterEach(cleanup);

describe("LibraryGlossary", () => {
  it("shows a loading state before the glossary resolves", () => {
    loadGlossaryImpl = () => new Promise(() => {});
    render(<LibraryGlossary />, { wrapper: wrap() });
    expect(screen.getByText(/loading/)).toBeInTheDocument();
  });

  it("renders terms once loaded, linking to their source document", async () => {
    render(<LibraryGlossary />, { wrapper: wrap() });
    expect(await screen.findByText("Accord")).toBeInTheDocument();
    expect(screen.getByText(/1 terms extracted/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /A\.0\.3\.1/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("id-accord"));
  });

  it("shows an error state when the glossary fails to load", async () => {
    loadGlossaryImpl = () => Promise.reject(new Error("network down"));
    render(<LibraryGlossary />, { wrapper: wrap() });
    expect(await screen.findByText(/glossary failed to load/)).toBeInTheDocument();
  });

  it("passes the data-source base to loadGlossary and refetches when the base changes", async () => {
    const liveBase = freshBase();
    useDataSourceMock.mockReturnValue({ base: liveBase, preview: null });
    const { rerender } = render(<LibraryGlossary />, { wrapper: wrap() });
    await screen.findByText("Accord");
    rerender(<LibraryGlossary />);
    await waitFor(() => expect(loadGlossaryCalls).toHaveBeenCalledTimes(1));

    const previewBase = freshBase();
    useDataSourceMock.mockReturnValue({ base: previewBase, preview: { id: "abc", sha: "deadbeef" } });
    rerender(<LibraryGlossary />);
    await waitFor(() => expect(loadGlossaryCalls).toHaveBeenCalledTimes(2));
    expect(loadGlossaryCalls.mock.calls.map((c) => c[0])).toEqual([liveBase, previewBase]);
  });
});
