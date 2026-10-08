// @vitest-environment jsdom
// One route serves an actor's Info page and every subpage; a segment that
// names no subpage redirects to the Info page.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("./lazyRoutes", () => ({
  RadarPage: ({ actorSlug, page }: { actorSlug: string; page?: string }) => (
    <div data-testid="radar-page" data-slug={actorSlug} data-page={page ?? ""} />
  ),
}));

import { RADAR_ACTOR_ROUTE, RadarActorRoute } from "./radarRoute";

afterEach(cleanup);

function at(path: string) {
  const mem = memoryLocation({ path, record: true });
  render(
    <Router hook={mem.hook}>
      <Route path={RADAR_ACTOR_ROUTE}>
        {(params: { slug: string; page?: string }) => <RadarActorRoute {...params} query="" />}
      </Route>
    </Router>,
  );
  return mem;
}

describe("RadarActorRoute", () => {
  it("serves the Info page and a subpage from one route", () => {
    at("/radar/spark");
    expect(screen.getByTestId("radar-page")).toHaveAttribute("data-page", "");
    cleanup();
    at("/radar/spark/history");
    expect(screen.getByTestId("radar-page")).toHaveAttribute("data-page", "history");
    expect(screen.getByTestId("radar-page")).toHaveAttribute("data-slug", "spark");
  });

  it("redirects a segment that names no subpage to the Info page", () => {
    const mem = at("/radar/spark/nonsense");
    expect(mem.history.at(-1)).toBe("/radar/spark");
  });
});
