// The limit values an instance's own subtree states in leaves titled
// "<X> Rate Limits" ("Take Rate Limits" under its Risk Parameters), as value
// bullets the atlas-vs-chain check reads beside the instance's params. Pure.
import { BULLET_RE, type LimitDocs } from "./pauLimitDocs.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

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
