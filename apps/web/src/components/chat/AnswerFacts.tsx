import type { ComponentProps } from "react";
import type { AnswerCoverage, CitationMark } from "./api";
import { answerFacts } from "./confidenceFacts";

export type AnswerFactsProps = Omit<ComponentProps<"ul">, "children"> & {
  /** The turn's answer_coverage ruling. Absent until it lands — or for good, when the check is off or failed. */
  coverage?: AnswerCoverage;
  /** Per-doc citation-check marks (citation_marks), counted into the sources fact. */
  marks?: Record<string, CitationMark>;
};

// The "answer confidence" line: plain facts about the answer, rendered right
// after the verify badge so the two read as one unit (the badge is the third
// fact — contradictions — and is not repeated here). Renders nothing when
// there is nothing to say. Live-only, like the badge (see hydrate.ts).
export function AnswerFacts({ coverage, marks, ...props }: AnswerFactsProps) {
  const facts = answerFacts(coverage, marks);
  if (facts.length === 0) return null;
  return (
    <ul className="rlc-answer-facts" aria-label="Answer confidence" {...props}>
      {facts.map((f) => (
        <li key={f.key} data-status={f.status}>
          {f.text}
        </li>
      ))}
    </ul>
  );
}
