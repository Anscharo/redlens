// Rate-limit IDs a prime states outside any instance: the controller-wide keys
// (USDS mint and burn, the USDS/USDC swaps, CCTP) listed under its "… Rate Limit
// IDs" sections. They are read with the instance param walk and returned in the
// same `{ key: [value, srcUuid, srcDocNo] }` shape, so the prime entity's
// meta.params reads like an instance's and every param reader names them.
import { isICD } from "./graph-patterns.mjs";
import { extractParamsFromRoot } from "./graph-instances.mjs";

const SECTION_RE = /Rate ?Limit ?IDs?$/i;

interface Doc {
  id: string;
  doc_no: string;
  title: string;
  content?: string;
}
interface Entity {
  entity_type: string;
  subtype: string | null;
  defining_doc_id: string | null;
  meta: string | null;
}
type Params = Record<string, [string, string, string]>;

/**
 * Params from every topmost "… Rate Limit IDs" section under the prime's doc.
 * Instance subtrees are skipped: their keys are already their instance's params.
 */
export function primeRateLimitParams(primeDoc: Doc, childrenByDocNo: Map<string, Doc[]>): Params {
  const params: Params = {};
  const pending = [...(childrenByDocNo.get(primeDoc.doc_no) ?? [])];
  while (pending.length) {
    const doc = pending.shift()!;
    if (isICD(doc)) continue;
    if (SECTION_RE.test(doc.title)) Object.assign(params, extractParamsFromRoot(doc, childrenByDocNo) as Params);
    else pending.push(...(childrenByDocNo.get(doc.doc_no) ?? []));
  }
  return params;
}

/** Sets meta.params on each prime agent entity that states controller-wide keys. */
export function attachPrimeRateLimitParams(entityMap: Map<string, Entity>, docById: Map<string, Doc>, childrenByDocNo: Map<string, Doc[]>): void {
  for (const ent of entityMap.values()) {
    if (ent.entity_type !== "agent" || ent.subtype !== "prime") continue;
    const doc = ent.defining_doc_id ? docById.get(ent.defining_doc_id) : undefined;
    const params = doc ? primeRateLimitParams(doc, childrenByDocNo) : {};
    if (Object.keys(params).length === 0) continue;
    ent.meta = JSON.stringify({ ...JSON.parse(ent.meta ?? "{}"), params });
  }
}
