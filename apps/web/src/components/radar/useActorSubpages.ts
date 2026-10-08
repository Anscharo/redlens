import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadSettlements, reportsForPrime } from "../../lib/settlements";
import { loadPau, snapshotsForPrime } from "../../lib/pau";
import { ACTOR_PAGES, hasActorPages, type ActorPageKey } from "@/lib/radarPages";
import type { SidebarGroup } from "../../lib/actorIndex";

/** The subpages each actor's sub nav offers, by slug. Only Prime Agents have
 *  any. Settlements and PAUs appear once their artifact shows data for that
 *  Prime; both are soft-loaded, so without them those links are left out. */
export function useActorSubpages(groups: SidebarGroup[]): ReadonlyMap<string, readonly ActorPageKey[]> {
  const settlements = useLoaded(loadSettlements, { soft: true });
  const pau = useLoaded(loadPau, { soft: true });
  return useMemo(() => {
    const out = new Map<string, ActorPageKey[]>();
    for (const g of groups) {
      for (const a of g.actors) {
        if (!hasActorPages(a)) continue;
        const offers: Record<ActorPageKey, boolean> = {
          settlements: !!settlements && reportsForPrime(settlements, a.slug).length > 0,
          history: true,
          instances: true,
          pau: !!pau && snapshotsForPrime(pau, a.id).length > 0,
        };
        out.set(a.slug, ACTOR_PAGES.map((p) => p.key).filter((k) => offers[k]));
      }
    }
    return out;
  }, [groups, settlements, pau]);
}
