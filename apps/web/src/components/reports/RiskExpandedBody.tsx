// Expanded-row body for the Risk Rules Assessment report: the source
// paragraph, then the precision and penalties/incentives reasoning — or just
// the paragraph and a run hint when the row is not yet assessed.
import type { AtlasNode } from "@/types";
import type { RiskRow } from "@/lib/riskAssessmentIndex";
import type { ReportQuery } from "@/lib/reportFilter";
import { NodeContent } from "../NodeContent";
import { useNavigateToNode } from "../../hooks/useNavigation";
import { IncentivesReasoning, PrecisionReasoning } from "./RiskReasoning";

interface RiskExpandedBodyProps {
  row: RiskRow;
  docs: Record<string, AtlasNode>;
  rq: ReportQuery;
}

function UnassessedBody({ row, rq }: Omit<RiskExpandedBodyProps, "docs">) {
  const onNavigate = useNavigateToNode();
  return (
    <div className="space-y-3 text-sm">
      <blockquote className="text-tan-2 border-l-2 border-[var(--border)] rounded-r pl-3 pr-2 py-1.5">
        <NodeContent content={row.candidate.quote} onNavigate={onNavigate} highlight={rq} />
      </blockquote>
      <p className="text-xs text-tan-3">Not yet assessed — run `pnpm risk:assess`.</p>
    </div>
  );
}

export function RiskExpandedBody({ row, docs, rq }: RiskExpandedBodyProps) {
  const onNavigate = useNavigateToNode();
  const e = row.entry;
  // Expanded agent-copy rows (taskKey rewritten to u:<uuid> by joinRisk while
  // the shared entry keeps its t:… key) show their OWN paragraph, not the
  // representative's — otherwise a Keel row would quote Spark's copy.
  const srcQuote = e && e.taskKey === row.candidate.taskKey ? e.quote : row.candidate.quote;
  if (!e) return <UnassessedBody row={row} rq={rq} />;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">Source paragraph</p>
        <blockquote className="text-tan-2 border-l-2 border-[var(--accent)] rounded-r pl-3 pr-2 py-1.5 bg-[color-mix(in_srgb,var(--surface)_45%,transparent)]">
          <NodeContent content={srcQuote} onNavigate={onNavigate} highlight={rq} />
        </blockquote>
      </div>
      <PrecisionReasoning entry={e} />
      <IncentivesReasoning entry={e} docs={docs} />
      <p className="mono text-[10px] text-tan-3">
        ✳ assessed by {e.model}
        {row.status === "stale" && " · STALE — the atlas changed since this rating; re-queued on next run"}
      </p>
    </div>
  );
}
