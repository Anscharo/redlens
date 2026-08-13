// Cell renderers for the Active Data Index table. Split from ActiveDataTable
// so both files stay small: evidence chains (the RP/Facilitator provenance
// trail as doc_no breadcrumbs) and the shared entity-name cell.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import type { ActiveDataRow, EvidenceStep } from "../../lib/activeDataIndex";
import type { ReportQuery } from "../../lib/reportFilter";
import { Highlight } from "./Highlight";

function EvidenceChain({ title, steps }: { title: string; steps: EvidenceStep[] }) {
  if (!steps.length) return null;
  return (
    <div className="mb-1 last:mb-0">
      <span className="mono text-[10px] text-tan-3">{title}: </span>
      {steps.map((s, i) => (
        <span key={i}>
          {/* the arrow's own span sizes off the 10px caption, not the row */}
          {i > 0 && (
            <span className="text-tan-3 text-[10px]">
              {" "}
              <span className="enlargen">→</span>{" "}
            </span>
          )}
          {s.docId ? (
            <AtlasLink to={atlasHref(s.docId)} title={s.label} className="mono text-[10px] text-accent hover:underline">
              {s.docNo}
            </AtlasLink>
          ) : (
            <span className="mono text-[10px] text-tan-3" title={s.label}>
              {s.docNo}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function EvidenceCell({ r }: { r: ActiveDataRow }) {
  const rpSteps = r.responsibleParty?.evidence ?? [];
  const facSteps = r.facilitator?.evidence ?? [];
  if (!rpSteps.length && !facSteps.length) return <span className="mono text-[10px] text-tan-3">—</span>;
  return (
    <div>
      <EvidenceChain title="RP" steps={rpSteps} />
      <EvidenceChain title="Fac" steps={facSteps} />
    </div>
  );
}

/** An entity name, linked to its doc when the graph resolved one. */
export function LinkedName({
  name,
  docId,
  title,
  rq,
}: {
  name: string;
  docId?: string | null;
  title?: string;
  rq: ReportQuery;
}) {
  const inner = <Highlight text={name} rq={rq} flex />;
  return docId ? (
    <AtlasLink
      to={atlasHref(docId)}
      className="text-xs text-tan-2 hover:text-tan hover:underline text-left"
      title={title}
    >
      {inner}
    </AtlasLink>
  ) : (
    <span className="text-xs text-tan-2" title={title}>
      {inner}
    </span>
  );
}
