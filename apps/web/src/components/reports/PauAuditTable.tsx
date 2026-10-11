// The PAU Values Needing Audit report's body: one section per group, each a
// table of its rows with the atlas document that states the value.
import { AtlasLink } from "../AtlasLink";
import { Address } from "../Address";
import { atlasHref } from "@/lib/routes";
import type { ReportQuery } from "@/lib/reportFilter";
import { AUDIT_GROUPS, auditItemCount, type AuditRow } from "../../lib/pauAudit";
import { Highlight } from "./Highlight";

const dim = { color: "var(--tan-3)" };
const chainLabel = (r: AuditRow) => [r.chain.charAt(0).toUpperCase() + r.chain.slice(1), r.kind].filter(Boolean).join(" · ");
const dates = (r: AuditRow) => [r.chainSetAt && `chain set ${r.chainSetAt}`, r.atlasChangedAt && `atlas changed ${r.atlasChangedAt}`].filter(Boolean).join(" · ");

function AuditRowView({ r, rq, docNo }: { r: AuditRow; rq: ReportQuery; docNo: string }) {
  return (
    <tr className="border-t border-[var(--border)] text-[12px]" data-reason={r.reason}>
      <td className="py-2 pr-3 align-top">
        <Highlight text={r.prime} rq={rq} flex />
        <div className="mono text-[11px]" style={dim}>{chainLabel(r)}</div>
      </td>
      <td className="py-2 pr-3 align-top">
        <Highlight text={r.subject} rq={rq} />
        <div className="mono text-[11px]" style={dim}><Highlight text={r.label} rq={rq} /></div>
      </td>
      <td className="py-2 pr-3 align-top mono text-[11px] break-words">
        {r.reason === "rejected-claim" ? <Address address={r.stated} chain={r.chain} noBalance /> : <Highlight text={r.stated} rq={rq} />}
      </td>
      <td className="py-2 pr-3 align-top mono text-[11px] break-words"><Highlight text={r.onchain || "—"} rq={rq} /></td>
      <td className="py-2 pr-3 align-top">
        <Highlight text={r.note} rq={rq} />
        {dates(r) && <div className="mono text-[11px]" style={dim}>{dates(r)}</div>}
      </td>
      <td className="py-2 align-top mono text-[11px]">
        {r.docId ? <AtlasLink to={atlasHref(r.docId)} className="text-accent hover:underline"><Highlight text={docNo || "Atlas doc"} rq={rq} /></AtlasLink> : <span style={dim}>no Atlas document</span>}
      </td>
    </tr>
  );
}

const HEADERS = ["Prime", "What", "Atlas states", "Chain holds", "Why", "Atlas document"];

/** Every group with rows, in the report's group order. */
export function PauAuditTable({ rows, rq, docNo }: { rows: readonly AuditRow[]; rq: ReportQuery; docNo: (id: string | null) => string }) {
  return (
    <>
      {AUDIT_GROUPS.map((g) => {
        const mine = rows.filter((r) => r.group === g.key);
        if (mine.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={`pau-audit-${g.key}`} className="mb-8" data-group={g.key}>
            <h2 id={`pau-audit-${g.key}`} className="text-[15px] font-semibold" style={{ color: "var(--tan)" }}>
              {g.label} <span className="mono text-[12px] font-normal" style={dim}>· {auditItemCount(mine)}</span>
            </h2>
            <p className="text-[12px] mb-2" style={dim}>{g.hint}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ minWidth: "960px" }}>
                <thead>
                  <tr className="mono text-[11px] uppercase tracking-wider" style={dim}>
                    {HEADERS.map((h) => <th key={h} className="pb-1 pr-3 font-normal">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => <AuditRowView key={`${r.item}:${r.chain}:${r.kind}:${r.contract}:${r.key}:${r.docId}`} r={r} rq={rq} docNo={docNo(r.docId)} />)}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
