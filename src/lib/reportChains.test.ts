// Tests for the GovOps report's chain/pill derivation. The load-bearing case:
// the Core chain has no primes (Core Council Executor Agent 1 serves Sky Core),
// so pill lists must come from the gov edges — chain-derived lists dropped
// Atlas Axis and the core executor, leaving core-duty rows unfilterable.

import { describe, it, expect } from "vitest";
import type { GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graph";
import { buildChains, rolePills, stripExecutorPrefix } from "./reportChains";

const participants: GraphEntity[] = [
  { id: "soter", slug: "soter-labs", name: "Soter Labs", et: "govops_org", st: null, did: null },
  { id: "atlas-axis", slug: "atlas-axis", name: "Atlas Axis", et: "govops_org", st: null, did: null },
  { id: "exec", slug: "amatsu", name: "Operational Executor Agent Amatsu", et: "agent", st: "operational_executor", did: null },
  { id: "core-exec", slug: "cc-exec-1", name: "Core Council Executor Agent 1", et: "agent", st: "core_executor", did: null },
  { id: "prime", slug: "spark", name: "Spark", et: "agent", st: "prime", did: null },
];

const edges: RelationEdge[] = [
  { f: "soter", ft: "entity", t: "exec", tt: "entity", e: "operational_govops_for", s: [] },
  { f: "atlas-axis", ft: "entity", t: "core-exec", tt: "entity", e: "core_govops_for", s: [] },
  { f: "exec", ft: "entity", t: "prime", tt: "entity", e: "operational_executor_agent_for", s: [] },
];

const graph: GraphData = { participants, instances: [], invocations: [], primitives: [], edges };

describe("buildChains", () => {
  it("resolves prime → executor → govops with the executor prefix stripped", () => {
    const chains = buildChains(graph);
    expect(chains.get("Spark")).toMatchObject({
      agentId: "prime",
      executorName: "Amatsu",
      govopsName: "Soter Labs",
    });
  });
});

describe("rolePills", () => {
  it("includes the Core side (no primes) that prime-chains cannot reach", () => {
    const { govops, executors } = rolePills(graph);
    expect(govops.map((p) => p.name).sort()).toEqual(["Atlas Axis", "Soter Labs"]);
    expect(executors.map((p) => p.name).sort()).toEqual(["Amatsu", "Core Council Executor Agent 1"]);
  });
});

describe("stripExecutorPrefix", () => {
  it("strips both operational and core-council prefixes", () => {
    expect(stripExecutorPrefix("Operational Executor Agent Amatsu")).toBe("Amatsu");
    expect(stripExecutorPrefix("Core Council Executor Agent 1")).toBe("Core Council Executor Agent 1"); // no trailing name — unchanged
    expect(stripExecutorPrefix("Core Council Executor Agent Alpha")).toBe("Alpha");
  });
});
