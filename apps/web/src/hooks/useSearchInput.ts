import { useEffect, useRef, useCallback, useDeferredValue } from "react";
import { useSearch } from "./useSearch";
import { useDataSource } from "../lib/dataSource";
import { useSearchAnyway } from "./useSearchAnyway";
import { useUrlState, urlString, urlEnum } from "./useUrlState";
import { SEARCH_LANES, type SearchLane } from "@/lib/searchSemantic";
import { semanticLaneUsable } from "../lib/semanticSearchConfig";
import { ROUTES, PREVIEW_INDEX_PATH, homeSearchHref, type SearchScope } from "@/lib/routes";
import { track } from "../lib/analytics";
import { useRecentSearches, useRecordRecentSearch } from "../lib/recentSearches";
import {
  SEARCH_MODES,
  applyMode,
  effectiveMode,
  isMixedQuotes,
  modePillClick,
  type SearchMode,
} from "../lib/searchMode";

// The pure mode logic lives in lib/searchMode.ts; these names stay importable here.
export { applyMode, isMixedQuotes, modePillClick, type SearchMode };

const queryCodec = urlString(null);

const modeCodec = urlEnum<SearchMode>("broad", SEARCH_MODES);
const laneCodec = urlEnum<SearchLane>("lexical", SEARCH_LANES);

// Slash shortcuts, resolved for BOTH entry points (typing an exact command and
// clicking a row on the `/` cheat sheet) so the two can never disagree.
//
// `/preview` is a full page load on purpose: main.tsx resolves it from
// window.location before the SPA router mounts, so it has no <Route> and
// wouter's navigate() would just leave App with nothing matching. The reload
// also correctly exits a /preview/<id> session back to the index.
type SlashTarget = { spa: string } | { load: string };

const SLASH_TARGETS: Record<string, SlashTarget> = {
  "/reports": { spa: ROUTES.REPORTS },
  "/radar": { spa: ROUTES.RADAR },
  "/features": { spa: ROUTES.FEATURES },
  "/h": { spa: ROUTES.SEARCH_HINTS },
  "/preview": { load: PREVIEW_INDEX_PATH },
};

/** Runs `q` as a slash command; true when it was one (caller should stop). */
export function runSlashCommand(q: string, navigate: (to: string) => void): boolean {
  const target = SLASH_TARGETS[q];
  if (!target) return false;
  if ("load" in target) window.location.assign(target.load);
  else navigate(target.spa);
  return true;
}

/**
 * Which index the results page queries (`?lane=`), and the setter that switches
 * it.
 *
 * Switching lane re-runs the current query against the other index; nothing else
 * about the search changes, so `?q=` is left alone. A shared `?lane=semantic`
 * link opened against a deployment that cannot answer it falls back to wording,
 * rather than searching an index that is permanently empty there.
 */
function useSearchLane(): { lane: SearchLane; selectLane: (next: SearchLane) => void } {
  const [laneParam, setLane] = useUrlState("lane", laneCodec);
  const { base } = useDataSource();
  const lane: SearchLane = laneParam === "semantic" && !semanticLaneUsable(base) ? "lexical" : laneParam;
  const selectLane = useCallback((next: SearchLane) => {
    track("search_lane_change", { product: "search", lane: next });
    setLane(next);
  }, [setLane]);
  return { lane, selectLane };
}

export function useSearchInput(location: string, navigate: (to: string) => void, scope: SearchScope) {
  const { state, search, ready } = useSearch();
  const [queryParam, setQueryParam] = useUrlState("q", queryCodec);
  const [mode, setMode] = useUrlState("mode", modeCodec);
  const { lane, selectLane } = useSearchLane();
  const searchAnyway = useSearchAnyway(state, lane, search);
  const query = queryParam ?? "";
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMixed = isMixedQuotes(query);
  const effMode = effectiveMode(query);
  // Active mode: prefer what's visible in the query; fall back to URL param.
  const activeMode: SearchMode = !isMixed && effMode !== "broad" ? effMode : mode;

  // Recent-search history: record the current settled search, expose the list.
  useRecordRecentSearch(state, query);
  const recentSearches = useRecentSearches();

  useEffect(() => {
    if (location === ROUTES.HOME) inputRef.current?.focus();
  }, [location]);

  useEffect(() => {
    if (location !== ROUTES.HOME) { search(""); return; }
    if (deferredQuery.startsWith("/")) { search(""); return; }
    // The mode wrap is NOT applied on the meaning lane: `?mode=strict` left over
    // from a wording search would quote the query, and this lane would then both
    // strip those quotes and report them back as ignored syntax the reader never
    // typed. The pills are disabled there for the same reason.
    const withMode = lane === "semantic" ? deferredQuery : applyMode(deferredQuery, mode);
    search(withMode.trim() ? withMode : "", { lane });
  }, [deferredQuery, mode, location, search, lane]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      if (runSlashCommand(q, navigate)) return;
      if (scope === "atlas" && location !== ROUTES.HOME) {
        navigate(homeSearchHref(q, new URLSearchParams(window.location.search).get("split")));
        return;
      }
      setQueryParam(q || null);
    },
    [location, navigate, scope, setQueryParam],
  );

  const handleHintClick = useCallback(
    (q: string) => {
      if (runSlashCommand(q, navigate)) return;
      if (/~\d/.test(q)) setMode("broad");
      setQueryParam(q || null);
    },
    [navigate, setQueryParam, setMode],
  );

  const clearQuery = useCallback(() => {
    setQueryParam(null);
    inputRef.current?.focus();
  }, [setQueryParam]);

  const broadSearch = useCallback((q: string) => {
    setMode("broad");
    setQueryParam(q || null);
  }, [setMode, setQueryParam]);

  // Picking a recent search re-runs it on the results page (works from any
  // route — e.g. focusing the bar on /radar), then refocuses the input so the
  // restored query can be edited straight away.
  const selectRecent = useCallback((q: string, rank: number) => {
    track("search_recent_select", { product: "search", query: q, rank: rank + 1 });
    navigate(homeSearchHref(q, new URLSearchParams(window.location.search).get("split")));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [navigate]);

  // Clicking a mode pill wraps/unwraps the free text in the input and positions
  // the cursor before the closing quote so typing extends the phrase naturally.
  const wrapModeClick = useCallback((newMode: SearchMode) => {
    track("search_mode_change", { mode: newMode });
    const { newQuery, cursorPos } = modePillClick(query, mode, newMode);
    setQueryParam(newQuery || null);

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }, [query, mode, setQueryParam, inputRef]);

  return {
    query, activeMode, isMixed,
    inputRef, handleChange, clearQuery,
    wrapModeClick, broadSearch,
    state, ready, handleHintClick,
    recentSearches, selectRecent,
    lane, selectLane, searchAnyway,
  };
}
