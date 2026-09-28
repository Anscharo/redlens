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
   * Header shown above the list, rendered verbatim. The entities lane makes
   * this list the whole page, so it names the index and the count line above
   * already states the count; as an overlay above doc hits it names the entity
   * kinds (which is what tells a reader why these rows differ) and carries its
   * own count, since the line above is counting documents.
   */
  heading: string;
}

/**
 * Graph entity hits — Agents, Facilitators, Conservers, Instances, Primitives.
 * Rendered above doc results on the wording lane, and on its own as the whole
 * result list on the entities lane.
 */
export function EntityResults({ hits, query, shownAt, heading }: Props) {
  if (hits.length === 0) return null;
  return (
    <>
      <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
        {heading}
      </div>
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
