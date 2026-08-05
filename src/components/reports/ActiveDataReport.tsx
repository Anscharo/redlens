import { useState, useMemo, useEffect } from "react";
import { AtlasLink } from "../AtlasLink";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { atlasHref } from "../../lib/routes";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import { loadHistoryBatch } from "../../lib/history";
import { track } from "../../lib/analytics";
import { useLoaded } from "../../hooks/useAtlasData";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  buildActiveDataRows,
  activeDataRowsToCSV,
  adSearchFields,
  type ActiveDataRow,
  type EvidenceStep,
} from "../../lib/activeDataIndex";
import { filterRows, hiddenMatches, parseReportQuery, type ReportMode } from "../../lib/reportFilter";
import { NoRowsMatch } from "./NoRowsMatch";
import { FilterSummary } from "./FilterSummary";
import { Highlight, MatchAside } from "./Highlight";
import { DownloadCsvButton } from "./DownloadCsvButton";

const agentCodec = urlString(null);
const entityCodec = urlString(null);

type Row = ActiveDataRow;

// adSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_active_data MCP tool filters rows with the same field logic.
const SEARCHES =
  "title · doc nos · controller · prime agent · process · responsible party (incl. declared text) · facilitator (incl. role) · agent chain (executor/facilitator/govops)";
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
            <AtlasLink
              to={atlasHref(s.docId)}
              title={s.label}
              className="mono text-[10px] text-accent hover:underline"
            >
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

function EvidenceCell({ r }: { r: Row }) {
  const rpSteps = r.responsibleParty?.evidence ?? [];
  const facSteps = r.facilitator?.evidence ?? [];
  if (!rpSteps.length && !facSteps.length) {
    return <span className="mono text-[10px] text-tan-3">—</span>;
  }
  return (
    <div>
      <EvidenceChain title="RP" steps={rpSteps} />
      <EvidenceChain title="Fac" steps={facSteps} />
    </div>
  );
}

export function ActiveDataReport({ query, mode }: { query: string; mode: ReportMode }) {
  useDocumentTitle("Active Data Index: Sky Atlas by Redline");
  const docs = useLoaded(loadDocs);
  const graph = useLoaded(loadGraph);
  const rows = useMemo(
    () => (docs && graph ? buildActiveDataRows(docs, graph) : []),
    [docs, graph],
  );
  const [agentFilter, setAgentFilter] = useUrlState("agent", agentCodec);
  const [entityFilter, setEntityFilter] = useUrlState("entity", entityCodec);
  const [lastEditDates, setLastEditDates] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    loadHistoryBatch(rows.map((r) => r.activeDataId)).then((byDoc) => {
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const r of rows) {
        const entries = byDoc.get(r.activeDataId);
        if (entries?.length) m.set(r.activeDataId, entries[entries.length - 1].date);
      }
      setLastEditDates(m);
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Agents are derived from the rows themselves (graph-resolved in buildActiveDataRows).
  // Order by the first appearance of each agent — rows are pre-sorted by doc_no, which
  // keeps prime agents in their natural atlas order.
  const agents = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = ["Governance"];
    for (const r of rows) {
      const name = r.agent;
      if (name && !seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
    return ordered.filter((a) => (a === "Governance" ? rows.some((r) => r.agent === null) : true));
  }, [rows]);

  // Unique names for the Entity filter: responsible parties + facilitators.
  // (Descriptive declarations like "entity to which the registration
  // pertains" never reach here — the graph extractor excludes them, and the
  // row shows them via declaredRP instead of a ResponsibleParty entity.)
  const entityNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((r) => {
      if (r.responsibleParty?.name) names.add(r.responsibleParty.name);
      if (r.facilitator?.name) names.add(r.facilitator.name);
    });
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (agentFilter === "Governance" && r.agent !== null) return false;
        if (agentFilter && agentFilter !== "Governance" && r.agent !== agentFilter) return false;
        if (entityFilter) {
          const match =
            r.responsibleParty?.name === entityFilter || r.facilitator?.name === entityFilter;
          if (!match) return false;
        }
        return true;
      }),
    [rows, agentFilter, entityFilter],
  );
  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);
  const shown = useMemo(() => filterRows(filtered, rq, adSearchFields), [filtered, rq]);

  return (
    <div className="px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Active Data Index
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          All Active Data sections with full responsibility chain — sourced from the Atlas graph.{" "}
          <AtlasLink
            to={atlasHref("75e8fd51-a540-4c3a-aaa9-1a38502f89b2")}
            className="text-accent hover:underline"
          >
            A.1.12 ↗
          </AtlasLink>
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-tan-3">Scope:</span>
          {agents.map((a) => (
            <button
              key={a}
              onClick={() => {
                const active = agentFilter !== a;
                track("report_filter", { report: "active-data", filter_type: "agent", value: active ? a : null, active });
                setAgentFilter(agentFilter === a ? null : a);
              }}
              data-active={agentFilter === a ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded"
            >
              {a}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-tan-3">Entity:</span>
          {entityNames.map((e) => (
            <button
              key={e}
              onClick={() => {
                const active = entityFilter !== e;
                track("report_filter", { report: "active-data", filter_type: "entity", value: active ? e : null, active });
                setEntityFilter(entityFilter === e ? null : e);
              }}
              data-active={entityFilter === e ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded"
            >
              {e}
            </button>
          ))}
        </div>

        <FilterSummary query={query} filters={[agentFilter, entityFilter]} searches={SEARCHES} />

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-tan-3">{shown.length} sections</p>
          <DownloadCsvButton
            report="active-data"
            filename="active-data-index.csv"
            rowCount={shown.length}
            build={() => activeDataRowsToCSV(shown, lastEditDates)}
            fullRowCount={rows.length}
            buildFull={() => activeDataRowsToCSV(rows, lastEditDates)}
            query={query}
            filters={[agentFilter, entityFilter]}
          />
        </div>

        {rows.length > 0 && shown.length === 0 && <NoRowsMatch query={query} />}
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: "1120px" }}>
            <thead>
              <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
                <th className="py-2 px-3 font-normal">AD Doc Title</th>
                <th className="py-2 px-3 font-normal w-40">Controller</th>
                <th className="py-2 px-3 font-normal w-24">Prime</th>
                <th className="py-2 px-3 font-normal w-44">Responsible Party</th>
                <th className="py-2 px-3 font-normal w-44">Facilitator</th>
                <th className="py-2 px-3 font-normal w-64">Evidence</th>
                <th className="py-2 px-3 font-normal w-32">Process</th>
                <th className="py-2 px-3 font-normal w-28">Last Edited</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.activeDataId}
                  className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
                >
                  <td className="py-2 px-3 align-top relative">
                    <MatchAside matches={hiddenMatches(adSearchFields(r), rq)} rq={rq} />
                    <AtlasLink
                      to={atlasHref(r.activeDataId)}
                      className="text-sm text-tan hover:underline text-left block"
                    >
                      <Highlight text={r.activeDataTitle} rq={rq} />
                    </AtlasLink>
                    <span className="mono text-[10px] text-accent"><Highlight text={r.activeDataDocNo} rq={rq} /></span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.controllerId && r.controllerDocNo ? (
                      <AtlasLink
                        to={atlasHref(r.controllerId)}
                        className="mono text-xs text-tan-2 hover:underline text-left"
                      >
                        <Highlight text={r.controllerDocNo} rq={rq} />
                      </AtlasLink>
                    ) : (
                      <span className="mono text-[10px] text-tan-3">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.agent ? <Highlight text={r.agent} rq={rq} flex /> : "—"}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.responsibleParty ? (
                      r.responsibleParty.docId ? (
                        <AtlasLink
                          to={atlasHref(r.responsibleParty.docId)}
                          className="text-xs text-tan-2 hover:text-tan hover:underline text-left"
                          title={r.responsibleParty.declared ?? undefined}
                        >
                          <Highlight text={r.responsibleParty.name} rq={rq} flex />
                        </AtlasLink>
                      ) : (
                        <span
                          className="text-xs text-tan-2"
                          title={r.responsibleParty.declared ?? undefined}
                        >
                          <Highlight text={r.responsibleParty.name} rq={rq} flex />
                        </span>
                      )
                    ) : r.declaredRP ? (
                      <span
                        className="text-xs text-tan-3 italic"
                        title="declared in the ADC — does not resolve to a single entity"
                      >
                        <Highlight text={r.declaredRP} rq={rq} />
                      </span>
                    ) : (
                      <span className="mono text-[10px] text-tan-3">Governance</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.facilitator ? (
                      r.facilitator.docId ? (
                        <AtlasLink
                          to={atlasHref(r.facilitator.docId)}
                          className="text-xs text-tan-2 hover:text-tan hover:underline text-left"
                          title={r.facilitator.role}
                        >
                          <Highlight text={r.facilitator.name} rq={rq} flex />
                        </AtlasLink>
                      ) : (
                        <span className="text-xs text-tan-2" title={r.facilitator.role}>
                          <Highlight text={r.facilitator.name} rq={rq} flex />
                        </span>
                      )
                    ) : (
                      <span className="mono text-[10px] text-tan-3">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <EvidenceCell r={r} />
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3"><Highlight text={r.process} rq={rq} /></span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">
                      {lastEditDates.get(r.activeDataId) ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
