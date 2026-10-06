import type { SidebarGroup } from "../../lib/actorIndex";

/** Sidebar filter: a name match keeps the actor; a role query matches a group's
 * label ("facilitator", "prime") and keeps that whole group. */
export function filterSidebarGroups(groups: SidebarGroup[], query: string): SidebarGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) =>
      g.label.toLowerCase().includes(q)
        ? g
        : { ...g, actors: g.actors.filter((a) => a.name.toLowerCase().includes(q)) },
    )
    .filter((g) => g.actors.length > 0);
}
