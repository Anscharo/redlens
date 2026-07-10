// Plain-language readout of the active report filters, shown under the pill
// area: `showing all that contain "query" and match filters A + B`. Hidden
// when neither a text query nor a pill filter is active.
export function FilterSummary({
  query,
  filters = [],
  searches,
}: {
  query: string;
  filters?: (string | false | null | undefined)[];
  // Exactly what the text query is matched against — set on reports that
  // search more than the visible row text, so a match on a hidden field
  // (e.g. an agent attribution) isn't mysterious.
  searches?: string;
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
      {q && searches && (
        <span className="block mt-0.5 text-[10px] opacity-80">searches: {searches}</span>
      )}
    </p>
  );
}
