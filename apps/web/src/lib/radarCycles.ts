import { FORUM_CYCLES, cycleBySlug, type ForumCycle } from "@/lib/forumKinds";
import type { SidebarGroup } from "./actorIndex";

export type { ForumCycle };
export { cycleBySlug };

/** Radar sidebar group for allowlisted forum cycle dashboards. */
export function cycleSidebarGroup(): SidebarGroup {
  return {
    label: "Cycles",
    actors: FORUM_CYCLES.map((c) => ({
      id: `cycle:${c.kind}`,
      slug: c.slug,
      name: c.title,
      et: "cycle",
      st: null,
      docId: c.atlasDocId,
    })),
  };
}
