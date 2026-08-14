import { Link } from "../Link";

// The shared row shape for every /history card: a name on the left, a leader
// line, and a right-aligned view count — the radar tables' "label … number"
// reading, minus their column grid (these cards carry one number, not four).

export function LeaderRow({
  children,
  count,
  indent = false,
}: {
  children: React.ReactNode;
  count: number;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-1 py-1 ${indent ? "pl-5" : ""}`}
      style={{ color: "var(--tan-2)" }}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span
        aria-hidden="true"
        className="flex-1 self-center border-b border-dotted min-w-[1rem]"
        style={{ borderColor: "var(--border)" }}
      />
      <span className="mono text-[11px] shrink-0 tabular-nums" style={{ color: "var(--tan-3)" }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}

/** A visited atlas document: its doc number (when the doc is still in this
 *  atlas build) then its title, linking into the reader. */
export function DocRow({
  path,
  docNo,
  label,
  count,
  indent,
}: {
  path: string;
  docNo: string | null;
  label: string;
  count: number;
  indent?: boolean;
}) {
  return (
    <LeaderRow count={count} indent={indent}>
      <Link to={path} className="text-sm hover:underline" style={{ color: "var(--tan-2)" }}>
        {docNo && (
          <span className="mono text-[11px] mr-2" style={{ color: "var(--tan-3)" }}>
            {docNo}
          </span>
        )}
        {label}
      </Link>
    </LeaderRow>
  );
}
