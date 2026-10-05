// Shared page for the two role-responsibility reports (Operational Facilitator,
// Operational GovOps). The reports are ~90% identical — chain resolution, pill
// filters, header search, CSV export — the real variance (data shapes,
// matches() semantics, which categories exist) lives in the RoleReportConfig
// each wrapper (OpFacilitatorsReport.tsx / OpGovOpsReport.tsx) builds. Filter
// state + derived rows live in useRoleReportState; page chrome is ReportShell;
// the pills, CSV button and category tables are their own components
// (RoleReportControls, RoleReportCsvButton, RoleCategoryTables). This file is
// render-only.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ReportMode } from "@/lib/reportFilter";
import { ReportShell } from "./ReportShell";
import type { RoleRow } from "./RoleCategoryTable";
import { RoleCategoryTables } from "./RoleCategoryTables";
import { RoleReportControls } from "./RoleReportControls";
import { RoleReportCsvButton } from "./RoleReportCsvButton";
import type { RoleReportConfig } from "./roleReportTypes";
import { useRoleReportState } from "./useRoleReportState";

export type { RoleReportConfig } from "./roleReportTypes";

/** The intro sentence, ending in a link to the doc that mandates the role. */
function RoleReportIntro<R extends RoleRow>({ config, introDocNo }: { config: RoleReportConfig<R>; introDocNo?: string }) {
  return (
    <>
      {config.introText}{" "}
      <AtlasLink to={atlasHref(config.introDocUuid)} className="text-accent hover:underline">
        {introDocNo ? `${introDocNo} ` : ""}
        {config.introLinkSuffix} ↗
      </AtlasLink>
    </>
  );
}

export function RoleResponsibilityReport<R extends RoleRow>({
  query,
  mode,
  config,
}: {
  query: string;
  mode: ReportMode;
  config: RoleReportConfig<R>;
}) {
  const state = useRoleReportState(config, query, mode);
  const { cat, responsibilities, filtered, filterName, introDocNo } = state;

  return (
    <ReportShell
      report={config.reportId}
      description={<RoleReportIntro config={config} introDocNo={introDocNo} />}
      controls={<RoleReportControls config={config} state={state} />}
      query={query}
      filters={[filterName, cat && config.categoryLabels[cat]]}
      searches={config.searches}
      count={`${filtered.length} responsibilities`}
      actions={<RoleReportCsvButton config={config} state={state} query={query} />}
      ready={responsibilities.length > 0}
      viewProps={{ row_count: responsibilities.length }}
      noRows={responsibilities.length > 0 && filtered.length === 0}
    >
      <RoleCategoryTables config={config} state={state} />
    </ReportShell>
  );
}
