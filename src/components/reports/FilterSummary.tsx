// Plain-language readout of the active report filters, shown under the pill
// area: `showing all that contain "query" and match filters A + B`. Hidden
// when neither a text query nor a pill filter is active. Styled as a light
// callout (.filter-summary in index.css) so the explanation of what's being
// searched stands out against the dark page.
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
    <p className="filter-summary mono text-xs mb-4">
      showing all that
      {q && (
        <>
          {" "}contain <span className="filter-summary-em">"{q}"</span>
        </>
      )}
      {q && active.length > 0 && " and"}
      {active.length > 0 && (
        <>
          {" "}match filters <span className="filter-summary-em">{active.join(" + ")}</span>
        </>
      )}
      {q && searches && (
        <span className="filter-summary-searches">searches: {searches}</span>
      )}
    </p>
  );
}
