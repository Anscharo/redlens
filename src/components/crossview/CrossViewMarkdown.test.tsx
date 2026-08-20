// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "@/types";
import type { AtlasBundle } from "@/lib/docsTypes";

vi.mock("./ConceptCensus", () => ({
  ConceptCensus: ({ slug }: { slug: string }) => <div data-testid="census-slot">census:{slug}</div>,
}));

// Same mocking pattern as ConceptCensus.test.tsx: loadAtlas/useDataSource are
// mocked so the resolver-loading effect resolves synchronously-ish under
// waitFor without a real Worker (jsdom has none).
let loadAtlasImpl: (base: string) => Promise<AtlasBundle> = () => Promise.reject(new Error("not configured"));
vi.mock("@/lib/docs", () => ({
  loadAtlas: (base: string) => loadAtlasImpl(base),
}));
vi.mock("@/lib/dataSource", () => ({
  useDataSource: () => ({ base: "/api/test-base/", preview: null }),
}));

import { CrossViewMarkdown } from "./CrossViewMarkdown";

let order = 0;
const mk = (id: string, doc_no: string, title: string): AtlasNode => ({
  id,
  doc_no,
  title,
  type: "Core",
  depth: 1,
  parentId: null,
  content: "x",
  order: order++,
  addressRefs: [],
});

function bundleFrom(nodes: AtlasNode[]): AtlasBundle {
  const docs: Record<string, AtlasNode> = {};
  const docNoToId = new Map<string, string>();
  for (const n of nodes) {
    docs[n.id] = n;
    docNoToId.set(n.doc_no, n.id);
  }
  return { docs, docNoToId, byParent: new Map(), atlasCommit: null };
}

const FULL_UUID = "55999acf-75fe-4adf-8584-9746ef50d3e4";
const fixture = bundleFrom([
  mk(FULL_UUID, "A.3.2", "Stability Fee Mechanics And Governance Overview Doc"),
]);

beforeEach(() => {
  loadAtlasImpl = () => Promise.resolve(fixture);
});

afterEach(cleanup);

describe("CrossViewMarkdown", () => {
  it("renders plain markdown as a single block when no census marker is present", async () => {
    render(<CrossViewMarkdown raw={"# Title\n\nSome prose."} />);
    expect(await screen.findByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Some prose.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("census-slot")).toHaveLength(0);
  });

  it("splits a `:::census <slug>` marker line into a ConceptCensus slot between markdown segments", async () => {
    const raw = ["# Before", "", ":::census transitionary-measures", "", "## After"].join("\n");
    render(<CrossViewMarkdown raw={raw} />);
    expect(await screen.findByRole("heading", { name: "Before" })).toBeInTheDocument();
    expect(screen.getByTestId("census-slot")).toHaveTextContent("census:transitionary-measures");
    expect(screen.getByRole("heading", { name: /After/ })).toBeInTheDocument();
  });

  it("splits multiple markers into multiple independent census slots", async () => {
    const raw = [":::census formula-docs", "middle text", ":::census prohibition-language"].join("\n");
    render(<CrossViewMarkdown raw={raw} />);
    const slots = await screen.findAllByTestId("census-slot");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toHaveTextContent("census:formula-docs");
    expect(slots[1]).toHaveTextContent("census:prohibition-language");
    expect(screen.getByText("middle text")).toBeInTheDocument();
  });

  it("shows a loading state before the bundle resolves", () => {
    loadAtlasImpl = () => new Promise(() => {}); // never resolves
    render(<CrossViewMarkdown raw={"# Title"} />);
    expect(screen.getByText(/loading/)).toBeInTheDocument();
  });

  it("turns a full-uuid code span into a `DOC_NO • Title` reader link once the bundle resolves", async () => {
    render(<CrossViewMarkdown raw={`See \`${FULL_UUID}\` for details.`} />);
    const link = await screen.findByRole("link", { name: /A\.3\.2 •/ });
    expect(link).toHaveAttribute("href", expect.stringContaining(FULL_UUID));
    expect(link).toHaveAttribute("title", expect.stringContaining("A.3.2 - Stability Fee"));
  });

  it("falls back to the old full-uuid-only behavior when the bundle fails to load", async () => {
    loadAtlasImpl = () => Promise.reject(new Error("network down"));
    render(<CrossViewMarkdown raw={`See \`${FULL_UUID}\` and \`A.3.2\` for details.`} />);
    const link = await screen.findByRole("link", { name: "55999acf" });
    expect(link).toHaveAttribute("href", expect.stringContaining(FULL_UUID));
    expect(screen.getByText("A.3.2").tagName).toBe("CODE");
  });

  it("stamps a unit-opener paragraph (bold 'Group N · Title' lead) with a slug id, hash-linkable like a heading", async () => {
    const raw = "**Instruments 5 · Spell machinery**\n\nSome body text.";
    render(<CrossViewMarkdown raw={raw} />);
    await screen.findByText("Some body text.");
    const p = screen.getByText((_, el) => el?.tagName === "P" && !!el.querySelector("strong"));
    expect(p).toHaveAttribute("id", "instruments-5");
    expect(p.className).toContain("unit-opener");
  });

  it("does not stamp an id on a bold field-label paragraph (no 'Group N ·' lead)", async () => {
    const raw = "**Definition** — some definition text.";
    render(<CrossViewMarkdown raw={raw} />);
    const p = await screen.findByText(/some definition text/);
    expect(p.closest("p")).not.toHaveAttribute("id");
  });

  it("swaps a `:::index` … `:::endindex` block for a linkified topics list, dropping the markers from the markdown pass", async () => {
    const raw = [
      "# Before",
      "",
      ":::index",
      "- Accords (Ecosystem) → Instruments 1",
      "- Staking → Economics 3/Economics 4",
      ":::endindex",
      "",
      "## After",
    ].join("\n");
    render(<CrossViewMarkdown raw={raw} />);
    expect(await screen.findByRole("heading", { name: "Before" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /After/ })).toBeInTheDocument();
    expect(screen.queryByText(/:::index/)).not.toBeInTheDocument();
    const unitLink = screen.getByRole("link", { name: "Instruments 1" });
    expect(unitLink).toHaveAttribute("href", "#instruments-1");
    // compact multi-target rendering: one "Economics" label, two number links
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "#economics-3");
    expect(screen.getByRole("link", { name: "4" })).toHaveAttribute("href", "#economics-4");
  });
});
