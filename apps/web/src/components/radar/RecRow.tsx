import { Link } from "../Link";
import type { Recommendation } from "../../lib/actorIndex";
import { actorHref } from "@/lib/routes";

export function RecRow({ rec }: { rec: Recommendation }) {
  return (
    <div className="flex items-start gap-2 py-1 border-t border-[var(--border)] text-sm">
      <span style={{ color: "var(--accent)" }}>▲</span>
      <div>
        <span style={{ color: "var(--tan-2)" }}>{rec.label}</span>
        {rec.reportLink && (
          <Link to={rec.reportLink} className="mono text-[10px] text-accent hover:underline ml-2">
            view report <span className="enlargen">→</span>
          </Link>
        )}
        {rec.entityLink && (
          <Link
            to={actorHref(rec.entityLink)}
            className="mono text-[10px] text-accent hover:underline ml-2"
          >
            view actor <span className="enlargen">→</span>
          </Link>
        )}
        <div className="text-xs mt-0.5" style={{ color: "var(--tan-3)" }}>
          {rec.detail}
        </div>
      </div>
    </div>
  );
}
