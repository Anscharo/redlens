// The two rated sections of an expanded Risk Rules row: precision (with the
// metrics it names) and penalties/incentives (with links to the mechanisms).
// Reasoning is free-form LLM prose (no atlas links), so it renders noMath: it
// carries currency and stray `$a$` spans that the reader's KaTeX path would
// misrender, while still linkifying any addresses.
import type { AtlasNode } from "@/types";
import type { RiskAssessmentEntry } from "@/lib/riskAssessment";
import { RatingPill } from "./OeaAssessmentTable";
import { ScorePill } from "./ScorePill";
import { NodeContent } from "../NodeContent";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { useNavigateToNode } from "../../hooks/useNavigation";

export function PrecisionReasoning({ entry: e }: { entry: RiskAssessmentEntry }) {
  const onNavigate = useNavigateToNode();
  return (
    <div>
      <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">
        Precision <ScorePill s={e.preciseness} />
      </p>
      <div className="text-tan-2">
        <NodeContent content={e.precisenessReasoning} onNavigate={onNavigate} noMath />
      </div>
      {e.metrics.length > 0 && (
        <p className="mono text-[11px] text-tan-3 mt-1">
          metrics: {e.metrics.map((m) => (
            <span key={m} className="px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan-2 mr-1.5">{m}</span>
          ))}
        </p>
      )}
    </div>
  );
}

export function IncentivesReasoning({ entry: e, docs }: { entry: RiskAssessmentEntry; docs: Record<string, AtlasNode> }) {
  const onNavigate = useNavigateToNode();
  return (
    <div>
      <p className="mono text-[10px] text-tan-3 uppercase tracking-wider mb-1">
        Penalties / Incentives <RatingPill r={e.enforcement} />
      </p>
      <div className="text-tan-2">
        <NodeContent content={e.enforcementReasoning} onNavigate={onNavigate} noMath />
      </div>
      {e.mechanismUuids.length > 0 && (
        <p className="text-xs mt-1">
          {e.mechanismUuids.map((u) => (
            <AtlasLink key={u} to={atlasHref(u)} className="text-accent hover:underline mr-3">
              {docs[u]?.title ?? u.slice(0, 8)} ↗
            </AtlasLink>
          ))}
        </p>
      )}
    </div>
  );
}
