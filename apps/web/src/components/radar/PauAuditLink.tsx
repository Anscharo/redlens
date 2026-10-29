import { Link } from "../Link";
import { useLoaded } from "../../hooks/useAtlasData";
import { auditItemCount, loadPauAuditItems, type AuditRow } from "../../lib/pauAudit";
import { reportHref } from "@/lib/routes";

interface Props {
  primeId: string;
  primeName: string;
  /** The deployment the count is for; a row the audit gives no kind (a value the chain has never set) counts on every deployment of its chain. */
  chain: string;
  kind: string;
}

const onDeployment = (r: AuditRow, { primeId, chain, kind }: Props) => r.primeId === primeId && r.chain === chain && (r.kind === null || r.kind === kind);

/** "N values to review" for one deployment, as a line linking to the audit report filtered to its Prime; nothing until it loads, or when none do. */
export function PauAuditLink(props: Props) {
  const rows = useLoaded(loadPauAuditItems, { soft: true });
  const n = rows ? auditItemCount(rows.filter((r) => onDeployment(r, props))) : 0;
  if (n === 0) return null;
  return (
    <p className="text-[12px] mb-1">
      <Link to={`${reportHref("pau-audit")}?prime=${encodeURIComponent(props.primeName)}`} className="text-accent hover:underline" data-pau-audit={n}>
        {n} value{n === 1 ? "" : "s"} to review
      </Link>
    </p>
  );
}
