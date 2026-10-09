// The PAU census: every rate-limit value the atlas states for a prime, checked
// against the chain (pauAtlasValues.ts), as the record `pnpm census:pau`
// compares week to week. A value is keyed by the UUID of the document stating
// it and its field, so a renumbering changes nothing compared; doc_no, instance
// and label ride along for people only. Each value holds one slot per
// deployment and key (`chain/kind/key`). A disagreeing slot keeps the raw
// on-chain integer, which is what is compared, and a formatted copy to read.
import type { StoredPauSnapshot } from "./pau.ts";
import { checkAtlasValues, type ValueCheck, type ValueStatus } from "./pauAtlasValues.ts";
import { primesStatingValues, primeValueSources, type SourceEntity } from "./pauPrimeSources.ts";
import { exactAmount, limitDecimals, wholeAmount } from "./pauView.ts";

/** A slot: its status, or for a disagreement the status, the raw chain value and how it reads. */
export type CensusSlot = ValueStatus | [ValueStatus, string | null, string];

export interface CensusValue {
  prime: string;
  doc_no: string | null;
  instance: string;
  label: string;
  stated: string;
  at: Record<string, CensusSlot>;
}

export interface PauCensus {
  /** Every deployment served, as `primeUuid/chain/kind`. */
  deployments: string[];
  counts: Record<string, number>;
  values: Record<string, CensusValue>;
}

export const DISAGREE = new Set<ValueStatus>(["mismatch", "not-set"]);

/** The raw on-chain value a check reads, and how it reads in its token's units. */
function chainValue(c: ValueCheck): [string | null, string] {
  const data = c.limit?.data;
  if (!c.limit || !data) return [null, "not set"];
  const dec = limitDecimals(c.limit.unit, data.maxAmount);
  const symbol = c.limit.unit?.symbol ? ` ${c.limit.unit.symbol}` : "";
  if (c.field === "maxAmount") return [data.maxAmount, `${exactAmount(data.maxAmount, dec)}${symbol}`];
  return [data.slope, `${wholeAmount((BigInt(data.slope) * 86_400n).toString(), dec)}${symbol} per day`];
}

const sortedRecord = <T>(r: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function addCheck(values: Record<string, CensusValue>, c: ValueCheck, prime: string, docNoOf: (id: string) => string | null): void {
  const v = (values[`${c.docId}:${c.field}`] ??= { prime, doc_no: docNoOf(c.docId), instance: c.instance, label: c.label, stated: c.stated, at: {} });
  v.at[`${c.chain ?? "-"}/${c.kind ?? "-"}/${c.key ?? "-"}`] = DISAGREE.has(c.status) ? [c.status, ...chainValue(c)] : c.status;
}

/** The census of every prime that states values or has a deployment. */
export function pauCensus(entities: SourceEntity[], docNoOf: (id: string) => string | null, snaps: StoredPauSnapshot[]): PauCensus {
  const values: Record<string, CensusValue> = {};
  const counts: Record<string, number> = {};
  const primes = new Set([...snaps.map((s) => s.prime), ...primesStatingValues(entities)]);
  for (const prime of [...primes].sort()) {
    for (const c of checkAtlasValues(primeValueSources(entities, prime), snaps.filter((s) => s.prime === prime))) {
      addCheck(values, c, prime, docNoOf);
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
  }
  const deployments = [...new Set(snaps.map((s) => `${s.prime}/${s.chain}/${s.kind}`))].sort();
  return { deployments, counts: sortedRecord(counts), values: sortedRecord(values) };
}

/** The baseline file: one line per value, so a change diffs as the lines it touches. */
export function formatCensus(c: PauCensus, source: string): string {
  const values = Object.entries(c.values).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`);
  const head = [`  "source": ${JSON.stringify(source)}`, `  "deployments": ${JSON.stringify(c.deployments)}`, `  "counts": ${JSON.stringify(c.counts)}`];
  return `{\n${head.join(",\n")},\n  "values": {\n${values.join(",\n")}\n  }\n}\n`;
}
