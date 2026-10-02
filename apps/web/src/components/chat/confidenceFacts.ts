import type { AnswerCoverage, CitationMark } from "./api";

// The "answer confidence" facts shown under an answer, next to the verify
// badge (decision 2026-09-22: confidence is shown as plain facts, never a
// percentage). Three facts make up the unit:
//   1. coverage — did the reply answer the question (server: answer_coverage);
//   2. sources  — a marked citation may say otherwise (only when a chip is !);
//   3. contradictions — the verify badge itself; not repeated here.
// Pure, so the copy and the "say nothing by default" rule are testable
// without React. List by exception: an `answers` ruling adds nothing.

export interface AnswerFact {
  key: "coverage" | "missing" | "sources";
  text: string;
  /** "flagged" = the answer fell short, or a checked source contradicts it; "info" = a neutral fact. */
  status: "flagged" | "info";
}

const COVERAGE_FACT: Partial<Record<AnswerCoverage["verdict"], AnswerFact>> = {
  deflects: { key: "coverage", text: "Didn't answer the question", status: "flagged" },
  asks: { key: "coverage", text: "Asked you a clarifying question", status: "info" },
  declines: { key: "coverage", text: "Said the atlas doesn't cover this", status: "info" },
};

// Parts are fragments of the user's own question ("how much", "when"), so
// they are quoted — unquoted, "Didn't address: when" reads as broken copy.
export function missingPartsText(parts: string[]): string {
  return `Didn't address: ${parts.map((p) => `“${p}”`).join(", ")}`;
}

// Said only when a chip carries !. The ✓✓ chips already state the sure
// matches, and a "N of M are backed" line counted checks we deliberately
// do not show. "Citation", never "source": a tool call is a lookup, what
// the answer cites is a citation, and the thing it points at is a document.
export function disputedMarksText(count: number): string {
  return count === 1 ? "A marked citation may say otherwise" : `${count} marked citations may say otherwise`;
}

export function answerFacts(coverage: AnswerCoverage | undefined, marks: Record<string, CitationMark> | undefined): AnswerFact[] {
  const facts: AnswerFact[] = [];
  const verdictFact = coverage ? COVERAGE_FACT[coverage.verdict] : undefined;
  if (verdictFact) facts.push(verdictFact);
  // The server only names missing parts on answers/declines; guard anyway so
  // "Didn't answer the question" is never followed by a part-by-part repeat.
  if (coverage && (coverage.verdict === "answers" || coverage.verdict === "declines") && coverage.missingParts.length > 0) {
    facts.push({ key: "missing", text: missingPartsText(coverage.missingParts), status: "flagged" });
  }
  // Only the two marks a chip can draw. A row of ✓✓ already says what a
  // "N of N are backed" line would repeat, so the line appears only when a
  // confirmed contradiction is among them — the badge does not repeat that,
  // and a count that included the hidden checks would ask about marks we
  // chose not to show.
  const disputed = marks ? Object.values(marks).filter((m) => m.status === "disputed").length : 0;
  if (disputed > 0) facts.push({ key: "sources", text: disputedMarksText(disputed), status: "flagged" });
  return facts;
}
