import { use, useMemo } from "react";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { useDataSource } from "../../lib/dataSource";
import { buildRewardsIndex } from "@/lib/rewardsIndex";
import { buildActiveDataRows } from "@/lib/activeDataIndex";
import type { ActorPageKey } from "@/lib/radarPages";
import type { GraphData } from "@/lib/graphData";
import type { AtlasNode } from "@/types";
import { buildSidebarActors, buildActorProfile } from "../../lib/actorIndex";
import { buildPrimitiveStats } from "../../lib/primitiveStats";
import { ActorList } from "./ActorList";
import { ActorPageView } from "./ActorPageView";
import { PrimitiveDashboard } from "./PrimitiveDashboard";
import { Drawer } from "../Drawer";
import { Loading } from "../Loading";
import { RadarProvider } from "./RadarContext";
import { useRadarSearch } from "../../hooks/useRadarSearch";
import { filterSidebarGroups } from "./filterSidebarGroups";
import { RadarSearchResults } from "./RadarSearchResults";
import { useActorSubpages } from "./useActorSubpages";
import { useRadarPageMeta } from "./useRadarPageMeta";

export interface RadarLoadedProps {
  query: string;
  actorSlug?: string;
  page?: ActorPageKey;
  /** Whether the actor drawer is open on a narrow viewport. */
  drawerOpen: boolean;
  /** Called when picking an actor should close that drawer. */
  onDrawerClose: () => void;
}

/** Radar once docs and graph have loaded: the actor nav in its drawer, and
 *  beside it search results, the index dashboard, or the actor's page. */
export function RadarLoaded({ query, actorSlug, page, drawerOpen, onDrawerClose }: RadarLoadedProps) {
  const { base } = useDataSource(); // data-source base (/api/...), NOT the router base
  const docs = use(loadDocs(base));
  const graph = use(loadGraph(base));

  const sidebarGroups = useMemo(() => buildSidebarActors(graph, docs), [graph, docs]);
  const filteredGroups = useMemo(() => filterSidebarGroups(sidebarGroups, query), [sidebarGroups, query]);
  const subpages = useActorSubpages(sidebarGroups);
  const searchGroups = useRadarSearch(graph, query);
  const searching = query.trim() !== "";

  const primitiveStats = useMemo(() => buildPrimitiveStats(graph, docs), [graph, docs]);
  const profile = useActorProfile(actorSlug, graph, docs);
  useRadarPageMeta({ searching, actorSlug, page, actorName: profile?.entity.name ?? null });

  return (
    <RadarProvider value={{ docs }}>
      <Drawer open={drawerOpen} onClose={onDrawerClose} breakpoint={850} desktopMode="sticky">
        <ActorList groups={filteredGroups} selectedSlug={actorSlug ?? null} page={page} subpages={subpages} />
      </Drawer>
      {searching ? (
        searchGroups ? <RadarSearchResults query={query} groups={searchGroups} /> : <Loading />
      ) : !actorSlug ? (
        <PrimitiveDashboard agents={primitiveStats} />
      ) : !profile ? (
        <Loading>actor not found</Loading>
      ) : (
        <ActorPageView profile={profile} page={page} />
      )}
    </RadarProvider>
  );
}

function useActorProfile(actorSlug: string | undefined, graph: GraphData, docs: Record<string, AtlasNode>) {
  const rewardsIndex = useMemo(() => buildRewardsIndex(docs, graph), [docs, graph]);
  const allActiveDataRows = useMemo(() => buildActiveDataRows(docs, graph), [docs, graph]);
  return useMemo(
    () => (actorSlug ? buildActorProfile(actorSlug, graph, docs, rewardsIndex, allActiveDataRows) : null),
    [actorSlug, graph, docs, rewardsIndex, allActiveDataRows],
  );
}
