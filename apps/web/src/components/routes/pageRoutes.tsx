import { useLocation, useSearchParams } from "wouter";
import { homeSearchHref } from "@/lib/routes";
import { ATLAS_TABS } from "../../lib/atlasTab";
import { urlEnum } from "../../hooks/useUrlState";
import { useAtlasNodeId } from "../../hooks/useAtlasNodeId";
import { useNavigation } from "../../hooks/useNavigation";
import { useSplitPane } from "../../hooks/useSplitPane";
import type { SearchInput } from "../../hooks/useSearchInput";
import { AtlasView } from "../atlas/AtlasView";
import { SearchResults } from "../SearchResults";
import { SearchHintsPage } from "../SearchHints";
import { HomePage } from "../HomePage";
import { DevPanel } from "../../DevPanel";

// Notes is the default panel, so an absent (or unrecognized) ?view= lands there.
const ATLAS_TAB_CODEC = urlEnum("notes", ATLAS_TABS);

/** `/`: the home page, or the search results once there is a query. */
export function HomeRoute({ search }: { search: SearchInput }) {
  const { query, state, activeMode, lane, selectLane, handleHintClick, broadSearch } = search;
  if (query.startsWith("__dev")) return <DevPanel query={query} />;
  if (!query) return <HomePage />;
  return (
    <SearchResults
      state={state}
      query={query}
      mode={activeMode}
      lane={lane}
      onLaneSelect={selectLane}
      onHintClick={handleHintClick}
      onBroadSearch={broadSearch}
    />
  );
}

/** `/atlas?id=<uuid>`: the reader, with its panel (?view=) and comparison pane (?split=). */
export function AtlasRoute({ onOpenTree }: { onOpenTree: () => void }) {
  const [, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const nodeId = useAtlasNodeId();
  const { navigateToNode, handleViewChange } = useNavigation({ navigate, nodeId });
  const { splitId, handleSplitChange } = useSplitPane(nodeId);
  return (
    <AtlasView
      id={nodeId ?? ""}
      onNavigate={navigateToNode}
      view={ATLAS_TAB_CODEC.decode(searchParams.get("view"))}
      onViewChange={handleViewChange}
      splitId={splitId}
      onSplitChange={handleSplitChange}
      onOpenTree={onOpenTree}
    />
  );
}

/** `/search-hints`: a hint runs its example search, keeping any open comparison pane. */
export function SearchHintsRoute() {
  const [, navigate] = useLocation();
  const { splitId } = useSplitPane(null);
  return <SearchHintsPage onHintClick={(q) => navigate(homeSearchHref(q, splitId))} />;
}
