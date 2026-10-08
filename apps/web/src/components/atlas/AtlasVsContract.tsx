// The right panel's "Atlas vs contract" table: each rate-limit value the open
// document states (or its instance states), beside what the PAU contract holds
// now (src/lib/pauAtlasValues.ts). A value the contract cannot be compared on
// says why instead of reading as a mismatch.
import { useMemo } from "react";
import { explorerTxUrl } from "@/lib/explorer";
import { checkAtlasValues, type ValueCheck, type ValueStatus } from "@/lib/pauAtlasValues";
import type { DocValueSources } from "@/lib/pauDocSources";
import { formatAmount, formatPerDay, limitDecimals, loadPau, unitNote } from "../../lib/pau";
import { useLoaded } from "../../hooks/useAtlasData";
import { SECTION_HEAD } from "./panelSections";

/** The document's atlas-vs-contract rows; empty until the PAU snapshots load, and when it states none. */
export function useAtlasVsContract(id: string, src: DocValueSources | null | undefined): ValueCheck[] {
  const res = useLoaded(loadPau, { soft: true });
  return useMemo(() => {
    if (!res || !src) return [];
    const snaps = res.deployments.filter((d) => d.prime === src.prime);
    return checkAtlasValues(src.sources, snaps).filter((c) => c.docId === id || c.instanceDocId === id);
  }, [res, src, id]);
}

const STATUS: Record<ValueStatus, { mark: string; text: string }> = {
  match: { mark: "✓", text: "matches the atlas" },
  mismatch: { mark: "✗", text: "differs from the atlas" },
  "units-unknown": { mark: "?", text: "token units not confirmed" },
  ambiguous: { mark: "?", text: "more than one key could be this one" },
  "not-set": { mark: "!", text: "not set on the contract" },
  unread: { mark: "…", text: "contract not read yet" },
  "no-deployment": { mark: "–", text: "no PAU indexed on this chain" },
  "unknown-chain": { mark: "–", text: "chain not recognised" },
  "no-key": { mark: "–", text: "no rate-limit key found" },
  "not-stated": { mark: "–", text: "the atlas sets no value yet" },
  unparsed: { mark: "?", text: "atlas value not read" },
};

/** What the contract holds for the value, in its token's units (only shown for a certain verdict, so `data` is read). */
function contractValue(c: ValueCheck): string {
  const r = c.limit!;
  const max = r.data!.maxAmount;
  const dec = limitDecimals(r.unit, max);
  const symbol = r.unit?.symbol ? ` ${r.unit.symbol}` : "";
  const amount = formatAmount(max, dec);
  if (amount === "unlimited") return amount;
  return c.field === "maxAmount" ? `${amount}${symbol}` : `${formatPerDay(r.data!.slope, dec)}${symbol} per day`;
}

const dim = { color: "var(--tan-3)" };

function Row({ c, label }: { c: ValueCheck; label: string }) {
  const s = STATUS[c.status];
  const compared = c.status === "match" || c.status === "mismatch";
  const max = c.limit?.data?.maxAmount ?? "0";
  return (
    <tr className="border-t border-[var(--border)] align-top" data-status={c.status}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 pr-2 mono">{c.stated}</td>
      <td className="py-1 pr-2 mono" title={compared ? unitNote(c.limit!.unit, max) : undefined} style={compared ? undefined : dim}>
        {compared ? contractValue(c) : s.text}
      </td>
      <td className="py-1 pr-2 text-center" title={s.text} style={{ color: c.status === "mismatch" || c.status === "not-set" ? "var(--accent)" : "var(--tan-3)" }}>
        <span aria-hidden="true">{s.mark}</span>
        <span className="sr-only">{s.text}</span>
      </td>
      <td className="py-1 mono text-right">
        {c.limit && c.chain && (
          <a href={explorerTxUrl(c.chain, c.limit.setAt.tx)} target="_blank" rel="noopener" className="hover:underline" style={dim}>
            {c.limit.setAt.time.slice(0, 10)}
          </a>
        )}
      </td>
    </tr>
  );
}

/** A key held on both of a prime's PAUs on one chain gets one row each, told apart by the PAU. */
const rowLabel = (c: ValueCheck, all: ValueCheck[]) =>
  all.filter((x) => x.label === c.label && x.instance === c.instance).length > 1 && c.kind ? `${c.label} (${c.kind})` : c.label;

/** The oldest contract read among the rows, as "YYYY-MM-DD HH:MM". */
const readAt = (rows: ValueCheck[]) =>
  rows.map((c) => c.readAt).filter((t): t is string => !!t).sort()[0]?.slice(0, 16).replace("T", " ") ?? null;

export function AtlasVsContract({ rows }: { rows: ValueCheck[] }) {
  const read = readAt(rows);
  return (
    <div>
      <p className={`${SECTION_HEAD} mb-2`}>Atlas vs contract · {rows.length}</p>
      <table className="w-full border-collapse text-xs" aria-label="Rate limits the atlas states, against the PAU contract">
        <thead>
          <tr className="mono text-[10px] uppercase tracking-wider text-left" style={dim}>
            <th className="font-normal pb-1">Value</th>
            <th className="font-normal pb-1">Atlas</th>
            <th className="font-normal pb-1">Contract</th>
            <th className="font-normal pb-1"><span className="sr-only">Status</span></th>
            <th className="font-normal pb-1 text-right">Set</th>
          </tr>
        </thead>
        <tbody>{rows.map((c, i) => <Row key={`${c.key ?? "none"}:${c.label}:${c.kind ?? ""}:${i}`} c={c} label={rowLabel(c, rows)} />)}</tbody>
      </table>
      {read && <p className="mono text-[10px] mt-1" style={dim}>contract read {read} UTC</p>}
    </div>
  );
}
