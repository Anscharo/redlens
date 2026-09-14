import { useMemo } from "react";
import { formatUsd, collapseAum, type SettlementVenue } from "../../lib/settlements";
import { Tooltip } from "../Tooltip";

export function SettlementAum({ venues }: { venues: SettlementVenue[] }) {
  const rows = useMemo(() => collapseAum(venues), [venues]);
  if (rows.length === 0) return null;
  const peak = Math.max(1, ...rows.map((v) => Math.abs(v.valueEom)));
  return (
    <div>
      <p className="mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--tan-3)" }}>
        Venue AUM (end of month)
      </p>
      <ol className="msc-aum">
        {rows.map((v) => (
          <li key={v.id} className="msc-aum-row">
            {/* The full name on hover — the column fits most, not the longest. */}
            <Tooltip content={v.label}>
              <span className="truncate text-sm" style={{ color: "var(--tan-2)" }}>
                {v.label}
                {v.synthetic && (
                  <span className="mono text-[10px] ml-2" style={{ color: "var(--tan-3)" }}>synthetic</span>
                )}
              </span>
            </Tooltip>
            <span className="msc-aum-track" aria-hidden="true">
              <span className="msc-aum-fill" style={{ width: `${(Math.abs(v.valueEom) / peak) * 100}%` }} />
            </span>
            <span className="mono text-[11px] text-right" style={{ color: "var(--tan-2)" }}>
              {formatUsd(v.valueEom, true)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
