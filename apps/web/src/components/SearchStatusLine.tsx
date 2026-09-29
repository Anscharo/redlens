import { SearchLaneToggle } from "./SearchLaneToggle";
import type { SearchState } from "../hooks/useSearch";
import type { SearchLane } from "@/lib/searchSemantic";

interface Props {
  state: SearchState;
  /** Rows actually on screen; equal to `total` until "show more" paginates. */
  shown: number;
  total: number;
  /**
   * Milliseconds to report, or null to omit. The entities lane has no timing of
   * its own (the graph worker doesn't report one), and showing the document
   * search's duration next to an entity count would be a made-up number.
   */
  durationMs: number | null;
  /**
   * True while a lane the reader is looking at still has work in flight.
   * Passed in rather than derived here, because the two legs that can be
   * pending report through different channels — the meaning one on the search
   * worker's message, the entity one through the graph worker's own state —
   * and this line must not say "no results" while either is running.
   */
  pending: boolean;
  lane: SearchLane;
  onLaneSelect: (lane: SearchLane) => void;
  semanticAvailable: boolean;
}

// What the count line says about the semantic leg, when there is anything to
// say. A pending leg is the load-bearing one: without it a fallback search
// reads "no results" for the ~400ms + round-trip before the meaning hits land,
// which is exactly the moment a reader gives up and retypes.
function semanticNote(state: SearchState, lane: SearchLane): string | null {
  if (state.status !== "done") return null;
  switch (state.semantic) {
    case "pending":
      return "scoring by meaning…";
    case "skipped":
      return `meaning search unavailable — ${state.semanticNote ?? "it failed"}`;
    case "unavailable":
      return "meaning search is not configured here";
    case "none":
      // Only worth saying on the lane the reader explicitly picked: they asked
      // for meaning and got wording, and silence would read as a bad result set.
      return lane === "semantic" ? "nothing to score by meaning — showing wording matches" : null;
    default:
      return null;
  }
}

/** The result count / progress line above the list, plus the lane picker. */
export function SearchStatusLine({ state, shown, total, durationMs, pending, lane, onLaneSelect, semanticAvailable }: Props) {
  const note = semanticNote(state, lane);
  let count: string;
  if (state.status !== "done") count = "searching…";
  else if (total === 0) count = pending ? "searching…" : `no results for "${state.query}"`;
  else
    count =
      `${shown < total ? `${shown} of ` : ""}${total} result${total !== 1 ? "s" : ""}` +
      (durationMs === null ? "" : ` · ${durationMs.toFixed(0)}ms`);

  return (
    <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{count}</span>
      {note && <span className="search-semantic-note">{note}</span>}
      <span className="ml-auto">
        <SearchLaneToggle lane={lane} onSelect={onLaneSelect} semanticAvailable={semanticAvailable} />
      </span>
    </div>
  );
}
