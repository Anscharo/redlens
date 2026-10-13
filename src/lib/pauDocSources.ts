// Which prime's rate-limit values a reader document is part of: the instance it
// defines, the instance whose params it states (a RateLimitID, a maxAmount), or,
// for a "Rate Limits" heading, the instance whose params its direct children
// state, so the heading over the Inflow and Outflow leaves shows their values.
// The check needs every instance of that prime, not only this one, because an
// address two instances list belongs to neither (pauInstanceKeys.ts). Which
// values are a prime's is pauPrimeSources.ts's rule; this reads it over the
// browser's graph.
import type { GraphEntity } from "../types.ts";
import type { GraphData } from "./graphData.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { graphView, primeValueSources } from "./pauPrimeSources.ts";
import { RATE_LIMITS_TITLE_RE } from "./pauParams.ts";
import { ancestorsOf, limitDocSources, limitHeadingScope, withInstanceLimitDocs, type LimitDocs } from "./pauLimitDocs.ts";

export interface DocValueSources {
  /** The prime entity id. */
  prime: string;
  sources: ValueSource[];
  /** A Rate Limits heading's direct children, whose values belong to it too; empty for any other document. */
  children: string[];
}

/** The open document as the check reads it: its title, and its direct children. */
export interface DocHeading {
  title: string;
  children: string[];
}

const states = (e: GraphEntity, id: string) => e.did === id || Object.values(graphView(e).meta.params ?? {}).some(([, src]) => src === id);
const instancesOf = (graph: GraphData) => [...graph.instances, ...graph.invocations];
const sourcesOf = (prime: GraphEntity, graph: GraphData) => primeValueSources(instancesOf(graph).map(graphView), prime.id, graphView(prime));

/** The prime's sources with the limit values the atlas documents state: in each instance's own subtree, and in the prime's limit documents (pauLimitDocs.ts). */
const withLimitDocs = (sources: ValueSource[], prime: GraphEntity, docs: LimitDocs): ValueSource[] => [
  ...sources.map((s) => withInstanceLimitDocs(s, docs)),
  ...limitDocSources(sources[0], prime.did, docs),
];

const stateValuesIn = (sources: ValueSource[], id: string) => sources.some((s) => s.docId === id || Object.values(s.params).some((v) => v[1] === id));

/** The prime whose artifact the document sits in, when no instance states it: the nearest ancestor that is a prime's defining document. */
function primeAbove(id: string, graph: GraphData, docs: LimitDocs): GraphEntity | undefined {
  const ancestry = new Set([id, ...ancestorsOf(id, docs).map((n) => n.id)]);
  return graph.participants.find((p) => p.st === "prime" && p.did && ancestry.has(p.did));
}

/**
 * The prime and all its rate-limit sources when the document, or a Rate Limits
 * heading's direct child, defines or states one of its instances' params, or
 * (given the atlas documents) sits in a prime's artifact; else null. The
 * sources then also hold the prime's documents that state limit values
 * (pauLimitDocs.ts), and `children` the documents a Rate Limits or chain
 * heading shows the values of.
 */
export function docValueSources(id: string, graph: GraphData | null, heading?: DocHeading, docs?: LimitDocs): DocValueSources | null {
  if (!graph) return null;
  const direct = heading && RATE_LIMITS_TITLE_RE.test(heading.title.trim()) ? heading.children : [];
  const statesAny = (e: GraphEntity) => [id, ...direct].some((d) => states(e, d));
  const hit = instancesOf(graph).find((e) => statesAny(e) && graphView(e).meta.agent_doc_id);
  const agent = hit && graphView(hit).meta.agent_doc_id;
  const stating = agent ? graph.participants.find((p) => p.id === agent) : graph.participants.find((p) => p.st === "prime" && statesAny(p));
  const scope = docs ? limitHeadingScope(id, docs) : [];
  const above = !stating && docs ? primeAbove(id, graph, docs) : undefined;
  const primeEntity = stating ?? above;
  if (!primeEntity) return null;
  const base = sourcesOf(primeEntity, graph);
  const sources = docs ? withLimitDocs(base, primeEntity, docs) : base;
  if (!stating && scope.length === 0 && !stateValuesIn(sources, id)) return null;
  return { prime: primeEntity.id, sources, children: [...new Set([...direct, ...scope])] };
}

/**
 * Every rate-limit source of one prime in the browser's graph, by its entity id,
 * with the prime's documents that state limit values (pauLimitDocs.ts) when the
 * atlas documents are given; null before the graph loads or for an unknown prime.
 */
export function graphPrimeSources(primeId: string, graph: GraphData | null, docs?: LimitDocs): ValueSource[] | null {
  const prime = graph?.participants.find((p) => p.id === primeId);
  if (!graph || !prime) return null;
  const sources = sourcesOf(prime, graph);
  return docs ? withLimitDocs(sources, prime, docs) : sources;
}
