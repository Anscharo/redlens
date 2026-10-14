// How the atlas stands against each on-chain rate-limit key, for the Radar PAUs
// table's Atlas column: "match" when every value the atlas states for the key,
// on that RateLimits contract, is a certain match (pauAtlasValues.ts);
// "mismatch" when any is a certain difference; "unsure" when a document states
// a value for it but none differs for certain and not all certainly agree
// (an ambiguous key, unconfirmed units, an unread contract). Each verdict
// carries the document to read it in. A key no document states a value for has
// no verdict; one stated only for other deployments has an "elsewhere" entry
// (`elsewhereId`) naming them.
import type { ValueCheck } from "./pauAtlasValues.ts";

/** The `contract|key` id the verdicts use, both lowercased. */
export const matchId = (contract: string, key: string) => `${contract.toLowerCase()}|${key.toLowerCase()}`;

export interface AtlasVerdict {
  mark: "match" | "mismatch" | "unsure" | "elsewhere";
  /** The first document stating a value for the key, whose Onchain tab shows the comparison. */
  docId: string;
  /** For "elsewhere": the deployments the key's value is stated for, as "<chain> <kind>". */
  on?: string[];
}

/** The id of a key's "elsewhere" entry: the key, whichever contract holds it. */
export const elsewhereId = (key: string) => `|${key.toLowerCase()}`;

/** The verdict of every contract-held key some document states a value for. */
export function atlasVerdicts(checks: ValueCheck[]): Map<string, AtlasVerdict> {
  const byKey = new Map<string, ValueCheck[]>();
  for (const c of checks) {
    if (!c.contract || !c.key) continue;
    const id = matchId(c.contract, c.key);
    byKey.set(id, [...(byKey.get(id) ?? []), c]);
  }
  const out = new Map<string, AtlasVerdict>(
    [...byKey].map(([id, cs]) => {
      const mark = cs.some((c) => c.status === "mismatch") ? "mismatch" : cs.every((c) => c.status === "match") ? "match" : "unsure";
      return [id, { mark, docId: cs[0].docId }] as const;
    }),
  );
  for (const c of checks) {
    if (!c.contract || !c.key || !c.chain || !c.kind) continue;
    const id = elsewhereId(c.key);
    const held = out.get(id);
    const where = `${c.chain} ${c.kind}`;
    if (!held) out.set(id, { mark: "elsewhere", docId: c.docId, on: [where] });
    else if (!held.on!.includes(where)) held.on!.push(where);
  }
  return out;
}
