// The right panel's "Atlas vs contract" table: each rate-limit value the open
// document states (or its instance states), beside what the PAU contract holds
// now (src/lib/pauAtlasValues.ts). A value the contract cannot be compared on
// says why instead of reading as a mismatch, and a mismatch whose spell is still
// coming (src/lib/pauPending.ts) shows a grey clock, not a ✗.
import { useMemo } from "react";
import { explorerTxUrl } from "@/lib/explorer";
import { checkAtlasValues, type ValueCheck } from "@/lib/pauAtlasValues";
import type { DocValueSources } from "@/lib/pauDocSources";
import { loadPau, unitNote } from "../../lib/pau";
import { pendingSummary, stepText } from "@/lib/pauStepText";
import { contractValue, isCompared, VALUE_STATUS as STATUS } from "../../lib/valueStatus";
import { useLoaded } from "../../hooks/useAtlasData";
import { useOnchainSteps } from "../../hooks/useOnchainSteps";
import { ClockGlyph } from "../ClockGlyph";
import { SECTION_HEAD } from "./panelSections";

/** The document's atlas-vs-contract rows: the values it, its instance or its direct children state; empty until the PAU snapshots load, and when there are none. */
export function useAtlasVsContract(id: string, src: DocValueSources | null | undefined): ValueCheck[] {
  const res = useLoaded(loadPau, { soft: true });
  const snaps = useMemo(() => (res && src ? res.deployments.filter((d) => d.prime === src.prime) : []), [res, src]);
  const rows = useMemo(() => {
    if (!res || !src) return [];
    return checkAtlasValues(src.sources, snaps).filter((c) => c.docId === id || c.instanceDocId === id || src.children.includes(c.docId));
  }, [res, src, snaps, id]);
  return useOnchainSteps(rows, snaps);
}

/** The status cell's mark, its words and its colour: a grey clock while the spell the atlas change names is still coming, amber for any other mismatch, with what governance did when it is known. */
function statusLook(c: ValueCheck): { mark: React.ReactNode; text: string; color: string } {
  if (c.onchain?.kind === "pending") return { mark: <ClockGlyph />, text: pendingSummary(c.onchain.pending), color: "var(--tan-3)" };
  const s = STATUS[c.status];
  const text = c.onchain ? `${s.text}: ${stepText(c.onchain)}` : s.text;
  return { mark: s.mark, text, color: c.status === "mismatch" ? "var(--warn)" : "var(--tan-3)" };
}

const dim = { color: "var(--tan-3)" };

function Row({ c, label }: { c: ValueCheck; label: string }) {
  const s = STATUS[c.status];
  const look = statusLook(c);
  const compared = isCompared(c);
  const max = c.limit?.data?.maxAmount ?? "0";
  return (
    <tr className="border-t border-[var(--border)] align-top" data-status={c.status}>
      <td className="py-1 pr-2">{label}</td>
      <td className="py-1 pr-2 mono">{c.stated}</td>
      <td className="py-1 pr-2 mono" title={compared ? unitNote(c.limit!.unit, max) : undefined} style={compared ? undefined : dim}>
        {compared ? contractValue(c) : s.text}
      </td>
      <td className="py-1 pr-2 text-center" title={look.text} style={{ color: look.color }} data-onchain={c.onchain?.kind}>
        <span aria-hidden="true">{look.mark}</span>
        <span className="sr-only">{look.text}</span>
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
            <th className="font-normal pb-1 text-right">Last updated</th>
          </tr>
        </thead>
        <tbody>{rows.map((c, i) => <Row key={`${c.key ?? "none"}:${c.label}:${c.kind ?? ""}:${i}`} c={c} label={rowLabel(c, rows)} />)}</tbody>
      </table>
      {read && <p className="mono text-[10px] mt-1" style={dim}>contract read {read} UTC</p>}
    </div>
  );
}
