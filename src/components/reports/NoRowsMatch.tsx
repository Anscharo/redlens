// Shared empty state for the report-scoped header search: shown when the
// text filter (possibly combined with pill filters) leaves zero rows.
export function NoRowsMatch({ query }: { query: string }) {
  return (
    <p className="mono text-xs mb-6" style={{ color: "var(--tan-3)" }}>
      No rows match{query.trim() ? ` "${query.trim()}"` : " the current filters"}.
    </p>
  );
}
