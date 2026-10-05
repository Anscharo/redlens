import { Link } from "../Link";
import { track } from "../../lib/analytics";
import type { RadarHit, RadarSearchGroup as Group } from "@/lib/radarSearch";

function ResultRow({ hit, rank }: { hit: RadarHit; rank: number }) {
  const onClick = () =>
    track("radar_search_result_click", {
      product: "radar",
      result_kind: hit.kind,
      rank,
      target_slug: hit.slug,
      anchor: hit.anchor ?? null,
    });
  return (
    <li>
      <Link to={hit.href} className="search-result-link px-3 py-2" onClick={onClick}>
        <span className="text-sm" style={{ color: "var(--tan)" }}>
          {hit.label}
        </span>
        <span className="block mono text-[10px]" style={{ color: "var(--tan-3)" }}>
          {hit.context}
        </span>
        {hit.excerpt && (
          <span className="block text-xs mt-0.5" style={{ color: "var(--tan-2)" }}>
            {hit.excerpt}
          </span>
        )}
      </Link>
    </li>
  );
}

/** One kind of Radar search hit (actors, instances, …) under its own labelled heading. */
export function RadarSearchGroup({ group }: { group: Group }) {
  const headingId = `radar-search-${group.kind}`;
  return (
    <section aria-labelledby={headingId} className="mb-8">
      <h2
        id={headingId}
        className="mono text-[10px] uppercase tracking-wider mb-2"
        style={{ color: "var(--tan-3)" }}
      >
        {group.label}
        {group.total > group.hits.length
          ? ` · showing ${group.hits.length} of ${group.total}`
          : ` · ${group.total}`}
      </h2>
      <ul>
        {group.hits.map((hit, i) => (
          <ResultRow key={hit.href + hit.label + i} hit={hit} rank={i + 1} />
        ))}
      </ul>
    </section>
  );
}
