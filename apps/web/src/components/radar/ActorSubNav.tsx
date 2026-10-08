import { Link } from "../Link";
import { actorPageHref } from "@/lib/routes";
import { actorPageDef, type ActorPageKey } from "@/lib/radarPages";
import type { SidebarActor } from "../../lib/actorIndex";

export interface ActorSubNavProps {
  actor: SidebarActor;
  /** The subpages this actor offers, in nav order; Info always leads. */
  pages: readonly ActorPageKey[];
  open: boolean;
  onToggle: () => void;
  selected: boolean;
  /** The subpage open now, when this actor is the selected one. */
  page?: ActorPageKey;
  /** The actor's subtype badge, rendered after its name. */
  badge?: React.ReactNode;
}

/** One actor with a sub nav. The row is a disclosure button (it never
 *  navigates); the sub nav's links do. The sub nav animates open and shut
 *  with a grid-rows transition (index.css, .actor-sub). */
export function ActorSubNav({ actor, pages, open, onToggle, selected, page, badge }: ActorSubNavProps) {
  const subId = `actor-sub-${actor.slug}`;
  return (
    <div className="actor-group" data-state={open ? "open" : "closed"}>
      <button
        type="button"
        className="actor-list-item w-full text-left px-3 py-1.5 text-sm flex items-center gap-2"
        style={{ color: "var(--tan-2)" }}
        aria-expanded={open}
        aria-controls={subId}
        data-selected={selected ? "true" : undefined}
        onClick={onToggle}
      >
        <span className="flex-1 truncate">{actor.name}</span>
        {badge}
        <span className="actor-chevron" aria-hidden="true" />
      </button>
      <div id={subId} className="actor-sub" data-open={open ? "true" : "false"}>
        <div>
          {[undefined, ...pages].map((key) => (
            <SubNavLink key={key ?? "info"} slug={actor.slug} page={key} active={selected && page === key} open={open} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** One sub nav entry: the Info page when `page` is absent. Out of the tab
 *  order while its sub nav is shut. */
function SubNavLink({ slug, page, active, open }: { slug: string; page?: ActorPageKey; active: boolean; open: boolean }) {
  return (
    <Link
      to={actorPageHref(slug, page)}
      data-active={active ? "true" : undefined}
      className="actor-list-item actor-sub-item w-full text-left pl-7 pr-3 py-1 text-sm flex items-center"
      style={{ color: "var(--tan-2)" }}
      tabIndex={open ? undefined : -1}
    >
      {page ? actorPageDef(page).label : "Info"}
    </Link>
  );
}
