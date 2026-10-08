import { useEffect } from "react";
import { useRouter } from "wouter";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { recordVisit } from "../../lib/visitHistory";
import { actorPageHref } from "@/lib/routes";
import { actorPageDef, type ActorPageKey } from "@/lib/radarPages";

export interface RadarPageMeta {
  searching: boolean;
  actorSlug?: string;
  page?: ActorPageKey;
  /** The resolved actor's name; null while it is unknown. */
  actorName: string | null;
}

/** The document title of a radar page, and its entry in the visit log once
 *  the actor resolves. A subpage is named after the actor, then the page. */
export function useRadarPageMeta({ searching, actorSlug, page, actorName }: RadarPageMeta): void {
  const { base: routerBase } = useRouter(); // "" live / /preview/<id> in preview
  const label = actorName === null ? null : page ? `${actorName} · ${actorPageDef(page).title}` : actorName;

  const title = searching
    ? "Radar search: Redline Portal"
    : !actorSlug
      ? "Redline Radar for Sky Atlas"
      : label === null
        ? null
        : `${label}${page ? " ·" : ""} Radar: Redline Portal`;
  useDocumentTitle(title);

  useEffect(() => {
    if (searching || !actorSlug || label === null) return;
    void recordVisit({ path: actorPageHref(actorSlug, page), label, base: routerBase });
  }, [actorSlug, label, routerBase, page, searching]);
}
