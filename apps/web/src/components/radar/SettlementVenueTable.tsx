import type { ReactNode } from "react";
import { formatUsd } from "../../lib/settlements";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";
import { citationFor } from "@/lib/settlementCitations";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";

/** Each venue's revenue, the cost of funds it sends Sky (the Atlas charges
 *  it per venue, as Instance Expense, A.2.4.1.2.2.1.1.2.2.1.1), its SDE, and
 *  what the Prime keeps of it. Kept is Soter's revenue − cost of funds, which
 *  can go below zero; the Atlas's Instance Profit cannot, so kept stays
 *  muted and uncited. */
const COLS = ["revenue", "cof", "sde", "kept"] as const;
const UNCITED = "A workbook figure: the Atlas defines no term for it";

function Cell({ v, muted }: { v: number; muted: boolean }) {
  return (
    <td className="py-1 text-right mono text-[11px]" style={{ color: v < 0 ? "var(--msc-loss)" : muted ? "var(--tan-3)" : "var(--tan-2)" }}>
      {Math.abs(v) < 1 ? "—" : formatUsd(v)}
    </td>
  );
}

/** A column header: linked to the Atlas document that defines its figure,
 *  or muted with a tooltip when the Atlas defines none. */
function Head({ col, children }: { col: (typeof COLS)[number]; children: ReactNode }) {
  const c = citationFor(col);
  return (
    <th className="text-right font-normal pb-1" title={c ? c.term : UNCITED}>
      {c ? <AtlasLink to={atlasHref(c.uuid)} className="msc-ring-caption-link">{children}</AtlasLink> : children}
    </th>
  );
}

/** The outer lane row by row. The total row is the headline card's own
 *  figures — kept is primeAgentRevenue − cof, which the prime-level row
 *  makes the rows reach. */
export function SettlementVenueTable({ model, primeLabel }: { model: StreamModel; primeLabel: string }) {
  const rows = model.venues;
  if (rows.length === 0) return null;
  const total: Pick<VenueStream, (typeof COLS)[number]> = { revenue: model.revenue, cof: model.cof, sde: model.sde, kept: model.kept };
  return (
    <table className="w-full text-sm border-collapse mt-4">
      <thead>
        <tr className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          <th className="text-left font-normal pb-1">Venue</th>
          <Head col="revenue">Revenue to {primeLabel}</Head>
          <Head col="cof">CoF to Sky</Head>
          <Head col="sde">SDE to Sky</Head>
          <Head col="kept">Kept by {primeLabel}</Head>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => (
          <tr key={v.id} className="msc-venue-row border-t border-[var(--border)]" data-venue={v.id}>
            <td className="py-1 pr-3">
              <span style={{ color: "var(--tan-2)" }}>{v.label}</span>
              {v.synthetic && (
                <span className="mono text-[10px] ml-2" style={{ color: "var(--tan-3)" }}>
                  synthetic
                </span>
              )}
            </td>
            {COLS.map((c) => <Cell key={c} v={v[c]} muted={!citationFor(c)} />)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-[var(--border)]" style={{ color: "var(--tan)" }}>
          <td className="py-1 pr-3 mono text-[10px] uppercase tracking-wider">Total</td>
          {COLS.map((c) => <Cell key={c} v={total[c]} muted={!citationFor(c)} />)}
        </tr>
      </tfoot>
    </table>
  );
}
