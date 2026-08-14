import { Link } from "../Link";
import { timeAgo } from "../../lib/timeAgo";

// The shared row shape for every /history card: a name on the left, a leader
// line, and a right-aligned view count — the radar tables' "label … number"
// reading, minus their column grid (these cards carry one number, not four).

export function LeaderRow({
  children,
  count,
  meta,
  indent = false,
}: {
  children: React.ReactNode;
  count: number;
  /** Small right-aligned note before the count (e.g. how long ago). Sits
   *  OUTSIDE the truncating name, so a long title can't clip it away. */
  meta?: React.ReactNode;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-1.5 py-1.5 ${indent ? "pl-5" : ""}`}
      style={{ color: "var(--tan-2)" }}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span
        aria-hidden="true"
        className="flex-1 self-center border-b border-dotted min-w-[1rem]"
        style={{ borderColor: "var(--border)" }}
      />
      {meta && (
        <span className="mono text-[11px] shrink-0 whitespace-nowrap" style={{ color: "var(--gray)" }}>
          {meta}
        </span>
      )}
      <span className="mono text-xs shrink-0 tabular-nums" style={{ color: "var(--tan-3)" }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}

/** A visited atlas document: its doc number (when the doc is still in this
 *  atlas build) then its title, linking into the reader. `at` adds when it was
 *  last opened, in words — the recent list's whole point is when. */
export function DocRow({
  path,
  docNo,
  label,
  count,
  at,
  indent,
}: {
  path: string;
  docNo: string | null;
  label: string;
  count: number;
  at?: number;
  indent?: boolean;
}) {
  return (
    <LeaderRow count={count} indent={indent} meta={at !== undefined ? timeAgo(at) : undefined}>
      <Link to={path} className="text-[15px] hover:underline" style={{ color: "var(--tan-2)" }}>
        {docNo && (
          <span className="mono text-xs mr-2" style={{ color: "var(--tan-3)" }}>
            {docNo}
          </span>
        )}
        {label}
      </Link>
    </LeaderRow>
  );
}
