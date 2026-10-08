// @vitest-environment jsdom
// Which subpages each actor's sub nav offers: Primes only, Settlements only
// for a Prime with settlement cycles, PAUs only for one with a PAU snapshot.
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { SidebarGroup } from "../../lib/actorIndex";

vi.mock("../../lib/settlements", () => ({
  loadSettlements: () => Promise.resolve({ source: {}, reports: [] }),
  reportsForPrime: (_b: unknown, slug: string) => (slug === "spark" ? [{}] : []),
}));

vi.mock("../../lib/pau", () => ({
  loadPau: () => Promise.resolve({ deployments: [] }),
  snapshotsForPrime: (_r: unknown, prime: string) => (prime === "a2" ? [{}] : []),
}));

import { useActorSubpages } from "./useActorSubpages";

const groups: SidebarGroup[] = [
  {
    label: "Prime Agents",
    actors: [
      { id: "a1", slug: "spark", name: "Spark", et: "agent", st: "prime", docId: null },
      { id: "a2", slug: "grove", name: "Grove", et: "agent", st: "prime", docId: null },
    ],
  },
  { label: "Facilitators", actors: [{ id: "f1", slug: "soter", name: "Soter", et: "facilitator_org", st: null, docId: null }] },
];

describe("useActorSubpages", () => {
  it("lists every Prime's subpages in nav order, each data-backed one only where it has data", async () => {
    const { result } = renderHook(() => useActorSubpages(groups));
    await waitFor(() => expect(result.current.get("grove")).toContain("pau"));
    expect(result.current.get("spark")).toEqual(["settlements", "history", "instances"]);
    expect(result.current.get("grove")).toEqual(["history", "instances", "pau"]);
    expect(result.current.has("soter")).toBe(false);
  });
});
