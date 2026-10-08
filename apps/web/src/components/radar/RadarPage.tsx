import { Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { ActorPageKey } from "@/lib/radarPages";
import { DrawerToggle } from "../Drawer";
import { Loading } from "../Loading";
import { RadarLoaded } from "./RadarLoaded";

export interface RadarPageProps {
  query: string;
  actorSlug?: string;
  /** Which subpage of the actor (src/lib/radarPages.ts); absent on its Info page. */
  page?: ActorPageKey;
}

export function RadarPage({ query, actorSlug, page }: RadarPageProps) {
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
