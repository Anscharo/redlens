import { Link } from "../Link";
import { actorHref } from "@/lib/routes";
import type { SidebarGroup } from "../../lib/actorIndex";

interface Props {
  groups: SidebarGroup[];
  selectedSlug: string | null;
}

const SUBTYPE_BADGE: Record<string, string> = {
  prime: "Prime",
  operational_executor: "Exec",
  core_executor: "Core Exec",
};

export function ActorList({ groups, selectedSlug }: Props) {
  return (
    <nav
      className="h-full overflow-y-auto py-4 border-r border-[var(--border)]"
      style={{ minWidth: 200, maxWidth: 220 }}
    >
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <div
            className="px-3 pb-1 mono text-[10px] uppercase tracking-wider"
            style={{ color: "var(--tan-3)" }}
          >
            {g.label}
          </div>
          {g.actors.map((a) => (
            <Link
              key={a.id}
              to={actorHref(a.slug)}
              data-active={a.slug === selectedSlug ? "true" : undefined}
              className="actor-list-item w-full text-left px-3 py-1.5 text-sm flex items-center gap-2"
              style={{ color: "var(--tan-2)" }}
            >
              <span className="flex-1 truncate">{a.name}</span>
              {a.st && SUBTYPE_BADGE[a.st] && (
                <span className="mono text-[9px] shrink-0" style={{ color: "var(--tan-3)" }}>
                  {SUBTYPE_BADGE[a.st]}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
