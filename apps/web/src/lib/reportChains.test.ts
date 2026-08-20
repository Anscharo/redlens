// Tests for the GovOps report's chain/pill derivation. The load-bearing case:
// the Core chain has no primes (Core Council Executor Agent 1 serves Sky Core),
// so pill lists must come from the gov edges — chain-derived lists dropped
// Atlas Axis and the core executor, leaving core-duty rows unfilterable.

import { describe, it, expect } from "vitest";
import type { GraphEntity, RelationEdge } from "@/types";
import type { GraphData } from "./graph";
import { FAC_EDGES, GOV_EDGES } from "@/lib/roleEdges";
import { buildChains, rolePills, stripExecutorPrefix, holderExecutorSlugs } from "./reportChains";

const participants: GraphEntity[] = [
  { id: "soter", slug: "soter-labs", name: "Soter Labs", et: "govops_org", st: null, did: null },
  { id: "atlas-axis", slug: "atlas-axis", name: "Atlas Axis", et: "govops_org", st: null, did: null },
  { id: "endgame", slug: "endgame-edge", name: "Endgame Edge", et: "facilitator_org", st: null, did: null },
  { id: "jansky", slug: "jansky", name: "JanSky", et: "facilitator_org", st: null, did: null },
  { id: "exec", slug: "amatsu", name: "Operational Executor Agent Amatsu", et: "agent", st: "operational_executor", did: null },
  { id: "core-exec", slug: "cc-exec-1", name: "Core Council Executor Agent 1", et: "agent", st: "core_executor", did: null },
  { id: "prime", slug: "spark", name: "Spark", et: "agent", st: "prime", did: null },
];

const edges: RelationEdge[] = [
  { f: "soter", ft: "entity", t: "exec", tt: "entity", e: "operational_govops_for", s: [] },
  { f: "atlas-axis", ft: "entity", t: "core-exec", tt: "entity", e: "core_govops_for", s: [] },
  { f: "endgame", ft: "entity", t: "exec", tt: "entity", e: "operational_facilitator_for", s: [] },
  { f: "jansky", ft: "entity", t: "core-exec", tt: "entity", e: "core_facilitator_for", s: [] },
  { f: "exec", ft: "entity", t: "prime", tt: "entity", e: "operational_executor_agent_for", s: [] },
];

const graph: GraphData = { participants, instances: [], invocations: [], primitives: [], edges };

describe("buildChains", () => {
  it("resolves prime → executor → govops/facilitator with the executor prefix stripped", () => {
    const chains = buildChains(graph);
    expect(chains.get("Spark")).toMatchObject({
      agentId: "prime",
      executorName: "Amatsu",
      govopsName: "Soter Labs",
      facilitatorName: "Endgame Edge",
    });
  });
});

describe("rolePills", () => {
  it("includes the Core side (no primes) that prime-chains cannot reach", () => {
    const { holders, executors } = rolePills(graph);
    expect(holders.map((p) => p.name).sort()).toEqual(["Atlas Axis", "Soter Labs"]);
    expect(executors.map((p) => p.name).sort()).toEqual(["Amatsu", "Core Council Executor Agent 1"]);
  });

  it("selects the role by edge set — FAC_EDGES yields the facilitator holders", () => {
    const { holders } = rolePills(graph, FAC_EDGES);
    expect(holders.map((p) => p.name).sort()).toEqual(["Endgame Edge", "JanSky"]);
  });
});

describe("holderExecutorSlugs", () => {
  it("maps a core-govops holder name straight to the core executor's slug, bypassing the primeless Core chain", () => {
    // Atlas Axis (core govops) → Core Council Executor Agent 1: this pair has
    // no prime, so buildChains/chains.get(prime) can never surface it, but a
    // duty/active-data row carrying only the `govops` holder name still needs
    // to resolve to the core executor for the executor filter (FIX 2).
    const m = holderExecutorSlugs(graph, GOV_EDGES);
    expect(m.get("Atlas Axis")?.has("core-council-executor-agent-1")).toBe(true);
    expect(m.get("Soter Labs")?.has("amatsu")).toBe(true);
  });

  it("selects the role by edge set — FAC_EDGES resolves facilitator holders", () => {
    const m = holderExecutorSlugs(graph, FAC_EDGES);
    expect(m.get("JanSky")?.has("core-council-executor-agent-1")).toBe(true);
    expect(m.get("Endgame Edge")?.has("amatsu")).toBe(true);
  });
});

describe("stripExecutorPrefix", () => {
  it("strips both operational and core-council prefixes", () => {
    expect(stripExecutorPrefix("Operational Executor Agent Amatsu")).toBe("Amatsu");
    expect(stripExecutorPrefix("Core Council Executor Agent 1")).toBe("Core Council Executor Agent 1"); // no trailing name — unchanged
    expect(stripExecutorPrefix("Core Council Executor Agent Alpha")).toBe("Alpha");
  });
});
