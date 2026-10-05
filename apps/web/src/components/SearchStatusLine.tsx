import { SearchLaneToggle } from "./SearchLaneToggle";
import { Link } from "./Link";
import { ROUTES } from "@/lib/routes";
import type { SearchState } from "../hooks/useSearch";
import { showsLoginPrompt } from "./SemanticLoginPrompt";
import { MIN_SEMANTIC_QUERY, semanticLaneLimit, type SearchLane } from "@/lib/searchSemantic";

interface Props {
  state: SearchState;
  /** Rows actually on screen; equal to `total` until "show more" paginates. */
  shown: number;
  total: number;
  /** Milliseconds to report, or null to omit when there is no honest figure. */
  durationMs: number | null;
  /** True while the lane the reader is looking at still has work in flight. */
  pending: boolean;
  lane: SearchLane;
  onLaneSelect: (lane: SearchLane) => void;
  semanticAvailable: boolean;
}

// What the count line says about the semantic leg, when there is anything to
// say. The states worth a note are the ones that END badly: a leg still in
// flight is reported by <SemanticProgress />, which renders on exactly this
// condition and names the stage it is on, so a note here would stack a second
// quieter copy of the same sentence under it. What must NOT be lost with it is
// `count` reading "searching…" rather than "no results" while the leg runs —
// that is the flash a reader retypes over, and it is below, not here.
function semanticNote(state: SearchState, lane: SearchLane): string | null {
  if (state.status !== "done") return null;
  switch (state.semantic) {
    case "pending":
      return null;
    case "skipped":
      // The sign-in prompt below the line says this one in full.
      if (showsLoginPrompt(state)) return null;
      return `meaning search unavailable — ${state.semanticNote ?? "it failed"}`;
    case "unavailable":
      return "meaning search is not configured here";
    case "none":
      // Only worth saying on the lane the reader explicitly picked: they asked
      // for meaning and got wording, and silence would read as a bad result set.
      // The limit names WHY where it can; an identifier query falls back to the
      // general sentence, since the lexical lane answered it exactly.
      if (lane !== "semantic") return null;
      if (state.heldWords?.length) return heldNote(state.heldWords);
      return limitNote(state.query) ?? "nothing to score by meaning — showing wording matches";
    default:
      // The leg ran. Say something only where it could not honour the query as
      // typed — a filter that has no string to act on here.
      return lane === "semantic" ? limitNote(state.query) : null;
  }
}

/** Why a meaning query was not sent, and the one key that sends it anyway. */
function heldNote(words: string[]): string {
  const quoted = words.map((w) => `“${w}”`).join(", ");
  const verb = words.length === 1 ? "doesn't look like a word" : "don't look like words";
  return `${quoted} ${verb} — showing wording matches, press Enter to search by meaning anyway`;
}

/**
 * What the meaning lane could not do with the query, in the reader's own words.
 *
 * This is the one place that explains the lane's contract at the moment it bites:
 * it scores whole documents, so string syntax has nothing to act on and is
 * dropped rather than silently half-applied. `in:` is never named here — it is a
 * doc-number filter the lane does honour.
 */
function limitNote(query: string): string | null {
  const limit = semanticLaneLimit(query);
  if (!limit) return null;
  const syntax = limit.syntax.join(" ");
  if (limit.kind === "ignored") {
    return `${syntax} ignored — meaning search scores whole documents, not strings`;
  }
  if (limit.syntax.length > 0) {
    return `nothing left to score by meaning after ${syntax} — showing wording matches`;
  }
  return `too short to score by meaning (${MIN_SEMANTIC_QUERY} characters minimum) — showing wording matches`;
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
      {state.status === "done" && state.query && (
        <Link to={`${ROUTES.RADAR}?q=${encodeURIComponent(state.query)}`} className="hover:text-accent">
          Search actors and instances on Radar →
        </Link>
      )}
      <span className="ml-auto">
        <SearchLaneToggle lane={lane} onSelect={onLaneSelect} semanticAvailable={semanticAvailable} />
      </span>
    </div>
  );
}
