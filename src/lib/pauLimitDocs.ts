// Rate-limit values the atlas states in plain documents instead of in an
// instance's params: a leaf under "<name> Rate Limits" > "<Chain>" whose text
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

/** The leaf as a value source, or null when it does not follow the "<…> Rate Limits" > chain > leaf shape with value bullets. */
function leafSource(leaf: AtlasNode, d: LimitDocs, keys: ReturnType<typeof statedKeys>): ValueSource | null {
  const bullets = [...leaf.content.matchAll(BULLET_RE)];
  const parents = parentsOf(d);
  const chainHeading = parents.get(leaf.id);
  const limitsHeading = chainHeading && parents.get(chainHeading.id);
  if (bullets.length === 0 || !chainHeading || !limitsHeading || !chainOfLabel(chainHeading.title) || !RATE_LIMITS_TITLE_RE.test(limitsHeading.title.trim())) return null;
  const label = leaf.title.replace(LIMIT_WORD_RE, "").trim();
  const params: ValueSource["params"] = Object.fromEntries(bullets.map((b) => [`${label} Rate Limits / ${b[1]}`, [b[2], leaf.id]]));
  const stated = keys.get(norm(leaf.title));
  if (stated) params[`${label} Rate Limit ID`] = stated[1];
  const constants = [...new Set([...leaf.content.matchAll(CONSTANT_RE)].map((m) => m[1]))];
  const titles = `${limitsHeading.title} ${parents.get(limitsHeading.id)?.title ?? ""}`;
  const kind = /diamond/i.test(titles) ? "diamond" : /monolith/i.test(titles) ? "monolithic" : undefined;
  return { name: `${chainHeading.title} - ${leaf.title}`, docId: leaf.id, params, ...(constants.length === 1 && !stated ? { constant: constants[0] } : {}), ...(kind ? { kind } : {}) } satisfies ValueSource;
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
