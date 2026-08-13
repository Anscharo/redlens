// Shared category table for the two role-responsibility reports (Facilitator,
// GovOps). The two role tables share every column/row EXCEPT: the role text
// column's header + width + per-category visibility, which categories show a
// Prime chips column, and how a row's role/prime values are read (OF fans out
// over `facilitators`/`agents ?? agent`; OG reads a single `govops` field and
// switches its Prime source by category — see OFCategoryTable/OGCategoryTable
// for the concrete configs). All of that variance is captured in
// RoleCategoryTableConfig so this file stays role-agnostic.
import type { Chain } from "../../lib/reportChains";
import { stripExecutorPrefix } from "../../lib/reportChains";
import { AgentChips, DocCell } from "./OGReportParts";
import { EMPTY_QUERY, hiddenMatches, type ReportQuery, type SearchField } from "../../lib/reportFilter";
import { Highlight, MatchAside } from "./Highlight";
import type { MergedSource } from "../../lib/dutyCollapse";

export interface RoleRow {
  uuid: string;
  docNo: string;
  title: string;
  duty: string;
  category: string;
  agent?: string;
  agents?: string[];
  executor?: string;
  sources?: MergedSource[];
}

export interface RoleCategoryTableConfig<R extends RoleRow> {
  roleColumnHeader: string; // "Facilitator" | "GovOps"
  dutyRoleColWidthClass: string; // Tailwind width class for the duty-layout role header
  showRoleCol: (cat: string) => boolean;
  showPrimeCol: (cat: string) => boolean;
  dutyRoleValue: (r: R) => string; // duty-layout role cell text
  assignmentRoleValue: (r: R) => string; // assignment-layout role cell text
  primeAgents: (r: R, cat: string) => string[]; // duty-layout Prime chip source
  rowKeyRole: (r: R) => string; // React key suffix (mirrors the row's role field)
  searchFields: (r: R) => SearchField[];
}

export function RoleCategoryTable<R extends RoleRow>({
  cat,
  label,
  rows,
  chains,
  rq = EMPTY_QUERY,
  config,
}: {
  cat: string;
  label: string;
  rows: R[];
  chains: Map<string, Chain>;
  rq?: ReportQuery;
  config: RoleCategoryTableConfig<R>;
}) {
  const showRole = config.showRoleCol(cat);
  const showPrime = config.showPrimeCol(cat);
  return (
    <div className="mb-8">
      <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
        {label} <span className="text-tan-3/60">({rows.length})</span>
      </h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs mono text-tan-3">
            <th className="py-1 px-3 font-normal w-44">Doc</th>
            {cat === "assignment" ? (
              <>
                <th className="py-1 px-3 font-normal">Executor Agent</th>
                <th className="py-1 px-3 font-normal w-40">{config.roleColumnHeader}</th>
                <th className="py-1 px-3 font-normal">Prime Agents</th>
              </>
            ) : (
              <>
                <th className="py-1 px-3 font-normal">Section</th>
                <th className="py-1 px-3 font-normal">Duty</th>
                {showRole && (
                  <th className={`py-1 px-3 font-normal ${config.dutyRoleColWidthClass}`}>
                    {config.roleColumnHeader}
                  </th>
                )}
                {showPrime && <th className="py-1 px-3 font-normal w-36">Prime</th>}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${cat}:${r.uuid || r.docNo}:${config.rowKeyRole(r)}`}
              className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
            >
              <td className="py-2 px-3 align-top relative">
                <MatchAside matches={hiddenMatches(config.searchFields(r), rq)} rq={rq} />
                <DocCell r={r} rq={rq} />
              </td>
              {cat === "assignment" ? (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan">
                    {r.executor ? <Highlight text={stripExecutorPrefix(r.executor)} rq={rq} flex /> : "—"}
                  </td>
                  <td className="py-2 px-3 align-top text-sm text-accent">
                    <Highlight text={config.assignmentRoleValue(r)} rq={rq} flex />
                  </td>
                  <td className="py-2 px-3 align-top">
                    <AgentChips agents={r.agents ?? []} chains={chains} rq={rq} />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 align-top text-sm text-tan"><Highlight text={r.title} rq={rq} /></td>
                  <td className="py-2 px-3 align-top text-sm text-tan-2"><Highlight text={r.duty} rq={rq} /></td>
                  {showRole && (
                    <td className="py-2 px-3 align-top text-sm text-accent">
                      <Highlight text={config.dutyRoleValue(r)} rq={rq} flex />
                    </td>
                  )}
                  {showPrime && (
                    <td className="py-2 px-3 align-top">
                      <AgentChips agents={config.primeAgents(r, cat)} chains={chains} rq={rq} />
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
