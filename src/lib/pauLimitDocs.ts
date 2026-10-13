// Rate-limit values the atlas states in plain documents instead of in an
// instance's params: a leaf under "<name> Rate Limits" > "<Chain>" (with at most
// one group heading between, "Ethereum Mainnet sUSDS") whose text
// lists `maxAmount` / `slope` bullets ("CCTP To Ethereum Limit" under Spark's
// "Diamond PAU Rate Limits" > "Arbitrum"). Each such leaf becomes a value
// source the atlas-vs-chain check reads like an instance:
//  - its chain is the chain heading's, its deployment kind the heading's
//    ("Diamond PAU", "Monolithic"), when one is named;
//  - its key is a hash the prime states under the same name ("CCTP To Ethereum
//    Rate Limit ID"), else the one on-chain key a controller constant the text
//    names (`LIMIT_USDS_MINT`) derives to, else none ("no rate-limit key").
// The tree is walked by parent edges, never by doc_no. Pure.
import type { AtlasNode } from "../types.ts";
import type { AtlasBundle } from "./docsTypes.ts";
import { chainOfLabel } from "./pauInstanceChain.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { RATE_LIMITS_TITLE_RE } from "./pauParams.ts";
import { RATE_LIMIT_ID_RE } from "./atlasHashes.ts";

export type LimitDocs = Pick<AtlasBundle, "docs" | "byParent">;

const BULLET_RE = /^- `(maxAmount|slope)`:\s*(.+?)\s*$/gm;
const CONSTANT_RE = /`(LIMIT_[A-Z0-9_]+)`/g;
/** A constant "hashed with" a domain, token or pool names one of several keys; the text alone cannot say which. */
const HASHED_RE = /hashed with/i;
const LIMIT_WORD_RE = /\s+(?:rate\s*)?(?:limit|maximum)s?$/i;
const ID_SUFFIX_RE = /\s+Rate\s*Limit\s*IDs?$/i;

const parentIndexes = new WeakMap<LimitDocs["byParent"], Map<string, AtlasNode>>();

/** Each node's parent in the reader's tree. */
function parentsOf(d: LimitDocs): Map<string, AtlasNode> {
  const known = parentIndexes.get(d.byParent);
  if (known) return known;
  const parents = new Map<string, AtlasNode>();
  for (const [parentId, kids] of d.byParent) {
    const parent = parentId ? d.docs[parentId] : undefined;
    if (parent) for (const kid of kids) parents.set(kid.id, parent);
  }
  parentIndexes.set(d.byParent, parents);
  return parents;
}

const norm = (s: string) => s.replace(ID_SUFFIX_RE, "").replace(LIMIT_WORD_RE, "").trim().toLowerCase();

/** The prime's stated key hashes by name: "CCTP To Ethereum Rate Limit ID" → "cctp to ethereum". */
function statedKeys(prime: ValueSource): Map<string, [name: string, value: [string, string | null, string?]]> {
  const out = new Map<string, [string, [string, string | null, string?]]>();
  for (const [name, value] of Object.entries(prime.params)) if (RATE_LIMIT_ID_RE.test(name) && /^0x[0-9a-fA-F]{64}$/.test(value[0].trim())) out.set(norm(name), [name, value]);
  return out;
}

/** The chain heading and the "<…> Rate Limits" heading above a leaf: the chain directly above it, or one group heading ("Ethereum Mainnet sUSDS") higher. */
function headingsOf(leaf: AtlasNode, d: LimitDocs): { chain: AtlasNode; limits: AtlasNode } | null {
  const parents = parentsOf(d);
  const isLimits = (n?: AtlasNode) => !!n && RATE_LIMITS_TITLE_RE.test(n.title.trim());
  const p1 = parents.get(leaf.id);
  const p2 = p1 && parents.get(p1.id);
  const p3 = p2 && parents.get(p2.id);
  if (p1 && chainOfLabel(p1.title) && isLimits(p2)) return { chain: p1, limits: p2! };
  if (p2 && chainOfLabel(p2.title) && isLimits(p3)) return { chain: p2, limits: p3! };
  return null;
}

/** The leaf as a value source, or null when it does not follow the "<…> Rate Limits" > chain > leaf shape (one group heading allowed between) with value bullets. */
function leafSource(leaf: AtlasNode, d: LimitDocs, keys: ReturnType<typeof statedKeys>): ValueSource | null {
  const bullets = [...leaf.content.matchAll(BULLET_RE)];
  const heads = bullets.length > 0 ? headingsOf(leaf, d) : null;
  if (!heads) return null;
  const { chain: chainHeading, limits: limitsHeading } = heads;
  const label = leaf.title.replace(LIMIT_WORD_RE, "").trim();
  const params: ValueSource["params"] = Object.fromEntries(bullets.map((b) => [`${label} Rate Limits / ${b[1]}`, [b[2], leaf.id]]));
  const stated = keys.get(norm(leaf.title));
  if (stated) params[`${label} Rate Limit ID`] = stated[1];
  const constants = [...new Set([...leaf.content.matchAll(CONSTANT_RE)].map((m) => m[1]))];
  const titles = `${limitsHeading.title} ${parentsOf(d).get(limitsHeading.id)?.title ?? ""}`;
  const kind = /diamond/i.test(titles) ? "diamond" : /monolith/i.test(titles) ? "monolithic" : undefined;
  const constant = constants.length === 1 && !stated && !HASHED_RE.test(leaf.content) ? constants[0] : undefined;
  return { name: `${chainHeading.title} - ${leaf.title}`, docId: leaf.id, params, ...(constant ? { constant } : {}), ...(kind ? { kind } : {}) } satisfies ValueSource;
}

const sourcesCache = new WeakMap<LimitDocs["byParent"], Map<string, ValueSource[]>>();

/** Every document below the prime's own that states limit values in the shape above, as value sources; empty for a prime with none. */
export function limitDocSources(prime: ValueSource, primeDocId: string | null, d: LimitDocs): ValueSource[] {
  if (!primeDocId || !d.docs[primeDocId]) return [];
  const byPrime = sourcesCache.get(d.byParent) ?? sourcesCache.set(d.byParent, new Map()).get(d.byParent)!;
  const known = byPrime.get(primeDocId);
  if (known) return known;
  const keys = statedKeys(prime);
  const out: ValueSource[] = [];
  const walk = (id: string) => {
    for (const kid of d.byParent.get(id) ?? []) {
      const s = leafSource(kid, d, keys);
      if (s) out.push(s);
      walk(kid.id);
    }
  };
  walk(primeDocId);
  byPrime.set(primeDocId, out);
  return out;
}

/** The ids of every document below `id`, `id` itself included: the documents whose values a heading shows. */
export function subtreeIds(id: string, d: Pick<LimitDocs, "byParent">): string[] {
  return [id, ...(d.byParent.get(id) ?? []).flatMap((kid) => subtreeIds(kid.id, d))];
}

/** The documents above `id`, nearest first. */
export function ancestorsOf(id: string, d: LimitDocs): AtlasNode[] {
  const parents = parentsOf(d);
  const out: AtlasNode[] = [];
  for (let n = parents.get(id); n && out.length < 64; n = parents.get(n.id)) out.push(n);
  return out;
}

/**
 * The documents whose values `id` shows beside its own: everything below a
 * "<…> Rate Limits" heading, or below a chain heading under one. Empty for any
 * other document.
 */
export function limitHeadingScope(id: string, d: LimitDocs): string[] {
  const doc = d.docs[id];
  if (!doc) return [];
  const parent = parentsOf(d).get(id);
  const isLimits = RATE_LIMITS_TITLE_RE.test(doc.title.trim());
  const isChainUnder = !!parent && !!chainOfLabel(doc.title) && RATE_LIMITS_TITLE_RE.test(parent.title.trim());
  return isLimits || isChainUnder ? subtreeIds(id, d).slice(1) : [];
}

const INSTANCE_LIMITS_RE = /^(.+?)\s+Rate\s*Limits$/i;
const instanceParams = new WeakMap<LimitDocs["byParent"], Map<string, ValueSource["params"]>>();

/** The limit values the documents below an instance's own state, in leaves titled "<X> Rate Limits" ("Take Rate Limits" under its Risk Parameters), as "<X> Rate Limits / <field>" params. */
function instanceLimitParams(docId: string, d: LimitDocs): ValueSource["params"] {
  const cache = instanceParams.get(d.byParent) ?? instanceParams.set(d.byParent, new Map()).get(d.byParent)!;
  const known = cache.get(docId);
  if (known) return known;
  const out: ValueSource["params"] = {};
  const walk = (id: string) => {
    for (const kid of d.byParent.get(id) ?? []) {
      if (INSTANCE_LIMITS_RE.test(kid.title.trim())) for (const b of kid.content.matchAll(BULLET_RE)) out[`${kid.title.trim()} / ${b[1]}`] ??= [b[2], kid.id];
      walk(kid.id);
    }
  };
  walk(docId);
  cache.set(docId, out);
  return out;
}

/**
 * The instance's source with the limit values its own subtree states that its
 * params do not already carry. The instance's listed addresses then key them
 * the way they key its params' values.
 */
export function withInstanceLimitDocs(src: ValueSource, d: LimitDocs): ValueSource {
  if (!src.docId || !d.docs[src.docId]) return src;
  const own = new Set(Object.values(src.params).map((v) => v[1]));
  const extra = Object.fromEntries(Object.entries(instanceLimitParams(src.docId, d)).filter(([name, v]) => !(name in src.params) && !own.has(v[1])));
  return Object.keys(extra).length > 0 ? { ...src, params: { ...src.params, ...extra } } : src;
}
