// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OGResponsibility } from "@/lib/govopsResponsibilities";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL = vi.fn(() => "blob:x");
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

// Minimal graph fixture: one prime → executor → govops chain, so
// buildChains/rolePills/holderExecutorSlugs (real modules, not mocked) produce
// meaningful pills and chain lookups against the fixture rows below.
const graphFixture = {
  participants: [
    { id: "p1", slug: "prime-one", name: "Prime One", et: "agent", st: "prime", did: null },
    {
      id: "e1",
      slug: "exec-one",
      name: "Operational Executor Agent Exec One",
      et: "agent",
      st: "operational_executor",
      did: null,
    },
    { id: "g1", slug: "gov-org", name: "GovOps Org", et: "govops_org", st: null, did: null },
  ],
  instances: [],
  invocations: [],
  primitives: [],
  edges: [
    { f: "e1", ft: "entity", t: "p1", tt: "entity", e: "operational_executor_agent_for" },
    { f: "g1", ft: "entity", t: "e1", tt: "entity", e: "operational_govops_for" },
  ],
};

const rows: OGResponsibility[] = [
  {
    docNo: "A.1",
    uuid: "u1",
    title: "Duty A",
    duty: "must do X",
    category: "op-duty",
    govops: "GovOps Org",
    agent: "Prime One",
  },
  {
    docNo: "A.2",
    uuid: "u2",
    title: "GovOps for Exec One",
    duty: "assignment duty",
    category: "assignment",
    govops: "GovOps Org",
    executor: "Operational Executor Agent Exec One",
    agents: ["Prime One"],
  },
  {
    docNo: "A.3",
    uuid: "u3",
    title: "AD Title",
    duty: "active data duty",
    category: "active-data",
    govops: "GovOps Org",
  },
  {
    docNo: "A.4",
    uuid: "u4",
    title: "Core Duty",
    duty: "core duty text",
    category: "core-duty",
    govops: "Other Org",
  },
  {
    docNo: "A.5",
    uuid: "u5",
    title: "What GovOps Is",
    duty: "definition text",
    category: "definition",
  },
  // No direct govops match on "GovOps Org" — reaches the govops filter's
  // agents.some(chains.get(a)?.govopsName) fallback branch.
  {
    docNo: "A.6",
    uuid: "u6",
    title: "Chain-Only Duty",
    duty: "resolved only via the agent chain",
    category: "core-duty",
    govops: "Other Org",
    agent: "Prime One",
  },
];

// A.0.1.1.47 is the real GovOps section doc_no as of this writing, but the
// point of this fixture is to be something ELSE — it proves the intro link's
// label is resolved from loaded docs data (doc_no), not a hardcoded literal.
const INTRO_DOC_UUID = "1e73ee4b-823d-406a-af54-223b43bc8e42";
const INTRO_DOC_NO = "A.9.9";

vi.mock("@/lib/docs", () => ({
  loadAtlas: () =>
    Promise.resolve({
      docs: {
        [INTRO_DOC_UUID]: {
          id: INTRO_DOC_UUID,
          doc_no: INTRO_DOC_NO,
          title: "GovOps",
          type: "Core",
          depth: 5,
          parentId: null,
          content: "",
          order: 0,
          addressRefs: [],
        },
      },
      byParent: new Map(),
      docNoToId: new Map(),
      atlasCommit: null,
    }),
}));
vi.mock("@/lib/graph", () => ({ loadGraph: () => Promise.resolve(graphFixture) }));
vi.mock("@/lib/govopsResponsibilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/govopsResponsibilities")>();
  return {
    ...actual,
    deriveGovOpsResponsibilities: () => rows,
    govopsRowsToCSV: () => "csv-text",
  };
});

import { OGReport } from "./OpGovOpsReport";

// Doc-no anchors are unique per row and stable across highlighting/column
// visibility differences between categories.
const docLink = (docNo: string) => screen.queryByRole("link", { name: docNo });

describe("OGReport", () => {
  it("renders every category's rows grouped under their labelled table", async () => {
    render(<OGReport query="" mode="broad" />);
    expect(await screen.findByText("Duty A")).toBeInTheDocument();
    expect(docLink("A.1")).toBeInTheDocument();
    expect(docLink("A.2")).toBeInTheDocument();
    expect(docLink("A.3")).toBeInTheDocument();
    expect(docLink("A.4")).toBeInTheDocument();
    expect(docLink("A.5")).toBeInTheDocument();
    expect(docLink("A.6")).toBeInTheDocument();
    expect(screen.getByText("6 responsibilities")).toBeInTheDocument();
  });

  it("filters by prime agent pill (agent kind)", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "Prime One" }));
    expect(docLink("A.1")).toBeInTheDocument();
    expect(docLink("A.2")).toBeInTheDocument();
    expect(docLink("A.6")).toBeInTheDocument();
    expect(docLink("A.3")).not.toBeInTheDocument();
    expect(docLink("A.4")).not.toBeInTheDocument();
    // Definitions never show under an active entity filter.
    expect(docLink("A.5")).not.toBeInTheDocument();
    expect(screen.getByText("3 responsibilities")).toBeInTheDocument();
  });

  it("filters by govops pill, matching direct holder + chain lookup", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "GovOps Org" }));
    expect(docLink("A.1")).toBeInTheDocument();
    expect(docLink("A.2")).toBeInTheDocument();
    expect(docLink("A.3")).toBeInTheDocument();
    // u6's own govops field is "Other Org", but its agent (Prime One)
    // resolves to "GovOps Org" via the chain — the fallback branch.
    expect(docLink("A.6")).toBeInTheDocument();
    // "Other Org" holds A.4 alone — no govops/chain path to GovOps Org.
    expect(docLink("A.4")).not.toBeInTheDocument();
    expect(docLink("A.5")).not.toBeInTheDocument();
  });

  it("filters by executor pill, including the holder→executor fallback for context-free rows", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "Exec One" }));
    // Assignment row matches directly on its own executor field.
    expect(docLink("A.2")).toBeInTheDocument();
    // Duty A matches via its agent's chain (Prime One -> Exec One).
    expect(docLink("A.1")).toBeInTheDocument();
    // AD Title has no executor/agent context but its govops holder
    // (GovOps Org) resolves to Exec One via holderExecutorSlugs.
    expect(docLink("A.3")).toBeInTheDocument();
    // u6 also resolves via its agent's chain (Prime One -> Exec One).
    expect(docLink("A.6")).toBeInTheDocument();
    // Core Duty's holder is "Other Org", which has no executor edge at all.
    expect(docLink("A.4")).not.toBeInTheDocument();
  });

  it("hides definition rows once any entity filter is active, shows them with none", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    expect(docLink("A.5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prime One" }));
    expect(docLink("A.5")).not.toBeInTheDocument();
  });

  it("toggling the same pill twice clears the filter", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    const btn = screen.getByRole("button", { name: "Prime One" });
    fireEvent.click(btn);
    expect(screen.getByText("3 responsibilities")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByText("6 responsibilities")).toBeInTheDocument();
  });

  it("filters by category pill", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "definition" }));
    expect(docLink("A.5")).toBeInTheDocument();
    expect(docLink("A.1")).not.toBeInTheDocument();
    expect(screen.getByText("1 responsibilities")).toBeInTheDocument();
  });

  it("shows NoRowsMatch when the text query matches nothing", async () => {
    render(<OGReport query="zzz-nomatch" mode="broad" />);
    const notice = await screen.findByText(/No rows match/);
    expect(notice.textContent).toContain("zzz-nomatch");
  });

  it("filters rows by the header text query", async () => {
    render(<OGReport query="core" mode="broad" />);
    expect(await screen.findByRole("link", { name: "A.4" })).toBeInTheDocument();
    expect(docLink("A.1")).not.toBeInTheDocument();
    expect(screen.getByText("1 responsibilities")).toBeInTheDocument();
  });

  it("renders the CSV download control", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    const btn = screen.getByRole("button", { name: "Download full report" });
    fireEvent.click(btn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("shows and builds the filtered CSV download only while a filter is active", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    expect(screen.queryByRole("button", { name: "Download filtered report" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "definition" }));
    const filteredBtn = await screen.findByRole("button", { name: "Download filtered report" });
    fireEvent.click(filteredBtn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("restores an entity filter from the URL on load", async () => {
    window.history.pushState({}, "", "/reports/gov-ops?filter=agent.prime-one");
    render(<OGReport query="" mode="broad" />);
    expect(await screen.findByText("3 responsibilities")).toBeInTheDocument();
    const summary = document.querySelector(".filter-summary");
    expect(within(summary as HTMLElement).getByText("Prime One")).toBeInTheDocument();
  });

  it("resolves the intro link label from loaded docs data, not a hardcoded doc_no", async () => {
    render(<OGReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    const link = screen.getByRole("link", { name: `${INTRO_DOC_NO} GovOps ↗` });
    expect(link).toHaveAttribute("href", `/atlas?id=${INTRO_DOC_UUID}`);
  });
});
