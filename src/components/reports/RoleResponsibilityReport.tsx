// Shared page for the two role-responsibility reports (Operational Facilitator,
// Operational GovOps). The reports are ~90% identical — chain resolution, pill
// filters, header search, CSV export — the real variance (data shapes,
// matches() semantics, which categories exist) lives in the RoleReportConfig
// each wrapper (OpFacilitatorsReport.tsx / OpGovOpsReport.tsx) builds. Filter
// state + derived rows live in useRoleReportState; page chrome is ReportShell;
// this file is render-only.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { expandedRowCount } from "../../lib/dutyCollapse";
import { FilterPills, PrimePills } from "./FilterPills";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";
import type { ReportMode } from "../../lib/reportFilter";
import { ReportShell } from "./ReportShell";
import type { RoleRow } from "./RoleCategoryTable";
import type { RoleReportConfig } from "./roleReportTypes";
import { useRoleReportState } from "./useRoleReportState";

export type { RoleReportConfig } from "./roleReportTypes";

export function RoleResponsibilityReport<R extends RoleRow>({
  query,
  mode,
  config,
}: {
  query: string;
  mode: ReportMode;
  config: RoleReportConfig<R>;
}) {
  const {
    filter,
    cat,
    chains,
    responsibilities,
    toggle,
    toggleCat,
    rq,
    filtered,
    filterName,
    presentCats,
    byCategory,
    introDocNo,
    pills,
    allAgents,
  } = useRoleReportState(config, query, mode);
  const CategoryTable = config.CategoryTable;

  return (
    <ReportShell
      report={config.reportId}
      title={config.heading}
      description={
        <>
          {config.introText}{" "}
          <AtlasLink to={atlasHref(config.introDocUuid)} className="text-accent hover:underline">
            {introDocNo ? `${introDocNo} ` : ""}
            {config.introLinkSuffix} ↗
          </AtlasLink>
        </>
      }
      controls={
        <div className="flex flex-wrap gap-4 mb-6">
          <FilterPills label={config.pillLabel} items={pills.holders} kind={config.pillKind} filter={filter} onToggle={toggle} />
          <FilterPills label="Executor" items={pills.executors} kind="executor" filter={filter} onToggle={toggle} />
          <PrimePills agents={allAgents} filter={filter} onToggle={toggle} />
          <CategoryPills categories={presentCats} active={cat} onToggle={toggleCat} />
        </div>
      }
      query={query}
      filters={[filterName, cat && config.categoryLabels[cat]]}
      searches={config.searches}
      count={`${filtered.length} responsibilities`}
      actions={
        <DownloadCsvButton
          report={config.reportId}
          filename={config.filename}
          rowCount={expandedRowCount(filtered)}
          build={() => config.rowsToCSV(filtered)}
          fullRowCount={expandedRowCount(responsibilities)}
          buildFull={() => config.rowsToCSV(responsibilities)}
          query={query}
          filters={[filterName, cat]}
        />
      }
      ready={responsibilities.length > 0}
      viewProps={{ row_count: responsibilities.length }}
      noRows={responsibilities.length > 0 && filtered.length === 0}
    >
      {(Object.entries(config.categoryLabels) as [R["category"], string][]).map(([c, label]) => {
        const rows = byCategory[c];
        if (!rows?.length) return null;
        return <CategoryTable key={c} cat={c} label={label} rows={rows} chains={chains} rq={rq} />;
      })}
    </ReportShell>
  );
}
