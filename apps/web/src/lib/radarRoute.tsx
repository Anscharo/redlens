import { Suspense } from "react";
import { Redirect } from "wouter";
import { ROUTES, actorHref, actorPageHref } from "@/lib/routes";
import { isActorPageKey, legacyActorPageKey } from "@/lib/radarPages";
import { Loading } from "../components/Loading";
import { RadarPage } from "./lazyRoutes";

/** One route for an actor's Info page and its subpages: /radar/:slug and
 *  /radar/:slug/:page (the segment is optional). */
export const RADAR_ACTOR_ROUTE = `${ROUTES.RADAR_ACTOR_PAGE}?`;

export interface RadarActorRouteProps {
  slug: string;
  /** The subpage segment; absent on the actor's Info page. */
  page?: string;
  query: string;
}

/** An actor's page. A retired segment redirects to the subpage that replaced
 *  it, fragment kept; a segment that names no subpage in
 *  src/lib/radarPages.ts redirects to the actor's Info page. */
export function RadarActorRoute({ slug, page, query }: RadarActorRouteProps) {
  const renamed = legacyActorPageKey(page);
  if (renamed) return <Redirect to={actorPageHref(slug, renamed) + window.location.hash} replace />;
  if (page !== undefined && !isActorPageKey(page)) return <Redirect to={actorHref(slug)} replace />;
  return (
    <Suspense fallback={<Loading />}>
      <RadarPage actorSlug={slug} query={query} page={page} />
    </Suspense>
  );
}
