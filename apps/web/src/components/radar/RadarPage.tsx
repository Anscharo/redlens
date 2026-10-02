import { Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { DrawerToggle } from "../Drawer";
import { Loading } from "../Loading";
import { RadarLoaded } from "./RadarLoaded";

export interface RadarPageProps {
  query: string;
  actorSlug?: string;
  /** Which view of an actor: its dashboard by default, or its cycles. */
  page?: "settlements";
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
