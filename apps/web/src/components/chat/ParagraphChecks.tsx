import type { ParagraphCheck } from "./chatTypes";

export interface ParagraphChecksProps {
  checks: ParagraphCheck[] | undefined;
}

// The incremental deterministic per-paragraph audit — rendered under the
// Synthesizing stage row (StageSlots.tsx) once at least one check has
// landed. A later pass adds a per-paragraph MODEL audit; this shows only the
// deterministic one. The paragraph's own text is already visible right above
// this list (the live draft or a superseded draft), so a row never repeats
// it — `title` (first 80 chars) only identifies the paragraph on hover.
export function ParagraphChecks({ checks }: ParagraphChecksProps) {
  if (!checks?.length) return null;
  return (
    <ol className="rlc-para-checks" aria-label="Paragraph checks">
      {checks.map((c) => {
        const flagged = c.findings.length > 0;
        const title = c.text.length > 80 ? `${c.text.slice(0, 80)}…` : c.text;
        return (
          <li key={c.index} data-state={flagged ? "flagged" : "ok"} title={title}>
            <span className="rlc-para-mark">{`¶${c.index + 1}`}</span>
            {flagged ? (
              c.findings.map((finding, i) => (
                <span key={i} className="rlc-para-finding">
                  {finding}
                </span>
              ))
            ) : (
              <span aria-label="no findings">✓</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
