// Which prime's rate-limit values a reader document is part of: the instance it
// defines, the instance whose params it states (a RateLimitID, a maxAmount), or
// the instance whose params its direct children state, so a "Rate Limits"
// heading over its Inflow and Outflow leaves shows their values too.
// The check needs every instance of that prime, not only this one, because an
// address two instances list belongs to neither (pauInstanceKeys.ts). Which
// values are a prime's is pauPrimeSources.ts's rule; this reads it over the
// browser's graph.
import type { GraphEntity } from "../types.ts";
import type { GraphData } from "./graphData.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { graphView, primeValueSources } from "./pauPrimeSources.ts";

export interface DocValueSources {
  /** The prime entity id. */
  prime: string;
  sources: ValueSource[];
  /** The document's direct children: a value one of them states belongs to the document too. */
  children: string[];
}

const states = (e: GraphEntity, id: string) => e.did === id || Object.values(graphView(e).meta.params ?? {}).some(([, src]) => src === id);
const instancesOf = (graph: GraphData) => [...graph.instances, ...graph.invocations];
const sourcesOf = (prime: GraphEntity, graph: GraphData) => primeValueSources(instancesOf(graph).map(graphView), prime.id, graphView(prime));

/** The prime and all its rate-limit sources when the document, or one of its direct children, defines or states one of its instances' params, else null. */
export function docValueSources(id: string, graph: GraphData | null, children: string[] = []): DocValueSources | null {
  if (!graph) return null;
  const ids = [id, ...children];
  const statesAny = (e: GraphEntity) => ids.some((d) => states(e, d));
  const hit = instancesOf(graph).find((e) => statesAny(e) && graphView(e).meta.agent_doc_id);
  const agent = hit && graphView(hit).meta.agent_doc_id;
  const primeEntity = agent ? graph.participants.find((p) => p.id === agent) : graph.participants.find((p) => p.st === "prime" && statesAny(p));
  if (!primeEntity) return null;
  return { prime: primeEntity.id, sources: sourcesOf(primeEntity, graph), children };
}

/** Every rate-limit source of one prime in the browser's graph, by its entity id; null before the graph loads or for an unknown prime. */
export function graphPrimeSources(primeId: string, graph: GraphData | null): ValueSource[] | null {
  const prime = graph?.participants.find((p) => p.id === primeId);
  return graph && prime ? sourcesOf(prime, graph) : null;
}
