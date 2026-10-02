import { Link } from "../Link";
import { track } from "../../lib/analytics";
import type { RadarHit, RadarSearchGroup } from "@/lib/radarSearch";

interface Props {
  query: string;
  groups: RadarSearchGroup[];
}

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

export function RadarSearchResults({ query, groups }: Props) {
  const total = groups.reduce((n, g) => n + g.total, 0);
  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs mb-6" style={{ color: "var(--tan-3)" }} role="status">
          {total === 0
            ? `No actor, instance, parameter, address or relationship matches “${query.trim()}”.`
            : `${total} ${total === 1 ? "match" : "matches"} for “${query.trim()}”`}
        </p>
        {groups.map((g) => {
          const headingId = `radar-search-${g.kind}`;
          return (
            <section key={g.kind} aria-labelledby={headingId} className="mb-8">
              <h2
                id={headingId}
                className="mono text-[10px] uppercase tracking-wider mb-2"
                style={{ color: "var(--tan-3)" }}
              >
                {g.label}
                {g.total > g.hits.length ? ` · showing ${g.hits.length} of ${g.total}` : ` · ${g.total}`}
              </h2>
              <ul>
                {g.hits.map((hit, i) => (
                  <ResultRow key={hit.href + hit.label + i} hit={hit} rank={i + 1} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
