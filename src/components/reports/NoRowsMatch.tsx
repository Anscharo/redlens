// Shared empty state for the report-scoped header search: shown when the
// text filter (possibly combined with pill filters) leaves zero rows.
import { displayQuery } from "@/lib/reportFilter";

export function NoRowsMatch({ query }: { query: string }) {
  const q = displayQuery(query);
  return (
    <p className="mono text-xs mb-6" style={{ color: "var(--tan-3)" }}>
      No rows match{q ? ` "${q}"` : " the current filters"}.
    </p>
  );
}
