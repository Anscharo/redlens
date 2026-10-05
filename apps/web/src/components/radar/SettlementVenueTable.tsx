import { formatUsd } from "../../lib/settlements";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";

const COLS = ["revenue", "cof", "sde", "kept"] as const;

function Cell({ v }: { v: number }) {
  return (
    <td className="py-1 text-right mono text-[11px]" style={{ color: v < 0 ? "var(--msc-loss)" : "var(--tan-2)" }}>
      {Math.abs(v) < 1 ? "—" : formatUsd(v)}
    </td>
  );
}

/** The streams row by row: each venue's revenue and how it splits. The
 *  total row is the headline card's own figures — kept here is
 *  primeAgentRevenue − cof, which the prime-level row makes the rows reach. */
export function SettlementVenueTable({ model, primeLabel }: { model: StreamModel; primeLabel: string }) {
  if (model.venues.length === 0) return null;
  const total: Pick<VenueStream, (typeof COLS)[number]> = { revenue: model.revenue, cof: model.cof, sde: model.sde, kept: model.kept };
  return (
    <table className="w-full text-sm border-collapse mt-4">
      <thead>
        <tr className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          <th className="text-left font-normal pb-1">Venue</th>
          <th className="text-right font-normal pb-1">Revenue</th>
          <th className="text-right font-normal pb-1">CoF to Sky</th>
          <th className="text-right font-normal pb-1">SDE to Sky</th>
          <th className="text-right font-normal pb-1">Kept by {primeLabel}</th>
        </tr>
      </thead>
      <tbody>
        {model.venues.map((v) => (
          <tr key={v.id} className="msc-venue-row border-t border-[var(--border)]" data-venue={v.id}>
            <td className="py-1 pr-3">
              <span style={{ color: "var(--tan-2)" }}>{v.label}</span>
              {v.synthetic && (
                <span className="mono text-[10px] ml-2" style={{ color: "var(--tan-3)" }}>
                  synthetic
                </span>
              )}
            </td>
            {COLS.map((c) => <Cell key={c} v={v[c]} />)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-[var(--border)]" style={{ color: "var(--tan)" }}>
          <td className="py-1 pr-3 mono text-[10px] uppercase tracking-wider">Total</td>
          {COLS.map((c) => <Cell key={c} v={total[c]} />)}
        </tr>
      </tfoot>
    </table>
  );
}
