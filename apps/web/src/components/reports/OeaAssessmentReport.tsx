import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { OeaAssessmentControls, OeaSummaryStrip } from "./OeaAssessmentControls";
import { OeaAssessmentCsvButton } from "./OeaAssessmentCsvButton";
import { OeaCategoryTables } from "./OeaCategoryTables";
import { ReportShell } from "./ReportShell";
import { useOeaAssessmentState } from "./useOeaAssessmentState";

const REPORT: ReportId = "oea-assessment";
// A.1.14.4.6.1.1 Executor Agent GovOps — the doc_no shown next to the link is
// resolved from the report's own rows (the doc is one of the assessed tasks),
// never hardcoded: doc_nos move on every atlas renumber.
const INTRO_DOC_UUID = "76405733-3740-4c62-836f-c0683840a9a2";

// Header-box text filter over the fields declared in OeaAssessmentTable
// (which also tracks their visibility for the hidden-match aside).
// Category/rating/status facets are pill-owned and excluded; the text
// filter ANDs with the pills.
const SEARCHES = "doc no · title · assessed task text · covered prime agents";

function OeaIntro({ docNo }: { docNo: string | undefined }) {
  return (
    <>
      Every task the Operational Executor Agent performs — via its GovOps and Facilitator actors or
      directly — rated for how precisely it is defined and whether it carries incentives or penalties.{" "}
      <AtlasLink to={atlasHref(INTRO_DOC_UUID)} className="text-accent hover:underline">
        {docNo ? `${docNo} ` : ""}Executor Agent GovOps ↗
      </AtlasLink>
    </>
  );
}

export function OeaAssessmentReport({ query, mode }: { query: string; mode: ReportMode }) {
  const { report, rows, shown, filters, ...s } = useOeaAssessmentState(REPORT, INTRO_DOC_UUID, query, mode);
  return (
    <ReportShell
      report={REPORT}
      description={<OeaIntro docNo={s.introDocNo} />}
      note={
        <>
          ✳ assessed by {report?.model ?? "—"} · human-reviewed · rubric {report?.rubricVersion ?? "—"}
        </>
      }
      noteTitle="Ratings are LLM-drafted against the assessment rubric, then human-reviewed. Click a row for the reasoning."
      controls={<OeaAssessmentControls {...s.pills} />}
      query={query}
      filters={filters.labels}
      searches={SEARCHES}
      count={rows.length > 0 ? <OeaSummaryStrip rows={shown} /> : undefined}
      actions={
        rows.length > 0 ? (
          <OeaAssessmentCsvButton report={REPORT} rows={rows} shown={shown} query={query} filters={filters.csv} />
        ) : undefined
      }
      ready={!!report}
      viewProps={s.viewProps}
      noRows={rows.length > 0 && shown.length === 0}
    >
      {report && <OeaCategoryTables {...s.table} mechanisms={report.mechanisms} />}
    </ReportShell>
  );
}
