import { useMemo } from "react";
import { formatUsd, collapseAum, type SettlementVenue } from "../../lib/settlements";
import { Tooltip } from "../Tooltip";

/** Each venue's bar is a fixed colour of its own, hashed from its id, so a
 *  bar keeps its colour as it moves up or down the largest-first list from
 *  month to month. Drawn from the MSC series and Prime tokens (all audited
 *  against the card); the Other fold is grey. */
const VENUE_TOKENS = [
  "--msc-sky", "--msc-kept", "--msc-demand", "--msc-sde", "--msc-dr", "--msc-gar", "--msc-cp",
  "--msc-prime-1", "--msc-prime-2", "--msc-prime-3", "--msc-prime-4", "--msc-prime-5", "--msc-prime-6",
] as const;
export function venueFill(id: string): string {
  if (id === "_other") return "var(--gray)";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `var(${VENUE_TOKENS[h % VENUE_TOKENS.length]})`;
}

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
              <span className="msc-aum-fill" style={{ width: `${(Math.abs(v.valueEom) / peak) * 100}%`, background: venueFill(v.id) }} />
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
