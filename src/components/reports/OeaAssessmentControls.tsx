// Pill groups + the summary strip for the OEA Task Assessment report.
import { OEA_CATEGORY_LABELS, type OeaCategory } from "../../lib/oeaTasks";
import type { Rating } from "../../lib/oeaAssessment";
import { summarize, type OeaRow, type OeaRowStatus } from "../../lib/oeaReport";
import { CategoryPills } from "./CategoryPills";

export const RATING_LABELS: Record<Rating, string> = { weak: "weak", mid: "mid", strong: "strong" };
export const STATUS_LABELS: Record<OeaRowStatus, string> = { fresh: "fresh", stale: "stale", unassessed: "unassessed" };
const RATINGS = ["weak", "mid", "strong"] as const;
const STATUSES = ["fresh", "stale", "unassessed"] as const;
const CATEGORIES = Object.keys(OEA_CATEGORY_LABELS) as OeaCategory[];

export function OeaSummaryStrip({ rows }: { rows: readonly OeaRow[] }) {
  const s = summarize(rows);
  const fmt = (r: Record<Rating, number>) => `${r.weak} weak · ${r.mid} mid · ${r.strong} strong`;
  return (
    <p className="mono text-xs text-tan-3">
      {rows.length} tasks · precision: {fmt(s.precision)} · incentives: {fmt(s.incentives)}
      {s.stale > 0 && ` · ${s.stale} stale`}
      {s.unassessed > 0 && ` · ${s.unassessed} unassessed`}
    </p>
  );
}

export function OeaAssessmentControls({
  cat,
  onCat,
  precision,
  onPrecision,
  incentives,
  onIncentives,
  status,
  onStatus,
}: {
  cat: OeaCategory | null;
  onCat: (next: OeaCategory) => void;
  precision: Rating | null;
  onPrecision: (next: Rating) => void;
  incentives: Rating | null;
  onIncentives: (next: Rating) => void;
  status: OeaRowStatus | null;
  onStatus: (next: OeaRowStatus) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4 mb-6">
      <CategoryPills categories={CATEGORIES} active={cat} onToggle={onCat} />
      <CategoryPills label="Precision" categories={RATINGS} active={precision} onToggle={onPrecision} />
      <CategoryPills label="Incentives" categories={RATINGS} active={incentives} onToggle={onIncentives} />
      <CategoryPills label="Status" categories={STATUSES} active={status} onToggle={onStatus} />
    </div>
  );
}
