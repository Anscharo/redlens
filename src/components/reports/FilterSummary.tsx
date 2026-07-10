// Plain-language readout of the active report filters, shown under the pill
// area: `showing all that contain "query" and match filters A + B`. Hidden
// when neither a text query nor a pill filter is active.
export function FilterSummary({
  query,
  filters = [],
}: {
  query: string;
  filters?: (string | false | null | undefined)[];
}) {
  const q = query.trim();
  const active = filters.filter((f): f is string => !!f);
  if (!q && active.length === 0) return null;
  return (
    <p className="mono text-xs mb-4" style={{ color: "var(--tan-3)" }}>
      showing all that
      {q && (
        <>
          {" "}contain <span className="text-tan">"{q}"</span>
        </>
      )}
      {q && active.length > 0 && " and"}
      {active.length > 0 && (
        <>
          {" "}match filters <span className="text-tan">{active.join(" + ")}</span>
        </>
      )}
    </p>
  );
}
