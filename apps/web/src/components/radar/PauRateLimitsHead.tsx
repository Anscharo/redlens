import type { LimitColumn, LimitSort } from "@/lib/pauLimitSort";

/** Column rule, fainter than the row rule so rows stay the primary rhythm. */
export const colRule = { borderLeft: "1px solid color-mix(in srgb, var(--border) 45%, transparent)" };
const head = "px-3 pb-1 align-bottom font-normal leading-tight";

const COLUMNS: { by: LimitColumn; label: string; className: string; title?: string }[] = [
  { by: "name", label: "Name", className: "pl-0 pr-3 text-left max-w-[40rem]" },
  { by: "maxAmount", label: "maxAmount", className: "text-right normal-case", title: "the most the limit can hold" },
  { by: "slope", label: "Slope", className: "text-right", title: "how much the limit refills per day" },
  {
    by: "atlas",
    label: "Matches Atlas",
    className: "text-center max-w-[5rem]",
    title: "✓ matches, ✗ differs, ? cannot be told, or the Atlas states the value only for another deployment; each links to the Atlas document stating the value. Blank when no document states one.",
  },
  { by: "updated", label: "Last updated", className: "text-right" },
];

const ariaSort = (sort: LimitSort | null, by: LimitColumn) => (sort?.by !== by ? "none" : sort.desc ? "descending" : "ascending");

/** The rate-limit table's header row: each column's label is a button that sorts the table by it, and again the other way. */
export function PauRateLimitsHead({ sort, onSort }: { sort: LimitSort | null; onSort: (by: LimitColumn) => void }) {
  return (
    <thead>
      <tr className="mono text-[11px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
        {COLUMNS.map((c, i) => (
          <th key={c.by} className={`${head} ${c.className}`} style={i ? colRule : undefined} title={c.title} aria-sort={ariaSort(sort, c.by)}>
            <button type="button" onClick={() => onSort(c.by)} className="cursor-pointer [text-transform:inherit] [letter-spacing:inherit] hover:underline">
              {c.label}
              <span aria-hidden="true">{sort?.by === c.by ? (sort.desc ? " ▼" : " ▲") : ""}</span>
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );
}
