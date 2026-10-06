// Precision score pill (1–5) for the Risk Rules Assessment report.
import type { Preciseness } from "@/lib/riskAssessment";

const SCORE_STYLE: Record<Preciseness, string> = {
  1: "bg-[color-mix(in_srgb,var(--red)_35%,transparent)] text-tan",
  2: "bg-[color-mix(in_srgb,var(--red)_20%,transparent)] text-tan",
  3: "bg-[var(--hover)] text-tan-2",
  4: "bg-[color-mix(in_srgb,var(--terminal-green)_18%,transparent)] text-tan",
  5: "bg-[color-mix(in_srgb,var(--terminal-green)_30%,transparent)] text-tan",
};

export function ScorePill({ s }: { s: Preciseness | null }) {
  if (!s) return <span className="mono text-[10px] text-tan-3">—</span>;
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${SCORE_STYLE[s]}`}>{s}/5</span>;
}
