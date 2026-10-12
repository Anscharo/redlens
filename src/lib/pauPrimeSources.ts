// A prime's rate-limit value sources: the prime's own params, then every
// instance and invocation naming it as its agent, in the entities' order. This
// is the one rule for which values are a prime's. The chat's atlas-vs-contract
// facts (src/server/onchain/pau-value-facts.ts), the weekly PAU census
// (src/lib/pauCensus.ts), the reader's panel, the Radar PAUs page and the audit
// report all read it, through the adapter for their entity shape, so every one
// of them compares the same values.
import type { GraphEntity } from "../types.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { VALUE_PARAM_RE } from "./pauParams.ts";

/** The graph entity fields as graph.json and the server's indexes carry them. */
export interface SourceEntity {
  id: string;
  name: string;
  entity_type: string;
  defining_doc_id: string | null;
  meta: string | null;
}

interface SourceMeta {
  agent_doc_id?: string;
  params?: ValueSource["params"];
}

/** What the rule reads of an entity, whichever shape it came in. */
export interface SourceView {
  id: string;
  name: string;
  instance: boolean;
  docId: string | null;
  meta: SourceMeta;
}

/** An entity's meta; an unreadable one reads as empty, so one bad row cannot fail the source. */
function parseMeta(meta: string | null | undefined): SourceMeta {
  try {
    return meta ? (JSON.parse(meta) as SourceMeta) : {};
  } catch {
    return {};
  }
}

const isInstance = (type: string) => type === "instance" || type === "invocation";

/** Memoises an adapter per entity object, so a loaded graph parses each meta once. */
function memo<E extends object>(make: (e: E) => SourceView): (e: E) => SourceView {
  const seen = new WeakMap<E, SourceView>();
  return (e) => seen.get(e) ?? seen.set(e, make(e)).get(e)!;
}

/** A graph.json or server-index row. */
export const rowView = memo((e: SourceEntity): SourceView => ({ id: e.id, name: e.name, instance: isInstance(e.entity_type), docId: e.defining_doc_id, meta: parseMeta(e.meta) }));

/** A relations.json entity, as the browser's graph holds it. */
export const graphView = memo((e: GraphEntity): SourceView => ({ id: e.id, name: e.name, instance: isInstance(e.et), docId: e.did, meta: parseMeta(e.m) }));

const source = (e: SourceView | undefined, docId: string | null): ValueSource => ({ name: e?.name ?? "", docId, params: e?.meta.params ?? {} });

/** The prime's own params and every instance's, as the check reads them; `primeView` saves the lookup when the caller has it. */
export function primeValueSources(views: SourceView[], prime: string, primeView?: SourceView): ValueSource[] {
  const own = views.filter((e) => e.instance && e.meta.agent_doc_id === prime);
  return [source(primeView ?? views.find((e) => e.id === prime), null), ...own.map((e) => source(e, e.docId))];
}

/** Every prime an instance stating a maxAmount or slope belongs to. */
export function primesStatingValues(views: SourceView[]): string[] {
  const primes = new Set<string>();
  for (const e of views) {
    const m = e.meta;
    if (e.instance && m.agent_doc_id && Object.keys(m.params ?? {}).some((name) => VALUE_PARAM_RE.test(name))) primes.add(m.agent_doc_id);
  }
  return [...primes];
}
