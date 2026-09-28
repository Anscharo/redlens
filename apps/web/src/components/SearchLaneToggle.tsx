import { SEARCH_LANES, type SearchLane } from "@/lib/searchSemantic";
import { Tooltip } from "./Tooltip";

// One pill per index the results page can query. Wording, not "lexical",
// is what the pill says: the reader's audience is analysts, and "lexical"
// names an implementation. The tooltip carries the precise version.
const LANE_COPY: Record<SearchLane, { label: string; title: string }> = {
  lexical: {
    label: "wording",
    title: "Wording — the words you typed, matched against titles and text (lexical search)",
  },
  graph: {
    label: "entities",
    title: "Entities — Agents, Facilitators, Conservers, Instances and Primitives by name, from the relationship graph",
  },
  semantic: {
    label: "meaning",
    title: "Meaning — documents scored by what they are about, even when they share no word with your query (semantic search)",
  },
};

interface Props {
  lane: SearchLane;
  onSelect: (lane: SearchLane) => void;
  /** False when this deployment cannot answer the meaning lane. */
  semanticAvailable: boolean;
}

/**
 * Three-way index picker for the results page. Rendered as a radiogroup rather
 * than three buttons: the lanes are mutually exclusive and arrow-key navigable
 * for free, which three <button>s would not be.
 */
export function SearchLaneToggle({ lane, onSelect, semanticAvailable }: Props) {
  return (
    <div className="search-lane-toggle flex items-center gap-1 mono" role="radiogroup" aria-label="Search index">
      {SEARCH_LANES.map((id) => {
        const { label, title } = LANE_COPY[id];
        const unavailable = id === "semantic" && !semanticAvailable;
        return (
          <Tooltip
            key={id}
            content={unavailable ? "Meaning search is not configured on this deployment" : title}
          >
            {/* Wrapped, like the mode pills: a DISABLED button fires no pointer
                events, so the tooltip explaining why it is disabled has to hang
                off an element that does. */}
            <span className="flex">
              <button
                type="button"
                role="radio"
                aria-checked={lane === id}
                aria-label={title}
                data-state={lane === id ? "active" : "inactive"}
                disabled={unavailable}
                onClick={() => onSelect(id)}
                className="search-lane-pill text-[10px] px-2 py-0.5 rounded-sm border"
              >
                {label}
              </button>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
