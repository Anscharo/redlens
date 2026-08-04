// The drift-count/tripwire stderr contract of the entity-edge phase: an
// empty (or fully renumbered) corpus must produce bucketed [drift-count]
// lines and duty_for zero-edge tripwires — not silence. This is the
// entity-edges half of the graph-tripwires contract (see
// graph-tripwires.test.ts for the gate/type half).

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractEntities } from "../scripts/lib/graph-entities.mjs";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractEntityEdges } from "../scripts/lib/graph-entity-edges.mjs";

afterEach(() => vi.restoreAllMocks());

describe("extractEntityEdges drift signals", () => {
  it("emits zero-bucket [drift-count] lines and duty tripwires on an empty corpus", () => {
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const ctx = extractEntities([], new Map(), new Map(), {});
    const edges = extractEntityEdges([], new Map(), new Map(), ctx, {});

    expect(edges).toEqual([]);
    const driftCounts = warns.filter((w) => w.includes("[drift-count]"));
    expect(driftCounts).toContain("  [drift-count] responsible_party_for unresolved: 0");
    expect(driftCounts).toContain("  [drift-count] process_step_responsible_party_for unresolved: 0");
    expect(driftCounts).toContain("  [drift-count] org-prose unresolved: 0");
    // One per acting role (govops / facilitator / executor).
    expect(driftCounts.filter((w) => w.includes("duty_for["))).toHaveLength(3);
    // Zero duty edges is a tripwire per role, never silence.
    const tripwires = warns.filter((w) => w.includes("tripwire: duty_for["));
    expect(tripwires).toHaveLength(3);
    expect(tripwires.join("\n")).toMatch(/graph-duties\.mjs/);
  });
});
