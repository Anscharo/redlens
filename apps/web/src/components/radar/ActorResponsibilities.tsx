import { Link } from "../Link";
import { AtlasLink } from "../AtlasLink";
import type { ActiveDataRow } from "@/lib/activeDataIndex";
import { ROUTES, atlasHref } from "@/lib/routes";

/** The dashboard is a summary: a long Active Data table is the report's
 *  job, and the link below already goes there. */
export const RESPONSIBILITIES_PREVIEW = 20;

interface Props {
  rows: ActiveDataRow[];
}

function Row({ r }: { r: ActiveDataRow }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top">
        <AtlasLink
          to={atlasHref(r.activeDataId)}
          className="text-sm text-tan hover:underline text-left"
        >
          {r.activeDataTitle}
        </AtlasLink>
        <div className="mono text-[10px] text-tan-3 mt-0.5">{r.activeDataDocNo}</div>
      </td>
      <td className="py-2 px-3 align-top mono text-xs">
        {r.controllerId ? (
          <AtlasLink to={atlasHref(r.controllerId)} className="text-accent hover:underline">
            {r.controllerDocNo}
          </AtlasLink>
        ) : (
          <span className="text-tan-3">—</span>
        )}
      </td>
      <td className="py-2 px-3 align-top text-xs text-tan-2">
        {r.responsibleParty?.name ?? <span className="text-tan-3 italic">none</span>}
      </td>
      <td className="py-2 px-3 align-top text-xs text-tan-2">
        {r.facilitator?.name ?? <span className="text-tan-3">—</span>}
      </td>
      <td className="py-2 px-3 align-top mono text-[10px] text-tan-3">
        {r.process === "Alignment Conserver Changes" ? "AC" : "Direct"}
      </td>
    </tr>
  );
}

export function ActorResponsibilities({ rows }: Props) {
  const shown = rows.slice(0, RESPONSIBILITIES_PREVIEW);
  const hidden = rows.length - shown.length;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ minWidth: 640 }}>
          <thead>
            <tr className="mono text-[10px] text-tan-3 border-b border-[var(--border)]">
              <th className="py-1.5 px-3 font-normal">Active Data</th>
              <th className="py-1.5 px-3 font-normal">Controller</th>
              <th className="py-1.5 px-3 font-normal">Responsible Party</th>
              <th className="py-1.5 px-3 font-normal">Facilitator</th>
              <th className="py-1.5 px-3 font-normal">Process</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Row key={r.activeDataId} r={r} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <Link
          to={ROUTES.REPORTS_ACTIVE_DATA}
          className="mono text-[11px] text-accent hover:underline"
        >
          {hidden > 0 ? `${hidden} more in the Active Data Report` : "View all in Active Data Report"}{" "}
          <span className="enlargen">→</span>
        </Link>
      </div>
    </div>
  );
}
