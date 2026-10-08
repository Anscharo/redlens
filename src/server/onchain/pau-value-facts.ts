// The atlas against the contract as facts (src/lib/pauAtlasValues.ts): one per
// rate-limit value a prime's instances state and the chain holds, saying
// whether the two agree. Found by the documents stating the value and the
// instance, so a tool result that returns either carries the comparison.
// A value whose key the fully read contract does not hold is a disagreement
// too. Values that cannot be compared (chain not read, no key found) are left
// out; the coverage list says which deployments are read.
import { checkAtlasValues, type ValueCheck } from "../../lib/pauAtlasValues.ts";
import type { ValueSource } from "../../lib/pauInstanceKeys.ts";
import type { StoredPauSnapshot } from "../../lib/pau.ts";
import { exactAmount, limitDecimals, wholeAmount } from "../../lib/pauView.ts";
import type { Entity, Indexes } from "../retrieval/indexes.ts";
import type { OnchainFact } from "./facts.ts";
import { setAt } from "./pau-fact-parts.ts";

/** An entity's meta; an unreadable one reads as empty, so one bad row cannot fail the source. */
const metaOf = (e: Entity | undefined): { agent_doc_id?: string; params?: ValueSource["params"] } => {
  try {
    return JSON.parse(e?.meta ?? "{}");
  } catch {
    return {};
  }
};

/** The prime's own params and every instance's, as the check reads them. */
export function primeValueSources(ix: Indexes, prime: string): ValueSource[] {
  const own = ix.entities.filter((e) => (e.entity_type === "instance" || e.entity_type === "invocation") && e.meta?.includes(prime) && metaOf(e).agent_doc_id === prime);
  const prim = ix.entityById.get(prime);
  return [{ name: prim?.name ?? "", docId: null, params: metaOf(prim).params ?? {} }, ...own.map((e) => ({ name: e.name, docId: e.defining_doc_id, params: metaOf(e).params ?? {} }))];
}

/** What the contract holds for the checked value, exact, in its token's units. */
function contractValue(c: ValueCheck): string {
  if (!c.limit?.data) return "not set";
  const r = c.limit;
  const max = c.limit.data.maxAmount;
  const dec = limitDecimals(r.unit, max);
  const symbol = r.unit?.symbol ? ` ${r.unit.symbol}` : "";
  if (exactAmount(max, dec) === "unlimited") return "unlimited";
  return c.field === "maxAmount" ? `${exactAmount(max, dec)}${symbol}` : `${wholeAmount((BigInt(c.limit.data.slope) * 86_400n).toString(), dec)}${symbol} per day`;
}

function valueFact(c: ValueCheck, primeName: string, prime: string, snap: StoredPauSnapshot): OnchainFact {
  const contract = c.contract ?? snap.contracts.find((x) => x.role === "rateLimits")?.address ?? "";
  const values = {
    instance: c.instance, value: c.label, atlas: c.stated, contract: contractValue(c), agrees: c.status === "match", key: c.key, deployment: snap.kind,
    ...(c.limit ? { decimals_source: c.limit.unit?.source ?? ("inferred" as const) } : {}),
  };
  return {
    source: "pau", kind: "atlas-vs-contract", chain: snap.chain, entity: primeName, entity_id: prime, contract,
    name: `${c.instance} · ${c.label}`, name_source: "atlas", atlas_doc_id: c.docId,
    values, summary: { value: c.label, atlas: c.stated, contract: values.contract, agrees: values.agrees },
    set_at: c.limit ? setAt(snap.chain, c.limit.setAt) : null, read_at: snap.fetchedAt,
    history_complete: snap.contracts.every((x) => x.historyComplete),
    match: { hashes: c.key ? [c.key] : [], addresses: [contract], docs: [c.docId, ...(c.instanceDocId ? [c.instanceDocId] : [])] },
  };
}

/** The deployment a check is about: the one holding the key, else the read one on the instance's chain. */
/** The deployments a check is about: the one holding the key, else, for "not set", every one on the instance's chain (each read and found without it). */
const deploymentsOf = (c: ValueCheck, snaps: StoredPauSnapshot[]): StoredPauSnapshot[] => {
  if (c.status === "match" || c.status === "mismatch") return snaps.filter((s) => s.chain === c.chain && s.kind === c.kind);
  return c.status === "not-set" ? snaps.filter((s) => s.chain === c.chain) : [];
};

/** One fact per value the chain can be compared on, or lacks on a read chain, for one prime. */
export function valueFacts(ix: Indexes, prime: string, snaps: StoredPauSnapshot[]): OnchainFact[] {
  const name = snaps[0]?.primeName ?? ix.entityById.get(prime)?.name ?? "";
  return checkAtlasValues(primeValueSources(ix, prime), snaps).flatMap((c) => deploymentsOf(c, snaps).map((s) => valueFact(c, name, prime, s)));
}
