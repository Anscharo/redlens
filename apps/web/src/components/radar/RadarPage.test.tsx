// @vitest-environment jsdom
// RadarPage is the /radar shell: it Suspense-loads docs+graph, builds the
// sidebar actor groups and (when a slug is present) an actor profile, then
// routes to one of three surfaces — PrimitiveDashboard (index), ActorDashboard
// (profile found), or "actor not found" (slug with no profile). The data-index
// builders and the leaf surfaces are covered by their own tests, so here they
// are mocked to isolate RadarPage's own branching + the search-filter logic.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SidebarGroup } from "../../lib/actorIndex";

// Drawer subscribes to a media query; jsdom has no matchMedia.
window.matchMedia = window.matchMedia || (((q: string) => ({
  matches: false,
  media: q,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia);

// Stable resolved promises — `use()` in RadarLoaded runs on every render, so a
// fresh Promise per call would re-suspend forever. Resolve once at module scope.
const DOCS = {} as Record<string, never>;
const GRAPH = { participants: [], instances: [], invocations: [], primitives: [], edges: [] };
// React's `use()` reads `promise.status`/`.value` and, when the promise is
// already tagged fulfilled, returns synchronously without suspending. Pre-tag
// so the first render doesn't hang waiting on a Suspense retry in the test env.
function fulfilled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = "fulfilled";
  p.value = value;
  return p;
}
const DOCS_P = fulfilled(DOCS);
const GRAPH_P = fulfilled(GRAPH);
vi.mock("../../lib/docs", () => ({ loadDocs: () => DOCS_P }));
vi.mock("../../lib/graph", () => ({ loadGraph: () => GRAPH_P }));

// recordVisit hits IndexedDB (absent in jsdom) — neutralise it.
const recordVisit = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../../lib/visitHistory", () => ({ recordVisit: (...a: unknown[]) => recordVisit(...a) }));

// Index builders return controlled shapes so RadarPage's own logic is what we test.
const SIDEBAR: SidebarGroup[] = [
  {
    label: "Prime Agents",
    actors: [
      { id: "a1", slug: "spark", name: "Spark", et: "agent", st: "prime", docId: null },
      { id: "a2", slug: "grove", name: "Grove", et: "agent", st: "prime", docId: null },
    ],
  },
  {
    label: "Facilitators",
    actors: [{ id: "f1", slug: "sfl", name: "Sky Foundation", et: "facilitator_org", st: null, docId: null }],
  },
];
vi.mock("../../lib/actorIndex", () => ({
  buildSidebarActors: () => SIDEBAR,
  buildActorProfile: (slug: string) =>
    slug === "spark" ? { entity: { name: "Spark Radar Entity", slug: "spark" } } : null,
}));
vi.mock("@/lib/rewardsIndex", () => ({ buildRewardsIndex: () => ({ agents: [] }) }));
vi.mock("@/lib/activeDataIndex", () => ({ buildActiveDataRows: () => [] }));
vi.mock("../../lib/primitiveStats", () => ({ buildPrimitiveStats: () => [] }));

// Leaf surfaces — render just enough to identify which one mounted and echo props.
vi.mock("./ActorList", () => ({
  ActorList: ({ groups, selectedSlug }: { groups: SidebarGroup[]; selectedSlug: string | null }) => (
    <nav data-testid="actor-list" data-selected={selectedSlug ?? ""}>
      {groups.map((g) => (
        <div key={g.label}>
          <span>{g.label}</span>
          {g.actors.map((a) => (
            <span key={a.id}>{a.name}</span>
          ))}
        </div>
      ))}
    </nav>
  ),
}));
vi.mock("./PrimitiveDashboard", () => ({
  PrimitiveDashboard: () => <div data-testid="primitive-dashboard">primitive dashboard</div>,
}));
vi.mock("./ActorDashboard", () => ({
  ActorDashboard: ({ profile }: { profile: { entity: { name: string } } }) => (
    <div data-testid="actor-dashboard">{profile.entity.name}</div>
  ),
}));

import { RadarPage } from "./RadarPage";

afterEach(() => {
  cleanup();
  recordVisit.mockClear();
});

describe("RadarPage index (no actorSlug)", () => {
  it("renders the PrimitiveDashboard and the full sidebar", async () => {
    render(<RadarPage query="" />);
    expect(await screen.findByTestId("primitive-dashboard")).toBeInTheDocument();
    expect(screen.getByText("Spark")).toBeInTheDocument();
    expect(screen.getByText("Grove")).toBeInTheDocument();
    expect(screen.getByText("Sky Foundation")).toBeInTheDocument();
    expect(screen.queryByTestId("actor-dashboard")).not.toBeInTheDocument();
  });

  it("filters the sidebar by an actor-name query", async () => {
    render(<RadarPage query="grove" />);
    await screen.findByTestId("actor-list");
    expect(screen.getByText("Grove")).toBeInTheDocument();
    // Spark filtered out of its group; the facilitator group drops entirely.
    expect(screen.queryByText("Spark")).not.toBeInTheDocument();
    expect(screen.queryByText("Sky Foundation")).not.toBeInTheDocument();
  });

  it("keeps a whole group when the query matches its role label", async () => {
    render(<RadarPage query="facilitator" />);
    await screen.findByTestId("actor-list");
    expect(screen.getByText("Sky Foundation")).toBeInTheDocument();
    expect(screen.getByText("Facilitators")).toBeInTheDocument();
    // The Prime Agents group doesn't match the role query, so it's gone.
    expect(screen.queryByText("Spark")).not.toBeInTheDocument();
  });
});

describe("RadarPage actor page", () => {
  it("renders ActorDashboard and records the visit when a profile resolves", async () => {
    render(<RadarPage query="" actorSlug="spark" />);
    expect(await screen.findByTestId("actor-dashboard")).toHaveTextContent("Spark Radar Entity");
    expect(screen.getByTestId("actor-list")).toHaveAttribute("data-selected", "spark");
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(1));
    expect(recordVisit).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Spark Radar Entity" }),
    );
  });

  it("shows an actor-not-found state for an unknown slug", async () => {
    render(<RadarPage query="" actorSlug="ghost" />);
    expect(await screen.findByText("actor not found")).toBeInTheDocument();
    expect(screen.queryByTestId("actor-dashboard")).not.toBeInTheDocument();
    expect(recordVisit).not.toHaveBeenCalled();
  });
});
