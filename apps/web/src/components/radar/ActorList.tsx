import { useEffect, useState } from "react";
import { Link } from "../Link";
import { ROUTES, actorHref } from "@/lib/routes";
import type { ActorPageKey } from "@/lib/radarPages";
import type { SidebarGroup } from "../../lib/actorIndex";
import { ActorSubNav } from "./ActorSubNav";

export interface ActorListProps {
  groups: SidebarGroup[];
  selectedSlug: string | null;
  /** Which subpage of the selected actor is open; absent on its Info page. */
  page?: ActorPageKey;
  /** The subpages each actor offers, by slug. An actor listed here gets a
   *  sub nav (Info, then these) instead of a plain link. */
  subpages?: ReadonlyMap<string, readonly ActorPageKey[]>;
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
 *  subpages is a disclosure whose sub nav goes to its Info page and each
 *  subpage. Only selecting an actor opens one on its own, and an open one
 *  stays open until the reader shuts it, so moving between pages never
 *  shifts the list. */
export function ActorList({ groups, selectedSlug, page, subpages }: ActorListProps) {
  // Each actor's open state. Selecting an actor opens it and it stays open
  // until the reader shuts it; nothing else opens or shuts on its own.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (selectedSlug) setManual((m) => ({ ...m, [selectedSlug]: true }));
  }, [selectedSlug]);
  const isOpen = (slug: string) => manual[slug] ?? slug === selectedSlug;

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
          {g.actors.map((a) => {
            const pages = subpages?.get(a.slug);
            return pages ? (
              <ActorSubNav
                key={a.id}
                actor={a}
                pages={pages}
                open={isOpen(a.slug)}
                onToggle={() => setManual((m) => ({ ...m, [a.slug]: !isOpen(a.slug) }))}
                selected={a.slug === selectedSlug}
                page={page}
                badge={<Badge st={a.st} />}
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
            );
          })}
        </div>
      ))}
    </nav>
  );
}
