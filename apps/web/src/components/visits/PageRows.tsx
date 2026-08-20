import { Link } from "../Link";
import type { PageVisit } from "../../lib/visitsIndex";
import { LeaderRow } from "./VisitRow";

// A visited report / radar page. The link restores the filters that were set on
// the most recent visit, and those filters are spelled out beneath the name so
// the row says which slice of the report you were looking at.
export function PageRows({ pages }: { pages: PageVisit[] }) {
  return (
    <>
      {pages.map((p) => (
        <div key={p.path}>
          <LeaderRow count={p.count}>
            <Link to={p.href} className="text-[15px] hover:underline" style={{ color: "var(--tan-2)" }}>
              {p.label}
            </Link>
          </LeaderRow>
          {p.filters.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-1.5">
              {p.filters.map(([k, v]) => (
                <span
                  key={k}
                  className="mono text-[11px] px-1.5 py-0.5 rounded border"
                  style={{ borderColor: "var(--border)", color: "var(--tan-3)" }}
                >
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
