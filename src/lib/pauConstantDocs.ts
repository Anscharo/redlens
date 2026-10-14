// The Atlas document that names a controller constant, for a limit row the Atlas
// states no value for: a `LIMIT_*` constant in the text of a document inside the
// Prime's own artifact (a "Check RateLimits" step, say) is that limit's
// "named in" link on the Radar PAUs table. A constant counts only where one
// document names it on the row's chain, since several would leave the link
// arbitrary; a document under another chain's heading is not on this chain. The
// tree is walked by parent edges, never by doc_no. Pure.
import type { AtlasNode } from "../types.ts";
import { chainOfLabel } from "./pauInstanceChain.ts";
import { ancestorsOf, type LimitDocs } from "./pauLimitDocs.ts";

const CONSTANT_RE = /`(LIMIT_[A-Z0-9_]+)`/g;

interface Naming {
  doc: AtlasNode;
  /** The chain heading above the document, when it sits under one. */
  chain: string | null;
}

/** The document a row's constant is named in; null when none or several do. */
export type NamedIn = (constant: string, chain: string) => AtlasNode | null;

const cache = new WeakMap<LimitDocs["byParent"], Map<string, Map<string, Naming[]>>>();

function namings(primeDocId: string, d: LimitDocs): Map<string, Naming[]> {
  const out = new Map<string, Naming[]>();
  const walk = (id: string) => {
    for (const kid of d.byParent.get(id) ?? []) {
      const constants = new Set([...kid.content.matchAll(CONSTANT_RE)].map((m) => m[1]));
      if (constants.size > 0) {
        const chain = ancestorsOf(kid.id, d).map((a) => chainOfLabel(a.title)).find((c) => c !== null) ?? null;
        for (const c of constants) out.set(c, [...(out.get(c) ?? []), { doc: kid, chain }]);
      }
      walk(kid.id);
    }
  };
  walk(primeDocId);
  return out;
}

/** Where each constant is named inside the Prime's artifact; every lookup is null without the documents or the Prime's document. */
export function namedIn(primeDocId: string | null | undefined, d: LimitDocs | null): NamedIn {
  if (!primeDocId || !d || !d.docs[primeDocId]) return () => null;
  const byPrime = cache.get(d.byParent) ?? cache.set(d.byParent, new Map()).get(d.byParent)!;
  const index = byPrime.get(primeDocId) ?? byPrime.set(primeDocId, namings(primeDocId, d)).get(primeDocId)!;
  return (constant, chain) => {
    const here = (index.get(constant) ?? []).filter((n) => n.chain === null || n.chain === chain);
    return here.length === 1 ? here[0].doc : null;
  };
}
