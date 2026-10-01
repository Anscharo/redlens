import { Link } from "./Link";
import { track } from "../lib/analytics";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, SUBTYPE_LABEL } from "../lib/entityGraph";
import type { EntitySearchHit } from "@/types";

interface Props {
  hits: EntitySearchHit[];
  /** The query these hits answered, for the click event. */
  query: string;
  /** performance.now() at which the list was shown, for time-to-click. */
  shownAt: number;
  /**
   * The search has finished and the graph worker has answered. Gates the
   * empty-state copy below: an unsettled lane has no hits YET, and saying
   * "entities will show here" mid-lookup is the same mistake as the "no
   * results" this lane used to flash before it had a loading state.
   */
  settled: boolean;
}

/** What the entities lane holds, for a reader whose query matched none of it. */
const EMPTY_HINT =
  "Sky Ecosystem Agents, Facilitators, Gov Ops, Development Companies and other entities extracted from mentions in the atlas will show here";

/**
 * Graph entity hits — Agents, Facilitators, Conservers, Instances, Primitives.
 * The whole result list on the entities lane, and rendered nowhere else.
 */
export function EntityResults({ hits, query, shownAt, settled }: Props) {
  if (hits.length === 0) {
    if (!settled) return null;
    // Deliberately larger than everything else under the count line: it is the
    // only thing on the page, and it is prose to read rather than chrome to scan.
    return <p className="px-4 py-6 text-base leading-relaxed text-tan-2">{EMPTY_HINT}</p>;
  }
  return (
    <>
      {/* No count here — the line above is already counting this very list. */}
      <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">Entities</div>
      <ul>
        {hits.map(({ participant, href }, i) => (
          <li key={participant.id}>
            <Link
              to={href}
              className="search-result-link px-4 py-3 flex items-center gap-3"
              onClick={() =>
                track("search_result_click", {
                  product: "search",
                  result_kind: "entity",
                  query,
                  rank: i + 1, // 1-based, within the entity list
                  in_top_5: i < 5,
                  ms_to_click: Math.round(performance.now() - shownAt),
                  result_count: hits.length,
                  entity_id: participant.id,
                  entity_slug: participant.slug,
                  entity_type: participant.et,
                })
              }
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0 mr-3"
                style={{ background: ENTITY_TYPE_COLOR[participant.et] ?? "var(--entity-fallback)" }}
              />
              <span className="text-sm font-semibold text-tan">{participant.name}</span>
              <span className="mono text-[10px] text-tan-3 ml-4">
                {ENTITY_TYPE_LABEL[participant.et] ?? participant.et}
                {participant.st ? ` · ${SUBTYPE_LABEL[participant.st] ?? participant.st}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
