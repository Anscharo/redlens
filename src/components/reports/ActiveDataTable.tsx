// Table body for the Active Data Index — split out of ActiveDataReport.tsx so
// the page file is data + filters + <ReportShell> only.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { adSearchFields, type ActiveDataRow } from "@/lib/activeDataIndex";
import { hiddenMatches, type ReportQuery } from "@/lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import { EvidenceCell, LinkedName } from "./ActiveDataCells";

const HEADERS: [label: string, width: string][] = [
  ["AD Doc Title", ""],
  ["Controller", "w-40"],
  ["Prime", "w-24"],
  ["Responsible Party", "w-44"],
  ["Facilitator", "w-44"],
  ["Evidence", "w-64"],
  ["Process", "w-32"],
  ["Last Edited", "w-28"],
];

const Dash = () => <span className="mono text-[10px] text-tan-3">—</span>;

function Row({ r, rq, lastEdit }: { r: ActiveDataRow; rq: ReportQuery; lastEdit?: string }) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top relative">
        <MatchAside matches={hiddenMatches(adSearchFields(r), rq)} rq={rq} />
        <AtlasLink to={atlasHref(r.activeDataId)} className="text-sm text-tan hover:underline text-left block">
          <Highlight text={r.activeDataTitle} rq={rq} />
        </AtlasLink>
        <span className="mono text-[10px] text-accent">
          <Highlight text={r.activeDataDocNo} rq={rq} />
        </span>
      </td>
      <td className="py-2 px-3 align-top">
        {r.controllerId && r.controllerDocNo ? (
          <AtlasLink to={atlasHref(r.controllerId)} className="mono text-xs text-tan-2 hover:underline text-left">
            <Highlight text={r.controllerDocNo} rq={rq} />
          </AtlasLink>
        ) : (
          <Dash />
        )}
      </td>
      <td className="py-2 px-3 align-top">
        <span className="mono text-xs text-tan-3">{r.agent ? <Highlight text={r.agent} rq={rq} flex /> : "—"}</span>
      </td>
      <td className="py-2 px-3 align-top">
        {r.responsibleParty ? (
          <LinkedName
            name={r.responsibleParty.name}
            docId={r.responsibleParty.docId}
            title={r.responsibleParty.declared ?? undefined}
            rq={rq}
          />
        ) : r.declaredRP ? (
          <span className="text-xs text-tan-3 italic" title="declared in the ADC — does not resolve to a single entity">
            <Highlight text={r.declaredRP} rq={rq} />
          </span>
        ) : (
          <span className="mono text-[10px] text-tan-3">Governance</span>
        )}
      </td>
      <td className="py-2 px-3 align-top">
        {r.facilitator ? (
          <LinkedName name={r.facilitator.name} docId={r.facilitator.docId} title={r.facilitator.role} rq={rq} />
        ) : (
          <Dash />
        )}
      </td>
      <td className="py-2 px-3 align-top">
        <EvidenceCell r={r} />
      </td>
      <td className="py-2 px-3 align-top">
        <span className="mono text-xs text-tan-3">
          <Highlight text={r.process} rq={rq} />
        </span>
      </td>
      <td className="py-2 px-3 align-top">
        <span className="mono text-xs text-tan-3">{lastEdit ?? "—"}</span>
      </td>
    </tr>
  );
}

export function ActiveDataTable({
  rows,
  rq,
  lastEditDates,
}: {
  rows: readonly ActiveDataRow[];
  rq: ReportQuery;
  lastEditDates: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ minWidth: "1120px" }}>
        <thead>
          <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
            {HEADERS.map(([label, w]) => (
              <th key={label} className={`py-2 px-3 font-normal ${w}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.activeDataId} r={r} rq={rq} lastEdit={lastEditDates.get(r.activeDataId)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
