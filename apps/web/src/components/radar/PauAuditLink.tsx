import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { auditItemCount, loadPauAuditItems } from "../../lib/pauAudit";
import { reportHref } from "@/lib/routes";

/** "N values to review", linking to the audit report filtered to this Prime; nothing until it loads, or when none do. */
export function PauAuditLink({ primeId, primeName }: { primeId: string; primeName: string }) {
  const rows = useLoaded(loadPauAuditItems, { soft: true });
  const n = rows ? auditItemCount(rows.filter((r) => r.primeId === primeId)) : 0;
  if (n === 0) return null;
  return (
    <Link to={`${reportHref("pau-audit")}?prime=${encodeURIComponent(primeName)}`} className="text-accent hover:underline" data-pau-audit={n}>
      {n} value{n === 1 ? "" : "s"} to review
    </Link>
  );
}
