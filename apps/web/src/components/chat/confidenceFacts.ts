import type { AnswerCoverage, CitationMark } from "./api";

// The "answer confidence" facts shown under an answer, next to the verify
// badge (decision 2026-09-22: confidence is shown as plain facts, never a
// percentage). Three facts make up the unit:
//   1. coverage — did the reply answer the question (server: answer_coverage);
//   2. sources  — how many of the checked sources back it (from citation_marks);
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

// M = docs the citation check marked (backed / unbacked / disputed), N = the
// backed ones. "checked" is load-bearing: a cited doc the check never judged
// has no mark and is not counted, so M can be smaller than the Sources count.
export function sourcesText(backed: number, checked: number): string {
  return `${backed} of ${checked} checked source${checked === 1 ? "" : "s"} ${backed === 1 ? "backs" : "back"} the answer`;
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
  const marked = marks ? Object.values(marks) : [];
  if (marked.length > 0) {
    const backed = marked.filter((m) => m.status === "backed").length;
    // A disputed mark is a confirm-gated contradiction the verify badge does
    // not repeat. An unbacked mark only means the document doesn't cover the
    // citing line, so it stays a neutral count.
    const disputed = marked.some((m) => m.status === "disputed");
    facts.push({ key: "sources", text: sourcesText(backed, marked.length), status: disputed ? "flagged" : "info" });
  }
  return facts;
}
