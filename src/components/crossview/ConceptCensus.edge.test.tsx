// @vitest-environment jsdom
// Split from ConceptCensus.test.tsx to keep files near the ~150-line
// convention — covers the base-cache hit path (a second mount reusing an
// already-resolved promise for the SAME base) and the `notes` /
// singular-member-count rendering branches, which need a synthetic
// CensusResult rather than a real computeConceptsCensus() run.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "@/types";
import type { CensusResult, CensusSlug } from "@/lib/conceptsCensus";

const computeConceptsCensus = vi.fn();
vi.mock("@/lib/conceptsCensus", () => ({
  computeConceptsCensus: (...args: unknown[]) => computeConceptsCensus(...args),
}));

const loadAtlasCalls = vi.fn();
vi.mock("@/lib/docs", () => ({
  loadAtlas: (base: string) => {
    loadAtlasCalls(base);
    return Promise.resolve({ docs: {} as Record<string, AtlasNode> });
  },
}));

const useDataSourceMock = vi.fn();
vi.mock("@/lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/csvDownload", () => ({ downloadCSV: vi.fn() }));

import { ConceptCensus } from "./ConceptCensus";

let baseSeq = 0;
const freshBase = () => `/api/edge-base-${++baseSeq}/`;

const oneMemberResult: CensusResult = {
  slug: "one-member-slug" as CensusSlug,
  title: "Synthetic One-Member Census",
  signature: { kind: "content", pattern: "synthetic pattern" },
  members: [{ uuid: "id-1", doc_no: "A.1.1", title: "Only Member" }],
  counts: { total: 1 },
  notes: "A synthetic note explaining a caveat about this census.",
};

beforeEach(() => {
  loadAtlasCalls.mockClear();
  computeConceptsCensus.mockReset();
  computeConceptsCensus.mockReturnValue({ "one-member-slug": oneMemberResult });
  useDataSourceMock.mockReturnValue({ base: freshBase(), preview: null });
});

afterEach(cleanup);

describe("ConceptCensus — edge cases", () => {
  it("renders the notes paragraph and singular 'member' wording for a one-member result", async () => {
    render(<ConceptCensus slug="one-member-slug" />);
    expect(await screen.findByText(/census: Synthetic One-Member Census/)).toBeInTheDocument();
    expect(screen.getByText(/A synthetic note explaining a caveat/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 member" })).toBeInTheDocument();
  });

  it("reuses the cached promise for a second mount at the same base (no second loadAtlas call)", async () => {
    const base = freshBase();
    useDataSourceMock.mockReturnValue({ base, preview: null });
    render(<ConceptCensus slug="one-member-slug" />);
    await screen.findByText(/census: Synthetic One-Member Census/);
    expect(loadAtlasCalls).toHaveBeenCalledTimes(1);

    // A second, independent mount at the SAME base should hit the module-level
    // cache rather than calling loadAtlas again.
    render(<ConceptCensus slug="one-member-slug" />);
    await screen.findAllByText(/census: Synthetic One-Member Census/);
    expect(loadAtlasCalls).toHaveBeenCalledTimes(1);
  });
});
