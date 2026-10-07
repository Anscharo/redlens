import { useMemo, useRef } from "react";
import { formatUsd, collapseAum, type SettlementVenue } from "../../lib/settlements";
import { Tooltip } from "../Tooltip";
import { useFlip } from "../../hooks/useFlip";

/** Venue AUM as bars, each in the venue's own colour — the same one the
 *  settlement circle gives it (see venueInks.ts). */
export function SettlementAum({ venues, inks }: { venues: SettlementVenue[]; inks: Map<string, string> }) {
  const rows = useMemo(() => collapseAum(venues), [venues]);
  // Largest first, so a month change (or the tween between two months)
  // can re-rank rows; when it does, they slide to their new places.
  const list = useRef<HTMLOListElement>(null);
  useFlip(list);
  if (rows.length === 0) return null;
  const peak = Math.max(1, ...rows.map((v) => Math.abs(v.valueEom)));
  return (
    <div>
      <p className="mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--tan-3)" }}>
        Venue AUM (end of month)
      </p>
      <ol className="msc-aum" ref={list}>
        {rows.map((v) => (
          <li key={v.id} className="msc-aum-row" data-flip-key={v.id}>
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
              <span className="msc-aum-fill" style={{ width: `${(Math.abs(v.valueEom) / peak) * 100}%`, background: inks.get(v.id) ?? "var(--gray)" }} />
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
