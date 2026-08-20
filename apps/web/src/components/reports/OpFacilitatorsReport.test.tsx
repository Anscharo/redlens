// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OFResponsibility } from "@/lib/facilitatorResponsibilities";

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

// Minimal graph fixture: one prime → executor → facilitator/govops chain, so
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
    { id: "f1", slug: "fac-org", name: "Facilitator Org", et: "facilitator_org", st: null, did: null },
    { id: "g1", slug: "gov-org", name: "GovOps Org", et: "govops_org", st: null, did: null },
  ],
  instances: [],
  invocations: [],
  primitives: [],
  edges: [
    { f: "e1", ft: "entity", t: "p1", tt: "entity", e: "operational_executor_agent_for" },
    { f: "f1", ft: "entity", t: "e1", tt: "entity", e: "operational_facilitator_for" },
    { f: "g1", ft: "entity", t: "e1", tt: "entity", e: "operational_govops_for" },
  ],
};

const rows: OFResponsibility[] = [
  {
    docNo: "A.1",
    uuid: "u1",
    title: "Duty A",
    duty: "must do X",
    category: "op-duty",
    facilitator: "Facilitator Org",
    agent: "Prime One",
  },
  {
    docNo: "A.2",
    uuid: "u2",
    title: "Facilitator for Exec One",
    duty: "assignment duty",
    category: "assignment",
    facilitator: "Facilitator Org",
    executor: "Operational Executor Agent Exec One",
    agents: ["Prime One"],
  },
  {
    docNo: "A.3",
    uuid: "u3",
    title: "AD Title",
    duty: "active data duty",
    category: "active-data",
    facilitator: "Facilitator Org",
  },
  {
    docNo: "A.4",
    uuid: "u4",
    title: "Universal Duty",
    duty: "applies to all facilitators",
    category: "universal",
    facilitators: ["Facilitator Org", "Other Org"],
  },
  {
    docNo: "A.5",
    uuid: "u5",
    title: "Step Title",
    duty: "step duty text",
    category: "process-step",
    role: "Operational",
    facilitator: "Other Org",
  },
  // No direct facilitator match on "Facilitator Org" — reaches the facilitator
  // filter's agents.some(chains.get(a)?.facilitatorName) fallback branch.
  {
    docNo: "A.6",
    uuid: "u6",
    title: "Chain-Only Duty",
    duty: "resolved only via the agent chain",
    category: "process-step",
    role: "Operational",
    facilitator: "Other Org",
    agent: "Prime One",
  },
];

// A.1.7 is the real Facilitators section doc_no as of this writing, but the
// point of this fixture is to be something ELSE — it proves the intro link's
// label is resolved from loaded docs data (doc_no), not a hardcoded literal.
const INTRO_DOC_UUID = "1ce24b08-84ff-4524-9710-49bba429c6ef";
const INTRO_DOC_NO = "A.9.9";

vi.mock("../../lib/docs", () => ({
  loadAtlas: () =>
    Promise.resolve({
      docs: {
        [INTRO_DOC_UUID]: {
          id: INTRO_DOC_UUID,
          doc_no: INTRO_DOC_NO,
          title: "Facilitators",
          type: "Article",
          depth: 2,
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
vi.mock("../../lib/graph", () => ({ loadGraph: () => Promise.resolve(graphFixture) }));
vi.mock("@/lib/facilitatorResponsibilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/facilitatorResponsibilities")>();
  return {
    ...actual,
    deriveFacilitatorResponsibilities: () => rows,
    facilitatorRowsToCSV: () => "csv-text",
  };
});

import { OFReport } from "./OpFacilitatorsReport";

// Doc-no anchors are unique per row and never overlap with highlighting in
// these tests, so they're the stable way to assert row presence/absence
// regardless of which column (if any) renders the row's title text.
const docLink = (docNo: string) => screen.queryByRole("link", { name: docNo });

describe("OFReport", () => {
  it("renders every category's rows grouped under their labelled table", async () => {
    render(<OFReport query="" mode="broad" />);
    expect(await screen.findByText("Duty A")).toBeInTheDocument();
    expect(docLink("A.1")).toBeInTheDocument();
    expect(docLink("A.2")).toBeInTheDocument();
    expect(docLink("A.3")).toBeInTheDocument();
    expect(docLink("A.4")).toBeInTheDocument();
    expect(docLink("A.5")).toBeInTheDocument();
    expect(docLink("A.6")).toBeInTheDocument();
    expect(screen.getByText("6 responsibilities")).toBeInTheDocument();
    // core-facilitator category has zero rows — its table must not render.
    expect(screen.queryByText(/Core Facilitator Duties/)).not.toBeInTheDocument();
  });

  it("filters by prime agent pill (agent kind)", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "Prime One" }));
    // Row A, the assignment row (u2), and u6 all carry "Prime One" as an agent.
    expect(docLink("A.1")).toBeInTheDocument();
    expect(docLink("A.2")).toBeInTheDocument();
    expect(docLink("A.6")).toBeInTheDocument();
    // Rows with no agent context drop out.
    expect(docLink("A.3")).not.toBeInTheDocument();
    expect(docLink("A.4")).not.toBeInTheDocument();
    expect(screen.getByText("3 responsibilities")).toBeInTheDocument();
  });

  it("filters by facilitator pill, matching direct holder + fan-out + agent-chain lookup", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "Facilitator Org" }));
    expect(docLink("A.1")).toBeInTheDocument();
    expect(docLink("A.2")).toBeInTheDocument();
    expect(docLink("A.3")).toBeInTheDocument();
    expect(docLink("A.4")).toBeInTheDocument(); // fan-out array match
    // u6's own facilitator field is "Other Org", but its agent (Prime One)
    // resolves to "Facilitator Org" via the chain — the fallback branch.
    expect(docLink("A.6")).toBeInTheDocument();
    // "Other Org" holds A.5 alone — no facilitator/chain path to Facilitator Org.
    expect(docLink("A.5")).not.toBeInTheDocument();
  });

  it("filters by executor pill, including the holder→executor fallback for context-free rows", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "Exec One" }));
    // Assignment row matches directly on its own executor field.
    expect(docLink("A.2")).toBeInTheDocument();
    // Duty A matches via its agent's chain (Prime One -> Exec One).
    expect(docLink("A.1")).toBeInTheDocument();
    // AD Title has no executor/agent context but its facilitator holder
    // (Facilitator Org) resolves to Exec One via holderExecutorSlugs.
    expect(docLink("A.3")).toBeInTheDocument();
    // u6 also resolves via its agent's chain (Prime One -> Exec One).
    expect(docLink("A.6")).toBeInTheDocument();
    // Step Title's holder is "Other Org", which has no executor edge at all.
    expect(docLink("A.5")).not.toBeInTheDocument();
  });

  it("toggling the same pill twice clears the filter", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    const btn = screen.getByRole("button", { name: "Prime One" });
    fireEvent.click(btn);
    expect(screen.getByText("3 responsibilities")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByText("6 responsibilities")).toBeInTheDocument();
  });

  it("filters by category pill", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    fireEvent.click(screen.getByRole("button", { name: "universal" }));
    expect(docLink("A.4")).toBeInTheDocument();
    expect(docLink("A.1")).not.toBeInTheDocument();
    expect(screen.getByText("1 responsibilities")).toBeInTheDocument();
  });

  it("shows NoRowsMatch when the text query matches nothing", async () => {
    render(<OFReport query="zzz-nomatch" mode="broad" />);
    const notice = await screen.findByText(/No rows match/);
    expect(notice.textContent).toContain("zzz-nomatch");
  });

  it("filters rows by the header text query", async () => {
    render(<OFReport query="universal" mode="broad" />);
    expect(await screen.findByRole("link", { name: "A.4" })).toBeInTheDocument();
    expect(docLink("A.1")).not.toBeInTheDocument();
    expect(screen.getByText("1 responsibilities")).toBeInTheDocument();
  });

  it("renders the CSV download control", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    const btn = screen.getByRole("button", { name: "Download full report" });
    fireEvent.click(btn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("shows and builds the filtered CSV download only while a filter is active", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    expect(screen.queryByRole("button", { name: "Download filtered report" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "universal" }));
    const filteredBtn = await screen.findByRole("button", { name: "Download filtered report" });
    fireEvent.click(filteredBtn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("restores an entity filter from the URL on load", async () => {
    window.history.pushState({}, "", "/reports/of?filter=agent.prime-one");
    render(<OFReport query="" mode="broad" />);
    expect(await screen.findByText("3 responsibilities")).toBeInTheDocument();
    const summary = document.querySelector(".filter-summary");
    expect(within(summary as HTMLElement).getByText("Prime One")).toBeInTheDocument();
  });

  it("resolves the intro link label from loaded docs data, not a hardcoded doc_no", async () => {
    render(<OFReport query="" mode="broad" />);
    await screen.findByText("Duty A");
    const link = screen.getByRole("link", { name: `${INTRO_DOC_NO} Facilitators ↗` });
    expect(link).toHaveAttribute("href", `/atlas?id=${INTRO_DOC_UUID}`);
  });
});
