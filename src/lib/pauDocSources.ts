// Which prime's rate-limit values a reader document is part of: the instance it
// defines, or the instance whose params it states (a RateLimitID, a maxAmount).
// The check needs every instance of that prime, not only this one, because an
// address two instances list belongs to neither (pauInstanceKeys.ts).
import type { GraphEntity } from "../types.ts";
import type { GraphData } from "./graphData.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

interface InstanceMeta {
  agent_doc_id?: string;
  params?: ValueSource["params"];
}

export interface DocValueSources {
  /** The prime entity id. */
  prime: string;
  sources: ValueSource[];
}

const parsed = new WeakMap<GraphEntity, InstanceMeta>();
function metaOf(e: GraphEntity): InstanceMeta {
  let m = parsed.get(e);
  if (!m) {
    try {
      m = e.m ? (JSON.parse(e.m) as InstanceMeta) : {};
    } catch {
      m = {};
    }
    parsed.set(e, m);
  }
  return m;
}

const states = (e: GraphEntity, id: string) => e.did === id || Object.values(metaOf(e).params ?? {}).some(([, src]) => src === id);
const source = (e: GraphEntity, docId: string | null): ValueSource => ({ name: e.name, docId, params: metaOf(e).params ?? {} });

/** The prime and all its rate-limit sources when the document defines or states one of its instances' params, else null. */
export function docValueSources(id: string, graph: GraphData | null): DocValueSources | null {
  if (!graph) return null;
  const instances = [...graph.instances, ...graph.invocations];
  const hit = instances.find((e) => states(e, id) && metaOf(e).agent_doc_id);
  const primeEntity = hit ? graph.participants.find((p) => p.id === metaOf(hit).agent_doc_id) : graph.participants.find((p) => p.st === "prime" && states(p, id));
  if (!primeEntity) return null;
  const own = instances.filter((e) => metaOf(e).agent_doc_id === primeEntity.id).map((e) => source(e, e.did));
  return { prime: primeEntity.id, sources: [source(primeEntity, null), ...own] };
}
