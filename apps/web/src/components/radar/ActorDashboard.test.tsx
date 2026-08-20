// @vitest-environment jsdom
// ActorDashboard is the actor-page layout. Its own logic is the header
// (type-label branch, defining-doc + composite links), the composite-party
// block, the conditional sections (responsibilities / primitives / relations /
// notable / rewards), and RelationRow/RecRow. Leaf children (chain, contact,
// responsibilities, instances, rewards, history, settlements) are covered by
// their own tests and stubbed here so we isolate ActorDashboard's branching.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ActorProfile } from "../../lib/actorIndex";
import type { GraphEntity, AtlasNode } from "@/types";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("./ActorChain", () => ({ ActorChain: () => <div data-testid="chain" /> }));
vi.mock("./ActorContact", () => ({ ActorContact: () => <div data-testid="contact" /> }));
vi.mock("./ActorResponsibilities", () => ({ ActorResponsibilities: () => <div data-testid="resp" /> }));
vi.mock("./ActorInstances", () => ({ ActorInstances: () => <div data-testid="instances" /> }));
vi.mock("./ActorRewards", () => ({ ActorRewards: () => <div data-testid="rewards" /> }));
vi.mock("./ActorHistory", () => ({ ActorHistory: () => <div data-testid="history" /> }));
vi.mock("./ActorSettlementTeaser", () => ({ ActorSettlementTeaser: () => <div data-testid="settlements" /> }));

import { ActorDashboard } from "./ActorDashboard";

afterEach(cleanup);

function entity(overrides: Partial<GraphEntity> = {}): GraphEntity {
  return { id: "e1", slug: "spark", name: "Spark", et: "agent", st: "prime", did: null, ...overrides };
}

function profile(overrides: Partial<ActorProfile> = {}): ActorProfile {
  return {
    entity: entity(),
    definingDoc: null,
    chain: { primes: [], executors: [], facilitators: [], govops: [] },
    adRows: [],
    rewardsAgent: null,
    relations: [],
    instances: [],
    invocations: [],
    primitives: [],
    recommendations: [],
    comprisesMembers: [],
    partOfComposite: null,
    contact: { channels: [], emergency: [] },
    ...overrides,
  } as ActorProfile;
}

describe("ActorDashboard header", () => {
  it("shows the entity name and 'Prime Agent' type label", () => {
    render(<ActorDashboard profile={profile()} />);
    expect(screen.getByRole("heading", { name: "Spark" })).toBeInTheDocument();
    expect(screen.getByText("Prime Agent")).toBeInTheDocument();
    expect(screen.getByTestId("settlements")).toBeInTheDocument();
  });

  it("places the MSC teaser before the name so it floats to the top-right", () => {
    render(<ActorDashboard profile={profile()} />);
    const teaser = screen.getByTestId("settlements");
    const name = screen.getByRole("heading", { name: "Spark" });
    expect(teaser.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows 'Executor Agent' for a non-prime agent", () => {
    render(<ActorDashboard profile={profile({ entity: entity({ st: "operational_executor" }) })} />);
    expect(screen.getByText("Executor Agent")).toBeInTheDocument();
  });

  it("uses the entity-type label for a non-agent entity", () => {
    render(<ActorDashboard profile={profile({ entity: entity({ et: "facilitator_org", st: null }) })} />);
    // ENTITY_TYPE_LABEL maps facilitator_org — not "Prime/Executor Agent".
    expect(screen.queryByText(/Agent$/)).not.toBeInTheDocument();
  });

  it("links the defining doc by doc_no and the composite parent", () => {
    const doc: AtlasNode = {
      id: "d1", doc_no: "A.2.2", title: "Spark Agent", type: "Core", depth: 3,
      parentId: null, content: "", contentHash: "", order: 0, addressRefs: [],
    };
    render(
      <ActorDashboard
        profile={profile({ definingDoc: doc, partOfComposite: { name: "Spark Party", slug: "spark-party" } })}
      />,
    );
    expect(screen.getByText(/A\.2\.2/)).toBeInTheDocument();
    expect(screen.getByText(/part of Spark Party/)).toBeInTheDocument();
  });
});

describe("ActorDashboard sections", () => {
  it("renders the composite-party block with member chips", () => {
    render(
      <ActorDashboard
        profile={profile({
          entity: entity({ et: "composite_party", st: null }),
          comprisesMembers: [
            { name: "Foundation", slug: "foundation" },
            { name: "Dev Co", slug: null },
          ],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Composite Party" })).toBeInTheDocument();
    expect(screen.getByText("Foundation")).toBeInTheDocument();
    expect(screen.getByText("Dev Co")).toBeInTheDocument();
  });

  it("renders responsibilities and primitives sections only when populated", () => {
    const { rerender } = render(<ActorDashboard profile={profile()} />);
    expect(screen.queryByText("Responsibilities")).not.toBeInTheDocument();
    expect(screen.queryByText("Primitives")).not.toBeInTheDocument();

    rerender(
      <ActorDashboard
        profile={profile({ adRows: [{} as never], primitives: [{} as never] })}
      />,
    );
    expect(screen.getByText("Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("Primitives")).toBeInTheDocument();
    expect(screen.getByTestId("resp")).toBeInTheDocument();
    expect(screen.getByTestId("instances")).toBeInTheDocument();
  });

  it("renders relation rows with a link when the other party has a slug", () => {
    render(
      <ActorDashboard
        profile={profile({
          relations: [
            {
              edge: { f: "e1", ft: "entity", t: "e2", tt: "entity", e: "delegates_to" } as never,
              direction: "outbound",
              otherLabel: "Grove",
              otherId: "e2",
              otherSlug: "grove",
              otherEt: "agent",
            },
            {
              edge: { f: "e3", ft: "entity", t: "e1", tt: "entity", e: "delegates_to" } as never,
              direction: "inbound",
              otherLabel: "Orphan",
              otherId: "e3",
              otherSlug: null,
              otherEt: "agent",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Relationships")).toBeInTheDocument();
    const grove = screen.getByText("Grove");
    expect(grove.tagName).toBe("A");
    // No slug → plain span, not a link.
    expect(screen.getByText("Orphan").tagName).not.toBe("A");
  });

  it("renders recommendations with report and entity links", () => {
    render(
      <ActorDashboard
        profile={profile({
          recommendations: [
            { kind: "missing-rp", label: "2 AD docs without a responsible party", detail: "detail A", reportLink: "/reports/active-data" },
            { kind: "governance-edge", label: "Governance relationship: X", detail: "Edge type: y", entityLink: "some-actor" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Notable")).toBeInTheDocument();
    expect(screen.getByText("2 AD docs without a responsible party")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "view report →" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "view actor →" })).toBeInTheDocument();
  });

  it("scrolls a matching hash target into view on mount", () => {
    window.location.hash = "#instances";
    const el = document.createElement("div");
    el.id = "instances";
    document.body.appendChild(el);
    render(<ActorDashboard profile={profile({ primitives: [{} as never] })} />);
    expect(el.scrollIntoView).toHaveBeenCalled();
    document.body.removeChild(el);
    window.location.hash = "";
  });

  it("renders the rewards section when a rewards agent is present", () => {
    render(<ActorDashboard profile={profile({ rewardsAgent: { name: "Spark" } as never })} />);
    expect(screen.getByText("Rewards")).toBeInTheDocument();
    expect(screen.getByTestId("rewards")).toBeInTheDocument();
  });
});
