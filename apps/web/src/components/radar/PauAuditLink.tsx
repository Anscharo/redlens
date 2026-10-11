import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { auditItemCount, loadPauAudit } from "../../lib/pauAudit";
import { reportHref } from "@/lib/routes";

/** "N PAU values needing audit", linking to the audit report filtered to this Prime; nothing until it loads, or when none do. */
export function PauAuditLink({ primeId, primeName }: { primeId: string; primeName: string }) {
  const rows = useLoaded(loadPauAudit, { soft: true });
  const n = rows ? auditItemCount(rows.filter((r) => r.primeId === primeId)) : 0;
  if (n === 0) return null;
  return (
    <Link to={`${reportHref("pau-audit")}?prime=${encodeURIComponent(primeName)}`} className="text-accent hover:underline" data-pau-audit={n}>
      {n} PAU value{n === 1 ? "" : "s"} needing audit
    </Link>
  );
}
