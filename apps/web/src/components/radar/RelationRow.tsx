import { Link } from "../Link";
import type { ActorRelation } from "../../lib/actorIndex";
import { edgeLabel } from "../../lib/entityGraph";
import { actorHref } from "@/lib/routes";

export function RelationRow({ r }: { r: ActorRelation }) {
  const label = edgeLabel(r.edge.e, r.direction);
  const arrow = r.direction === "outbound" ? "→" : "←";
  return (
    <div className="flex items-center gap-2 py-1 border-t border-[var(--border)] text-sm">
      <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        <span className="enlargen">{arrow}</span> {label}
      </span>
      {r.otherSlug ? (
        <Link to={actorHref(r.otherSlug)} className="text-accent hover:underline">
          {r.otherLabel}
        </Link>
      ) : (
        <span style={{ color: "var(--tan-2)" }}>{r.otherLabel}</span>
      )}
    </div>
  );
}
