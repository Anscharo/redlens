import type { ChatEventOf, MessageEventHandlers } from "./applyEvent";
import type { ParagraphCheck, VerifyState } from "./chatTypes";
import { clearInFlightModelMarks, upsertParagraphCheck } from "./paragraphCheckList";

// Fields an older server omits default to "nothing found".
export function verifyFromResult(ev: ChatEventOf<"verify_result">): VerifyState {
  return {
    status: ev.overall,
    contradictions: ev.contradictions,
    rulingIssued: ev.rulingIssued ?? false,
    invalidCitations: ev.invalidCitations,
    invalidDocNos: ev.invalidDocNos,
    docNoMismatches: ev.docNoMismatches,
    ungroundedQuotes: ev.ungroundedQuotes,
    ungroundedAddresses: ev.ungroundedAddresses,
    ungroundedCitationValues: ev.ungroundedCitationValues ?? [],
    paramMismatches: ev.paramMismatches ?? [],
    completenessFailures: ev.completenessFailures ?? [],
    missingExternalDisclaimer: ev.missingExternalDisclaimer ?? false,
    mscCitedAsAtlas: ev.mscCitedAsAtlas ?? [],
    lengthCapped: ev.lengthCapped ?? false,
  };
}

// Appends only: a second event adds newly named parts and never removes what is shown.
const answerCoverage: MessageEventHandlers["answer_coverage"] = (m, ev) => {
  const prev = m.answerCoverage;
  if (!prev) {
    return { ...m, answerCoverage: { verdict: ev.verdict, missingParts: ev.missingParts, ...(ev.parts ? { parts: ev.parts } : {}) } };
  }
  const added = ev.missingParts.filter((p) => !prev.missingParts.includes(p));
  return added.length === 0 ? m : { ...m, answerCoverage: { ...prev, missingParts: [...prev.missingParts, ...added] } };
};

// Accumulates the live draft's checks only. The row becomes "pending" unless a
// `paragraph_refute` for this index already resolved.
const paragraphCheck: MessageEventHandlers["paragraph_check"] = (m, ev) => {
  const list = m.paragraphChecks ?? [];
  const existing = list.find((c) => c.index === ev.index);
  const check: ParagraphCheck = { index: ev.index, text: ev.text, findings: ev.findings, model: existing?.model ?? "pending" };
  return { ...m, paragraphChecks: upsertParagraphCheck(list, check) };
};

// May arrive before its `paragraph_check`, which later fills in text/findings.
const paragraphRefute: MessageEventHandlers["paragraph_refute"] = (m, ev) => {
  const list = m.paragraphChecks ?? [];
  const existing = list.find((c) => c.index === ev.index);
  const model: ParagraphCheck["model"] = !ev.parsed ? "failed" : ev.candidates > 0 ? "candidate" : "ok";
  const check: ParagraphCheck = { index: ev.index, text: existing?.text ?? "", findings: existing?.findings ?? [], model };
  return { ...m, paragraphChecks: upsertParagraphCheck(list, check) };
};

export const checkEventHandlers: MessageEventHandlers = {
  // Merges by doc uuid so a re-send never removes marks on screen.
  citation_marks: (m, ev) => ({ ...m, citationMarks: { ...m.citationMarks, ...ev.marks } }),
  answer_coverage: answerCoverage,
  // verify_result precedes done (api.ts), so in-flight marks clear here; done repeats it.
  verify_result: (m, ev) => ({ ...m, paragraphChecks: clearInFlightModelMarks(m.paragraphChecks), verify: verifyFromResult(ev) }),
  paragraph_check: paragraphCheck,
  paragraph_refute: paragraphRefute,
};
