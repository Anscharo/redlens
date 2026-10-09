// A prime's rate-limit value sources, read from the graph's entities: the
// prime's own params, then every instance and invocation naming it as its
// agent. The chat's atlas-vs-contract facts (src/server/onchain/pau-value-facts.ts)
// and the weekly PAU census (scripts/required/check-pau-census.ts) both read
// this list, so both compare the same values.
import type { ValueSource } from "./pauInstanceKeys.ts";
import { VALUE_PARAM_RE } from "./pauParams.ts";

/** The graph entity fields the sources are read from (graph.json and the server's indexes share them). */
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

/** An entity's meta; an unreadable one reads as empty, so one bad row cannot fail the source. */
function metaOf(e: SourceEntity | undefined): SourceMeta {
  try {
    return JSON.parse(e?.meta ?? "{}") as SourceMeta;
  } catch {
    return {};
  }
}

const isInstance = (e: SourceEntity) => e.entity_type === "instance" || e.entity_type === "invocation";

/** The prime's own params and every instance's, as the check reads them. */
export function primeValueSources(entities: SourceEntity[], prime: string, primeEntity?: SourceEntity): ValueSource[] {
  const own = entities.filter((e) => isInstance(e) && e.meta?.includes(prime) && metaOf(e).agent_doc_id === prime);
  const prim = primeEntity ?? entities.find((e) => e.id === prime);
  return [{ name: prim?.name ?? "", docId: null, params: metaOf(prim).params ?? {} }, ...own.map((e) => ({ name: e.name, docId: e.defining_doc_id, params: metaOf(e).params ?? {} }))];
}

/** Every prime an instance stating a maxAmount or slope belongs to. */
export function primesStatingValues(entities: SourceEntity[]): string[] {
  const primes = new Set<string>();
  for (const e of entities) {
    const m = isInstance(e) ? metaOf(e) : {};
    if (m.agent_doc_id && Object.keys(m.params ?? {}).some((name) => VALUE_PARAM_RE.test(name))) primes.add(m.agent_doc_id);
  }
  return [...primes];
}
