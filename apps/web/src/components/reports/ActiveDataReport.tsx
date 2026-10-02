import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { ReportShell } from "./ReportShell";
import { ActiveDataTable } from "./ActiveDataTable";
import { ActiveDataControls, ActiveDataCsvButton } from "./ActiveDataControls";
import { useActiveDataState } from "./useActiveDataState";

const REPORT: ReportId = "active-data";
// A.1.13 Updating Active Data — the doc_no is resolved from the atlas at
// render (it moves whenever the atlas is renumbered); only the UUID is fixed.
const INTRO_DOC_UUID = "75e8fd51-a540-4c3a-aaa9-1a38502f89b2";

// adSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_active_data MCP tool filters rows with the same field logic.
const SEARCHES =
  "title · doc nos · controller · prime agent · process · responsible party (incl. declared text) · facilitator (incl. role) · agent chain (executor/facilitator/govops)";

function ActiveDataIntro({ docNo }: { docNo: string | undefined }) {
  return (
    <>
      All Active Data sections with full responsibility chain — sourced from the Atlas graph.{" "}
      <AtlasLink to={atlasHref(INTRO_DOC_UUID)} className="text-accent hover:underline">
        {docNo ? `${docNo} ` : ""}Updating Active Data ↗
      </AtlasLink>
    </>
  );
}

export function ActiveDataReport({ query, mode }: { query: string; mode: ReportMode }) {
  const s = useActiveDataState(REPORT, INTRO_DOC_UUID, query, mode);
  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-7xl"
      description={<ActiveDataIntro docNo={s.introDocNo} />}
      controls={<ActiveDataControls {...s.pills} />}
      query={query}
      filters={s.filters}
      searches={SEARCHES}
      count={`${s.shown.length} sections`}
      actions={
        <ActiveDataCsvButton
          report={REPORT}
          rows={s.rows}
          shown={s.shown}
          lastEditDates={s.lastEditDates}
          query={query}
          filters={s.filters}
        />
      }
      ready={s.rows.length > 0}
      viewProps={{ row_count: s.rows.length }}
      noRows={s.rows.length > 0 && s.shown.length === 0}
    >
      <ActiveDataTable rows={s.shown} rq={s.rq} lastEditDates={s.lastEditDates} />
    </ReportShell>
  );
}
