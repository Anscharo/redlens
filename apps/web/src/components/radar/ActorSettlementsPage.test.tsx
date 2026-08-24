// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ActorProfile } from "../../lib/actorIndex";
import type { GraphEntity } from "@/types";

vi.mock("./ActorSettlements", () => ({ ActorSettlements: () => <div data-testid="settlements-body" /> }));

import { ActorSettlementsPage } from "./ActorSettlementsPage";

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
  } as ActorProfile;
}

describe("ActorSettlementsPage", () => {
  it("titles the page and links back to the actor dashboard", () => {
    render(<ActorSettlementsPage profile={profile()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Monthly settlement" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "radar · Spark" })).toHaveAttribute("href", "/radar/spark");
    expect(screen.getByRole("link", { name: "Sky Forum reports" })).toHaveAttribute(
      "href",
      "https://forum.skyeco.com/tag/monthly-settlement-cycle/1493",
    );
    expect(screen.getByTestId("settlements-body")).toBeInTheDocument();
  });
});
