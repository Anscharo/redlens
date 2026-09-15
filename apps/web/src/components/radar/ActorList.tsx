import { useEffect, useState } from "react";
import { Link } from "../Link";
import { ROUTES, actorHref, settlementsHref } from "@/lib/routes";
import type { SidebarActor, SidebarGroup } from "../../lib/actorIndex";

interface Props {
  groups: SidebarGroup[];
  selectedSlug: string | null;
  /** Which page of the selected actor is open. */
  page?: "settlements";
  /** Actors with published Monthly Settlement Cycle workbooks — the ones
   *  that get a sub nav (Info / Settlements) instead of a plain link. */
  settledSlugs?: ReadonlySet<string>;
}

const SUBTYPE_BADGE: Record<string, string> = {
  prime: "Prime",
  operational_executor: "Exec",
  core_executor: "Core Exec",
};

function Badge({ st }: { st: string | null }) {
  const label = st && SUBTYPE_BADGE[st];
  if (!label) return null;
  return (
    <span className="mono text-[9px] shrink-0" style={{ color: "var(--tan-3)" }}>
      {label}
    </span>
  );
}

/** The radar's left nav: Overview, then every actor by group. An actor with
 *  settlement workbooks is a disclosure whose sub nav goes to its Info page
 *  and its Settlements page; the selected actor's opens on its own, and on
 *  a settlements page every one is open, so the reader can step straight
 *  from one Prime's settlement chart to another's. */
export function ActorList({ groups, selectedSlug, page, settledSlugs }: Props) {
  // Manual toggles on top of the page-derived default; cleared whenever the
  // page changes so the default reasserts itself.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => setManual({}), [selectedSlug, page]);
  const isOpen = (slug: string) => manual[slug] ?? (page === "settlements" || slug === selectedSlug);

  return (
    <nav
      className="h-full overflow-y-auto py-4 border-r border-[var(--border)]"
      style={{ minWidth: 200, maxWidth: 220 }}
    >
      <div className="mb-4">
        <Link
          to={ROUTES.RADAR}
          data-active={selectedSlug === null ? "true" : undefined}
          className="actor-list-item w-full text-left px-3 py-1.5 text-sm flex items-center gap-2"
          style={{ color: "var(--tan-2)" }}
        >
          <span className="flex-1 truncate">Overview</span>
        </Link>
      </div>
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <div
            className="px-3 pb-1 mono text-[10px] uppercase tracking-wider"
            style={{ color: "var(--tan-3)" }}
          >
            {g.label}
          </div>
          {g.actors.map((a) =>
            settledSlugs?.has(a.slug) ? (
              <ActorDisclosure
                key={a.id}
                actor={a}
                open={isOpen(a.slug)}
                onToggle={() => setManual((m) => ({ ...m, [a.slug]: !isOpen(a.slug) }))}
                selected={a.slug === selectedSlug}
                page={page}
              />
            ) : (
              <Link
                key={a.id}
                to={actorHref(a.slug)}
                data-active={a.slug === selectedSlug ? "true" : undefined}
                className="actor-list-item w-full text-left px-3 py-1.5 text-sm flex items-center gap-2"
                style={{ color: "var(--tan-2)" }}
              >
                <span className="flex-1 truncate">{a.name}</span>
                <Badge st={a.st} />
              </Link>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}

/** One actor with a sub nav. The row is a disclosure button (it never
 *  navigates); the sub nav's two links do. The sub nav animates open and
 *  shut with a grid-rows transition (index.css, .actor-sub). */
function ActorDisclosure({
  actor,
  open,
  onToggle,
  selected,
  page,
}: {
  actor: SidebarActor;
  open: boolean;
  onToggle: () => void;
  selected: boolean;
  page?: "settlements";
}) {
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
        <Badge st={actor.st} />
        <span className="actor-chevron" aria-hidden="true" />
      </button>
      <div id={subId} className="actor-sub" data-open={open ? "true" : "false"}>
        <div>
          <Link
            to={actorHref(actor.slug)}
            data-active={selected && page !== "settlements" ? "true" : undefined}
            className="actor-list-item actor-sub-item w-full text-left pl-7 pr-3 py-1 text-sm flex items-center"
            style={{ color: "var(--tan-2)" }}
            tabIndex={open ? undefined : -1}
          >
            Info
          </Link>
          <Link
            to={settlementsHref(actor.slug)}
            data-active={selected && page === "settlements" ? "true" : undefined}
            className="actor-list-item actor-sub-item w-full text-left pl-7 pr-3 py-1 text-sm flex items-center"
            style={{ color: "var(--tan-2)" }}
            tabIndex={open ? undefined : -1}
          >
            Settlements
          </Link>
        </div>
      </div>
    </div>
  );
}
