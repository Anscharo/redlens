import type { ReportProvenance } from "@/lib/reportCatalog";
import { PROVENANCE_LABELS, PROVENANCE_TITLES } from "@/lib/reportCatalog";

// Marks a report card whose rows are NOT recomputed from the served atlas on
// every visit. `live` renders nothing on purpose: it is the norm, and badging
// most of the grid identically would make the badge meaningless. A badge here
// means "there is a caveat worth reading before you trust this".
//
// The label carries the meaning, not the colour (the tint only reinforces it),
// so the distinction survives a monochrome theme or a colour-blind reader.

const TONE: Record<Exclude<ReportProvenance, "live">, string> = {
  "ai-assessed": "var(--accent)",
  curated: "var(--warn)",
};

export type ProvenanceBadgeProps = Omit<React.ComponentProps<"span">, "title"> & {
  /** Where the report's rows come from. `live` renders nothing. */
  provenance: ReportProvenance;
};

export function ProvenanceBadge({ provenance, ...props }: ProvenanceBadgeProps) {
  if (provenance === "live") return null;
  return (
    <span
      data-state={provenance}
      title={PROVENANCE_TITLES[provenance]}
      className="mono text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
      style={{ color: TONE[provenance], borderColor: TONE[provenance] }}
      {...props}
    >
      {PROVENANCE_LABELS[provenance]}
    </span>
  );
}
