// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ActorProfile } from "../../lib/actorIndex";
import type { GraphEntity } from "@/types";
import { EMPTY_OMNI } from "../../lib/omniDocs";

vi.mock("./ActorHistory", () => ({ ActorHistory: () => <div data-testid="history-body" /> }));

import { ActorHistoryPage } from "./ActorHistoryPage";

afterEach(cleanup);

function profile(): ActorProfile {
  const entity: GraphEntity = {
    id: "e1", slug: "spark", name: "Spark", et: "agent", st: "prime", did: null,
  };
  return {
    entity,
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
    omni: EMPTY_OMNI,
  } as ActorProfile;
}

describe("ActorHistoryPage", () => {
  it("titles the page and links back to the actor dashboard", () => {
    render(<ActorHistoryPage profile={profile()} />);
    expect(screen.getByRole("heading", { level: 1, name: "History of doc changes related to Spark" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "radar · Spark" })).toHaveAttribute("href", "/radar/spark");
    expect(screen.getByTestId("history-body")).toBeInTheDocument();
  });
});
