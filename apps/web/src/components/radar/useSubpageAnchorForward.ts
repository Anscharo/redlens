import { useEffect } from "react";
import { useLocation } from "wouter";
import { useLocationProperty } from "wouter/use-browser-location";
import { actorPageHref } from "@/lib/routes";
import { RADAR_SECTION } from "@/lib/radarAnchors";
import type { ActorPageKey } from "@/lib/radarPages";
import type { RadarPrimitive } from "../../lib/actorIndex";
import { toAnchorId } from "../../lib/anchorId";

const currentHash = () => window.location.hash;

/** The subpage that renders a fragment a Prime's Info page does not, or null
 *  when the fragment belongs on the Info page. Instance, invocation, primitive
 *  and category anchors are ActorInstances' (see its withStatusAnchors). */
export function subpageForAnchor(
  id: string,
  primitives: readonly RadarPrimitive[],
): { page: ActorPageKey; fragment?: string } | null {
  if (id === RADAR_SECTION.history) return { page: "history" };
  if (id === RADAR_SECTION.pau) return { page: "pau" };
  if (id === RADAR_SECTION.primitives) return { page: "instances" };
  const onInstances =
    id.startsWith("instance-") ||
    id === "instances" ||
    id === "invocations" ||
    id.startsWith("invocations-") ||
    primitives.some((p) => id === p.st || id.startsWith(`${p.st}-`) || id === toAnchorId(p.category ?? "Other"));
  return onInstances ? { page: "instances", fragment: id } : null;
}

/** On a Prime's Info page, a link whose fragment names a section that lives on
 *  a subpage is replaced by that subpage, fragment kept, so an anchor link to
 *  /radar/<slug>#… still lands on what it names. */
export function useSubpageAnchorForward(slug: string, primitives: readonly RadarPrimitive[], enabled: boolean): void {
  const hash = useLocationProperty(currentHash);
  const [, navigate] = useLocation();
  useEffect(() => {
    const id = hash.slice(1);
    if (!enabled || !id) return;
    const target = subpageForAnchor(decodeURIComponent(id), primitives);
    if (target) navigate(actorPageHref(slug, target.page, target.fragment), { replace: true });
  }, [enabled, hash, slug, primitives, navigate]);
}
