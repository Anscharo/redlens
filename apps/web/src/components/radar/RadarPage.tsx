import { Suspense, use, useEffect, useMemo, useState } from "react";
import { useLocation, useRouter } from "wouter";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { useDataSource } from "../../lib/dataSource";
import { buildRewardsIndex } from "@/lib/rewardsIndex";
import { buildActiveDataRows } from "@/lib/activeDataIndex";
import { buildSidebarActors, buildActorProfile } from "../../lib/actorIndex";
import { buildPrimitiveStats } from "../../lib/primitiveStats";
import { ActorList } from "./ActorList";
import { ActorDashboard } from "./ActorDashboard";
import { ActorSettlementsPage } from "./ActorSettlementsPage";
import { CycleDashboard } from "./CycleDashboard";
import { PrimitiveDashboard } from "./PrimitiveDashboard";
import { cycleBySlug, cycleSidebarGroup } from "../../lib/radarCycles";
import { Drawer, DrawerToggle } from "../Drawer";
import { Loading } from "../Loading";
import { RadarProvider } from "./RadarContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { recordVisit } from "../../lib/visitHistory";
import { actorHref, settlementsHref } from "@/lib/routes";

interface Props {
  query: string;
  actorSlug?: string;
  page?: "settlements";
}

interface InnerProps extends Props {
  drawerOpen: boolean;
  onDrawerClose: () => void;
}

function RadarLoaded({ query, actorSlug, page, drawerOpen, onDrawerClose }: InnerProps) {
  const { base } = useDataSource(); // data-source base (/api/...), NOT the router base
  const { base: routerBase } = useRouter(); // "" live / /preview/<id> in preview
  const docs = use(loadDocs(base));
  const graph = use(loadGraph(base));

  const sidebarGroups = useMemo(
    () => [cycleSidebarGroup(), ...buildSidebarActors(graph, docs)],
    [graph, docs],
  );
  const cycle = actorSlug ? cycleBySlug(actorSlug) : undefined;
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sidebarGroups;
    // The search pill promises "name, role" — a role query matches a group's
    // label ("facilitator", "prime") and keeps that whole group.
    return sidebarGroups
      .map((g) =>
        g.label.toLowerCase().includes(q)
          ? g
          : { ...g, actors: g.actors.filter((a) => a.name.toLowerCase().includes(q)) },
      )
      .filter((g) => g.actors.length > 0);
  }, [sidebarGroups, query]);

  const rewardsIndex = useMemo(() => buildRewardsIndex(docs, graph), [docs, graph]);
  const allActiveDataRows = useMemo(() => buildActiveDataRows(docs, graph), [docs, graph]);
  const primitiveStats = useMemo(() => buildPrimitiveStats(graph, docs), [graph, docs]);
  const profile = useMemo(() => {
    if (!actorSlug || cycle) return null;
    return buildActorProfile(actorSlug, graph, docs, rewardsIndex, allActiveDataRows);
  }, [actorSlug, cycle, graph, docs, rewardsIndex, allActiveDataRows]);

  const title = cycle
    ? `${cycle.title} Radar: Sky Atlas by Redline`
    : !actorSlug
      ? "Redline Radar for Sky Atlas"
      : !profile
        ? null
        : page === "settlements"
          ? `${profile.entity.name} monthly settlement · Radar: Sky Atlas by Redline`
          : `${profile.entity.name} Radar: Sky Atlas by Redline`;
  useDocumentTitle(title);

  // Append the actor / cycle / settlements page to the visit log once it resolves.
  useEffect(() => {
    if (cycle) {
      void recordVisit({ path: actorHref(cycle.slug), label: cycle.title, base: routerBase });
      return;
    }
    if (!actorSlug || !profile) return;
    const path = page === "settlements" ? settlementsHref(actorSlug) : actorHref(actorSlug);
    const label = page === "settlements"
      ? `${profile.entity.name} · Monthly settlement`
      : profile.entity.name;
    void recordVisit({ path, label, base: routerBase });
  }, [cycle, actorSlug, profile, routerBase, page]);

  return (
    <RadarProvider value={{ docs }}>
      <Drawer
        open={drawerOpen}
        onClose={onDrawerClose}
        breakpoint={850}
        desktopMode="sticky"
      >
        <ActorList groups={filteredGroups} selectedSlug={actorSlug ?? null} />
      </Drawer>
      {cycle ? (
        <CycleDashboard cycle={cycle} />
      ) : !actorSlug ? (
        <PrimitiveDashboard agents={primitiveStats} />
      ) : !profile ? (
        <Loading>actor not found</Loading>
      ) : page === "settlements" ? (
        <ActorSettlementsPage profile={profile} />
      ) : (
        <ActorDashboard profile={profile} />
      )}
    </RadarProvider>
  );
}

export function RadarPage({ query, actorSlug, page }: Props) {
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer when navigation actually changes the URL — the actor list
  // uses <Link> now, so we react to location changes instead of firing inside
  // each link's onClick.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  return (
    <div className="flex-1 flex">
      <Suspense fallback={
        <div className="flex-1 flex flex-col">
          <DrawerToggle label="Actors" onClick={() => setDrawerOpen(true)} breakpoint={850} />
          <Loading />
        </div>
      }>

        <DrawerToggle label="Actors" onClick={() => setDrawerOpen(true)} breakpoint={850} />
        <RadarLoaded
          query={query}
          actorSlug={actorSlug}
          page={page}
          drawerOpen={drawerOpen}
          onDrawerClose={() => setDrawerOpen(false)}
        />
      </Suspense>
    </div>
  );
}
