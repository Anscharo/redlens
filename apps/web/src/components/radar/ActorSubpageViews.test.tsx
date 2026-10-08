// @vitest-environment jsdom
// The History, Primitive instances and PAUs subpages: each in the shared
// shell, handing the profile's data to the body it frames.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ActorProfile } from "../../lib/actorIndex";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("./ActorHistory", () => ({ ActorHistory: () => <div data-testid="history" /> }));
vi.mock("./ActorInstances", () => ({
  ActorInstances: ({ prime }: { prime?: { slug: string } }) => <div data-testid="instances" data-prime={prime?.slug} />,
}));
vi.mock("./ActorPau", () => ({
  ActorPau: ({ prime }: { prime: { id: string } }) => <div data-testid="pau" data-prime={prime.id} />,
}));

import { ActorHistoryPage } from "./ActorHistoryPage";
import { ActorInstancesPage } from "./ActorInstancesPage";
import { ActorPauPage } from "./ActorPauPage";

afterEach(cleanup);

const profile = (overrides: Partial<ActorProfile> = {}) =>
  ({
    entity: { id: "e1", slug: "spark", name: "Spark", et: "agent", st: "prime", did: null },
    instances: [],
    primitives: [],
    ...overrides,
  }) as unknown as ActorProfile;

describe("actor subpages", () => {
  it("frames History in the shell", () => {
    render(<ActorHistoryPage profile={profile()} />);
    expect(screen.getByRole("heading", { level: 1, name: "History of doc changes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "radar · Spark" })).toHaveAttribute("href", "/radar/spark");
    expect(screen.getByTestId("history")).toBeInTheDocument();
  });

  it("hands the Prime to its instances, or says it has none", () => {
    render(<ActorInstancesPage profile={profile({ primitives: [{} as never] })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Primitive instances" })).toBeInTheDocument();
    expect(screen.getByTestId("instances")).toHaveAttribute("data-prime", "spark");
    cleanup();
    render(<ActorInstancesPage profile={profile()} />);
    expect(screen.getByText("no primitive instances")).toBeInTheDocument();
  });

  it("hands the Prime to its PAUs", () => {
    render(<ActorPauPage profile={profile()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Parallelized Allocation Units" })).toBeInTheDocument();
    expect(screen.getByTestId("pau")).toHaveAttribute("data-prime", "e1");
  });
});
