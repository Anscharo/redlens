// What the atlas says about each PAU rate-limit key, per prime: the name its
// RateLimitID param gives it, and the documents it belongs to (the one stating
// the key, the instance it sits in, and the ones setting its maxAmount and
// slope). Read from build-graph's params, the same rows the Radar names keys by.
import type { Entity, Indexes } from "../retrieval/indexes.ts";
import { RATE_LIMIT_ID_RE } from "../../lib/atlasHashes.ts";
import { instanceKeyIndex, primeKeyedInstance, type AtlasKeyRef, type KeyedInstance } from "../../lib/pauView.ts";

type Params = Record<string, [string, string | null, string?]>;

export interface PrimeAtlasRefs {
  /** Key → the params naming it, sorted by label. */
  labels: Map<string, AtlasKeyRef[]>;
  /** Key → every document it belongs to. */
  docs: Map<string, Set<string>>;
  /** LIMIT_* constant → the documents under the prime that cite it. */
  constantDocs: Map<string, string[]>;
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const VALUE_PARAM_RE = /^(.*?)\s*Rate\s*Limits?\s*\/\s*(?:maxAmount|slope)\b/i;
const CONSTANT_RE = /`(LIMIT_[A-Z0-9_]+)`/g;
const SIDE: Record<string, string> = { inflow: "in", deposit: "in", supply: "in", outflow: "out", withdraw: "out", withdrawal: "out", redeem: "out" };

/** The operation a param name is about ("Aggregate Deposit RateLimitID" and "Inflow Rate Limits" both "in"), or "" for none. */
export function paramSide(name: string): string {
  const words = name.replace(RATE_LIMIT_ID_RE, " ").replace(/Rate\s*Limits?\b|\(.*?\)|\//gi, " ").trim().split(/\s+/);
  const last = (words.at(-1) ?? "").toLowerCase();
  return SIDE[last] ?? last;
}

function paramsOf(e: Entity): Params {
  try {
    return (JSON.parse(e.meta ?? "{}") as { params?: Params }).params ?? {};
  } catch {
    return {};
  }
}

/** Each key in one param set with its own doc, the container's doc, and the value docs on its side (all of them when it names no side). */
function addParamSet(out: Map<string, Set<string>>, params: Params, container: string | null) {
  const values = Object.entries(params).flatMap(([n, [, src]]) => {
    const m = VALUE_PARAM_RE.exec(n);
    return m && src ? [{ side: paramSide(m[1]), src }] : [];
  });
  for (const [name, [value, src]] of Object.entries(params)) {
    const key = value.trim().toLowerCase();
    if (!RATE_LIMIT_ID_RE.test(name) || !HASH_RE.test(key)) continue;
    const side = paramSide(name);
    const docs = out.get(key) ?? new Set<string>();
    for (const d of [src, container, ...values.filter((v) => !side || v.side === side).map((v) => v.src)]) if (d) docs.add(d);
    out.set(key, docs);
  }
}

const keyedInstance = (e: Entity): KeyedInstance => ({
  displayName: e.name,
  signalParams: Object.entries(paramsOf(e)).map(([key, [value, src]]) => ({ key, value, srcDocId: src || null })),
});

// The prime's subtree by its current doc_no, read from its UUID on every build,
// so a renumbering moves the prefix with it.
function constantDocs(ix: Indexes, primeDocNo: string | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!primeDocNo) return out;
  for (const d of ix.docMap.values()) {
    if (!d.doc_no.startsWith(`${primeDocNo}.`)) continue;
    for (const m of (d.content ?? "").matchAll(CONSTANT_RE)) out.set(m[1], [...new Set([...(out.get(m[1]) ?? []), d.id])]);
  }
  return out;
}

/** The atlas side of every key one prime states, from its own params and its instances'. */
export function primeAtlasRefs(ix: Indexes, primeId: string): PrimeAtlasRefs {
  const prime = ix.entityById.get(primeId);
  const instances = ix.entities.filter((e) => (e.entity_type === "instance" || e.entity_type === "invocation") && e.meta?.includes(primeId) && JSON.parse(e.meta).agent_doc_id === primeId);
  const docs = new Map<string, Set<string>>();
  if (prime) addParamSet(docs, paramsOf(prime), null);
  for (const e of instances) addParamSet(docs, paramsOf(e), e.defining_doc_id);
  const labels = instanceKeyIndex([primeKeyedInstance(prime?.meta), ...instances.map(keyedInstance)]);
  return { labels, docs, constantDocs: constantDocs(ix, prime?.defining_doc_id ? ix.docMap.get(prime.defining_doc_id)?.doc_no : undefined) };
}
