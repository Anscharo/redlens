import { useRef } from "react";
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
 * Three-way index picker for the results page. A radiogroup, because the lanes
 * are mutually exclusive — one index is being queried, not three toggles.
 *
 * The roles do NOT bring keyboard behaviour with them, whatever an earlier
 * comment here claimed: a radiogroup that announces itself as one and then
 * ignores the arrow keys is worse than three plain buttons, because it tells a
 * screen-reader user to expect something that does not happen. So the two
 * halves of the WAI-ARIA radio pattern are implemented explicitly: exactly one
 * pill is in the tab order at a time (roving tabindex), and the arrow keys move
 * between them, wrapping, skipping any lane this deployment cannot answer.
 * Selection follows focus, which is the pattern's default and right here — the
 * lanes are cheap to flip between and the worker caches each one's answer.
 */
export function SearchLaneToggle({ lane, onSelect, semanticAvailable }: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const enabled = SEARCH_LANES.filter((id) => !(id === "semantic" && !semanticAvailable));

  function move(delta: number) {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(lane);
    // A disabled current lane is not in the list; start from the beginning
    // rather than from -1, which would land on the last pill for a "next".
    const next = enabled[(((at < 0 ? 0 : at + delta) % enabled.length) + enabled.length) % enabled.length];
    onSelect(next);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-lane="${next}"]`)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault(); // ArrowUp/Down would otherwise scroll the results
    move(step);
  }

  return (
    <div
      ref={groupRef}
      className="search-lane-toggle flex items-center gap-1 mono"
      role="radiogroup"
      aria-label="Search index"
      onKeyDown={onKeyDown}
    >
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
                data-lane={id}
                data-state={lane === id ? "active" : "inactive"}
                // Roving tabindex: Tab reaches the group once and lands on the
                // selected lane, then the arrow keys move within it.
                tabIndex={lane === id ? 0 : -1}
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
