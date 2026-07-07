import { useEffect, useRef } from "react";
import { AtlasLink } from "../AtlasLink";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { atlasHref } from "../../lib/routes";
import { track } from "../../lib/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { OEA_CATEGORY_LABELS, type OeaCategory } from "../../lib/oeaTasks";
import type { Rating } from "../../lib/oeaAssessment";
import { loadOeaReport, summarize, type OeaRow, type OeaRowStatus } from "../../lib/oeaReport";
import { CategoryPills, categoryCodec } from "./CategoryPills";
import { OeaTable } from "./OeaAssessmentTable";

const catCodec = categoryCodec(OEA_CATEGORY_LABELS);
const RATING_LABELS: Record<Rating, string> = { weak: "weak", mid: "mid", strong: "strong" };
const STATUS_LABELS: Record<OeaRowStatus, string> = { fresh: "fresh", stale: "stale", unassessed: "unassessed" };
const ratingCodec = categoryCodec(RATING_LABELS);
const statusCodec = categoryCodec(STATUS_LABELS);
const expandedCodec = urlString(null);
const RATINGS = ["weak", "mid", "strong"] as const;
const STATUSES = ["fresh", "stale", "unassessed"] as const;

function SummaryStrip({ rows }: { rows: OeaRow[] }) {
  const s = summarize(rows);
  const fmt = (r: Record<Rating, number>) => `${r.weak} weak · ${r.mid} mid · ${r.strong} strong`;
  return (
    <p className="mono text-xs text-tan-3 mb-4">
      {rows.length} tasks · precision: {fmt(s.precision)} · incentives: {fmt(s.incentives)}
      {s.stale > 0 && ` · ${s.stale} stale`}
      {s.unassessed > 0 && ` · ${s.unassessed} unassessed`}
    </p>
  );
}

export function OeaAssessmentReport() {
  useDocumentTitle("OEA Task Assessment: Sky Atlas by Redline");
  const report = useLoaded(loadOeaReport);
  const [cat, setCat] = useUrlState("cat", catCodec);
  const [precision, setPrecision] = useUrlState("precision", ratingCodec);
  const [incentives, setIncentives] = useUrlState("incentives", ratingCodec);
  const [status, setStatus] = useUrlState("status", statusCodec);
  const [expanded, setExpanded] = useUrlState("expanded", expandedCodec);
  const trackedView = useRef(false);

  const rows = report?.rows ?? [];

  useEffect(() => {
    if (!report || trackedView.current) return;
    trackedView.current = true;
    track("report_view", {
      report: "oea-assessment",
      row_count: report.rows.length,
      stale_count: report.summary.stale,
      unassessed_count: report.summary.unassessed,
      rubric_version: report.rubricVersion,
    });
  }, [report]);

  const toggle = <T extends string>(kind: string, current: T | null, set: (fn: (cur: T | null) => T | null) => void) =>
    (next: T) => {
      track("report_filter", { report: "oea-assessment", filter_kind: kind, slug: next, active: current !== next });
      set((cur) => (cur === next ? null : next));
    };

  const toggleRow = (row: OeaRow) => {
    const action = expanded === row.task.taskKey ? "collapse" : "expand";
    track("report_row_toggle", {
      report: "oea-assessment",
      action,
      task_key: row.task.taskKey,
      node_id: row.task.uuid,
      category: row.task.category,
      status: row.status,
    });
    setExpanded((cur) => (cur === row.task.taskKey ? null : row.task.taskKey));
  };

  const filtered = rows.filter(
    (r) =>
      (cat === null || r.task.category === cat) &&
      (status === null || r.status === status) &&
      (precision === null || r.entry?.precision.rating === precision) &&
      (incentives === null || r.entry?.incentives.rating === incentives),
  );

  const byCategory = Object.groupBy(filtered, (r) => r.task.category) as Record<OeaCategory, OeaRow[]>;

  return (
    <div className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          OEA Task Assessment
        </h1>
        <p className="text-sm text-tan-3 mb-1">
          Every task the Operational Executor Agent performs — via its GovOps and Facilitator
          actors or directly — rated for how precisely it is defined and whether it carries
          incentives or penalties.{" "}
          <AtlasLink to={atlasHref("76405733-e564-4d19-bf90-2fbb0121ba7d")} className="text-accent hover:underline">
            A.1.14.4.6.1.1 ↗
          </AtlasLink>
        </p>
        <p className="mono text-xs text-tan-3 mb-4" title="Ratings are LLM-drafted against the assessment rubric, then human-reviewed. Click a row for the reasoning.">
          ✳ assessed by {report?.model ?? "—"} · human-reviewed · rubric {report?.rubricVersion ?? "—"}
        </p>

        {rows.length > 0 && <SummaryStrip rows={filtered} />}

        <div className="flex flex-wrap gap-4 mb-6">
          <CategoryPills categories={Object.keys(OEA_CATEGORY_LABELS) as OeaCategory[]} active={cat} onToggle={toggle("category", cat, setCat)} />
          <CategoryPills label="Precision" categories={RATINGS} active={precision} onToggle={toggle("precision", precision, setPrecision)} />
          <CategoryPills label="Incentives" categories={RATINGS} active={incentives} onToggle={toggle("incentives", incentives, setIncentives)} />
          <CategoryPills label="Status" categories={STATUSES} active={status} onToggle={toggle("status", status, setStatus)} />
        </div>

        {report && (Object.entries(OEA_CATEGORY_LABELS) as [OeaCategory, string][]).map(([c, label]) => {
          const catRows = byCategory[c];
          if (!catRows?.length) return null;
          return (
            <OeaTable key={c} label={label} rows={catRows} mechanisms={report.mechanisms}
              expandedKey={expanded}
              onToggle={toggleRow} />
          );
        })}
      </div>
    </div>
  );
}
