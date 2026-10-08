import { Suspense } from "react";
import { Redirect } from "wouter";
import { actorHref } from "@/lib/routes";
import { isActorPageKey } from "@/lib/radarPages";
import { Loading } from "../components/Loading";
import { RadarPage } from "./lazyRoutes";

export interface RadarActorRouteProps {
  slug: string;
  /** The subpage segment; absent on the actor's Info page. */
  page?: string;
  query: string;
}

/** /radar/:slug and /radar/:slug/:page. A segment that names no subpage in
 *  src/lib/radarPages.ts redirects to the actor's Info page. */
export function RadarActorRoute({ slug, page, query }: RadarActorRouteProps) {
  if (page !== undefined && !isActorPageKey(page)) return <Redirect to={actorHref(slug)} replace />;
  return (
    <Suspense fallback={<Loading />}>
      <RadarPage actorSlug={slug} query={query} page={page} />
    </Suspense>
  );
}
