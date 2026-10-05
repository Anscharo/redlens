// One OeaTable per OEA category that has rows to show, in category order.
import { OEA_CATEGORY_LABELS, type OeaCategory } from "@/lib/oeaTasks";
import type { OeaMechanism, OeaRow } from "@/lib/oeaReport";
import type { ReportQuery } from "@/lib/reportFilter";
import { OeaTable } from "./OeaAssessmentTable";

export function OeaCategoryTables({
  byCategory,
  mechanisms,
  expandedKey,
  onToggle,
  rq,
}: {
  byCategory: Record<OeaCategory, OeaRow[]>;
  mechanisms: Record<string, OeaMechanism>;
  expandedKey: string | null;
  onToggle: (row: OeaRow) => void;
  rq: ReportQuery;
}) {
  return (Object.entries(OEA_CATEGORY_LABELS) as [OeaCategory, string][]).map(([c, label]) => {
    const catRows = byCategory[c];
    if (!catRows?.length) return null;
    return (
      <OeaTable
        key={c}
        label={label}
        rows={catRows}
        mechanisms={mechanisms}
        expandedKey={expandedKey}
        onToggle={onToggle}
        rq={rq}
      />
    );
  });
}
