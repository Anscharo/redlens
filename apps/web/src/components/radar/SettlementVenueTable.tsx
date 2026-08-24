import { formatUsd } from "../../lib/settlements";
import type { SankeyVenue } from "../../lib/settlementSankey";

export function SettlementVenueTable({
  rows,
  primeLabel,
}: {
  rows: SankeyVenue[];
  primeLabel: string;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full text-sm border-collapse mt-4">
      <thead>
        <tr className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
          <th className="text-left font-normal pb-1">Venue</th>
          <th className="text-right font-normal pb-1">To Sky</th>
          <th className="text-right font-normal pb-1">To {primeLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => (
          <tr
            key={v.id}
            className="msc-venue-row border-t border-[var(--border)]"
            data-venue={v.id}
          >
            <td className="py-1 pr-3">
              <span style={{ color: "var(--tan-2)" }}>{v.label}</span>
              {v.synthetic && (
                <span className="mono text-[10px] ml-2" style={{ color: "var(--tan-3)" }}>
                  synthetic
                </span>
              )}
            </td>
            <td
              className="py-1 text-right mono text-[11px]"
              style={{ color: v.profitToSky < 0 ? "var(--accent)" : "var(--tan-2)" }}
            >
              {formatUsd(v.profitToSky)}
            </td>
            <td
              className="py-1 text-right mono text-[11px]"
              style={{ color: v.profitToGrove < 0 ? "var(--accent)" : "var(--tan-2)" }}
            >
              {formatUsd(v.profitToGrove)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
