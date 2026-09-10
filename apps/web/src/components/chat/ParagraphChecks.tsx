import type { ParagraphCheck } from "./chatTypes";

export interface ParagraphChecksProps {
  checks: ParagraphCheck[] | undefined;
}

// Symbol + label per model-audit state, keyed by ParagraphCheck["model"].
const MODEL_MARKS: Record<NonNullable<ParagraphCheck["model"]>, { symbol: string; label: string }> = {
  pending: { symbol: "○", label: "model check pending" },
  ok: { symbol: "✓", label: "no contradictions found" },
  candidate: { symbol: "!", label: "possible contradiction, being confirmed" },
  failed: { symbol: "–", label: "model check unavailable" },
};

// A second mark for the model (`refute`) audit's state, rendered to the
// right of the deterministic mark. Absent `model` (should not happen once a
// row exists — see applyEvent) renders nothing.
function ModelMark({ model }: { model: ParagraphCheck["model"] }) {
  if (!model) return null;
  const { symbol, label } = MODEL_MARKS[model];
  return <span className="rlc-para-model" data-model={model} aria-label={label}>{symbol}</span>;
}

// The incremental per-paragraph audit — rendered under the Synthesizing
// stage row (StageSlots.tsx) once at least one check has landed. Each row
// carries two marks: the deterministic finding(s) (`c.findings`) and the
// model's `refute` audit state (`c.model`), which resolves concurrently. The
// paragraph's own text is already visible right above this list (the live
// draft or a superseded draft), so a row never repeats it — `title` (first
// 80 chars) only identifies the paragraph on hover.
export function ParagraphChecks({ checks }: ParagraphChecksProps) {
  if (!checks?.length) return null;
  return (
    <ol className="rlc-para-checks" aria-label="Paragraph checks">
      {checks.map((c) => {
        const flagged = c.findings.length > 0;
        const title = c.text.length > 80 ? `${c.text.slice(0, 80)}…` : c.text;
        return (
          <li key={c.index} data-state={flagged ? "flagged" : "ok"} data-model={c.model} title={title}>
            <span className="rlc-para-mark">{`¶${c.index + 1}`}</span>
            {flagged ? (
              c.findings.map((finding, i) => (
                <span key={i} className="rlc-para-finding">
                  {finding}
                </span>
              ))
            ) : (
              <span className="rlc-para-ok" aria-label="no findings">✓</span>
            )}
            <ModelMark model={c.model} />
          </li>
        );
      })}
    </ol>
  );
}
