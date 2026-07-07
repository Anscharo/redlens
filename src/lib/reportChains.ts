// Prime → executor → GovOps/Facilitator chain resolution + filter-pill lists
// for the role-responsibility reports. Pure module (no React) so it's testable
// without a DOM.

import type { GraphData } from "./graph";
import type { GraphEntity } from "../types";
import { EXEC_EDGES, FAC_EDGES, GOV_EDGES } from "./roleEdges";
import { toAnchorId } from "./anchorId";

export interface Chain {
  agentId: string;
  executorName: string;
  executorId: string;
  govopsName: string;
  govopsId: string;
  facilitatorName: string;
  facilitatorId: string;
}

// "Operational Executor Agent Amatsu" → "Amatsu". Numbered executors keep the
// full name ("Core Council Executor Agent 1" — a bare "1" pill means nothing).
export const stripExecutorPrefix = (name: string) => {
  const stripped = name.replace(/^(Operational|Core Council) Executor Agent\s+/i, "");
  return /[A-Za-z]/.test(stripped) ? stripped : name;
};

// Prime name → its executor + govops + facilitator, resolved via the
// role-as-edge chain.
export function buildChains(graph: GraphData): Map<string, Chain> {
  const entityById = new Map<string, GraphEntity>(graph.participants.map((e) => [e.id, e]));
  const execEdges = graph.edges.filter((e) => EXEC_EDGES.has(e.e));
  const govEdges = graph.edges.filter((e) => GOV_EDGES.has(e.e));
  const facEdges = graph.edges.filter((e) => FAC_EDGES.has(e.e));
  const primes = graph.participants.filter((e) => e.et === "agent" && e.st === "prime");
  const map = new Map<string, Chain>();
  for (const prime of primes) {
    const execEdge = execEdges.find((e) => e.t === prime.id);
    const executor = execEdge ? entityById.get(execEdge.f) : null;
    if (!executor) continue;
    const govEdge = govEdges.find((e) => e.t === executor.id);
    const gov = govEdge ? entityById.get(govEdge.f) : null;
    const facEdge = facEdges.find((e) => e.t === executor.id);
    const fac = facEdge ? entityById.get(facEdge.f) : null;
    map.set(prime.name, {
      agentId: prime.id,
      executorName: stripExecutorPrefix(executor.name),
      executorId: executor.id,
      govopsName: gov?.name ?? "",
      govopsId: gov?.id ?? "",
      facilitatorName: fac?.name ?? "",
      facilitatorId: fac?.id ?? "",
    });
  }
  return map;
}

// Holder entity name → set of executor anchor slugs, straight from the role
// edges (GOV_EDGES / FAC_EDGES). Lets a duty/active-data/process-step row —
// which carries only its govops/facilitator holder, no executor and (Core side)
// no prime — still resolve to an executor for the executor filter. Prime chains
// (buildChains) can't cover this: the Core chain has no primes, so duty rows
// whose holder is a Core org never surface an executor via chains.get(prime).
export function holderExecutorSlugs(
  graph: GraphData,
  edgeSet: Set<string> = GOV_EDGES,
): Map<string, Set<string>> {
  const entityById = new Map<string, GraphEntity>(graph.participants.map((e) => [e.id, e]));
  const m = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!edgeSet.has(e.e)) continue;
    const holder = entityById.get(e.f);
    const exec = entityById.get(e.t);
    if (!holder || !exec) continue;
    const slug = toAnchorId(stripExecutorPrefix(exec.name));
    const set = m.get(holder.name) ?? m.set(holder.name, new Set()).get(holder.name)!;
    set.add(slug);
  }
  return m;
}

export interface Pill {
  id: string;
  name: string;
}

// Filter-pill lists straight from the role edges, NOT from the prime chains:
// the Core chain has no primes (Core Council Executor Agent 1 serves Sky Core),
// so chain-derived lists silently dropped the core org and the core executor —
// leaving the report's core-duty rows unfilterable. `edgeSet` picks the role
// (GOV_EDGES for the GovOps report, FAC_EDGES for the Facilitator one).
export function rolePills(
  graph: GraphData,
  edgeSet: Set<string> = GOV_EDGES,
): { holders: Pill[]; executors: Pill[] } {
  const entityById = new Map<string, GraphEntity>(graph.participants.map((e) => [e.id, e]));
  const holders = new Map<string, string>();
  const executors = new Map<string, string>();
  for (const e of graph.edges) {
    if (!edgeSet.has(e.e)) continue;
    const holder = entityById.get(e.f);
    const exec = entityById.get(e.t);
    if (holder && !holders.has(holder.id)) holders.set(holder.id, holder.name);
    if (exec && !executors.has(exec.id)) executors.set(exec.id, stripExecutorPrefix(exec.name));
  }
  const toPills = (m: Map<string, string>) => [...m.entries()].map(([id, name]) => ({ id, name }));
  return { holders: toPills(holders), executors: toPills(executors) };
}

// URL-synced filter state. slug = toAnchorId(name) — URL-safe; raw names never
// enter the URL.
export type ActiveFilter =
  | { kind: "govops"; slug: string }
  | { kind: "facilitator"; slug: string }
  | { kind: "executor"; slug: string }
  | { kind: "agent"; slug: string }
  | null;

export function filterEqual(a: ActiveFilter, b: ActiveFilter): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.slug === b.slug;
}
