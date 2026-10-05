import type { ChatEventOf, MessageEventHandlers } from "./applyEvent";
import type { ParagraphCheck, VerifyState } from "./chatTypes";
import { clearInFlightModelMarks, upsertParagraphCheck } from "./paragraphCheckList";

// The wire verdict as the message stores it. Fields an older server omits
// default to "nothing found".
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

// Appends, never replaces — nothing shown is ever removed. The server sends
// at most one per turn; should a second ever land, the verdict already on
// screen stays and only newly named parts are added.
const answerCoverage: MessageEventHandlers["answer_coverage"] = (m, ev) => {
  const prev = m.answerCoverage;
  if (!prev) {
    return { ...m, answerCoverage: { verdict: ev.verdict, missingParts: ev.missingParts, ...(ev.parts ? { parts: ev.parts } : {}) } };
  }
  const added = ev.missingParts.filter((p) => !prev.missingParts.includes(p));
  return added.length === 0 ? m : { ...m, answerCoverage: { ...prev, missingParts: [...prev.missingParts, ...added] } };
};

// A set-aside draft's checks move onto SupersededDraft.checks on `clear` —
// this only ever accumulates the CURRENT live draft's checks. The model call
// is submitted right after this event, so the row becomes "pending" — UNLESS
// a `paragraph_refute` for this index already resolved first (odd timing),
// in which case its state stands.
const paragraphCheck: MessageEventHandlers["paragraph_check"] = (m, ev) => {
  const list = m.paragraphChecks ?? [];
  const existing = list.find((c) => c.index === ev.index);
  const check: ParagraphCheck = { index: ev.index, text: ev.text, findings: ev.findings, model: existing?.model ?? "pending" };
  return { ...m, paragraphChecks: upsertParagraphCheck(list, check) };
};

// May arrive before its matching `paragraph_check` — create the row with
// empty text/findings if so; `paragraph_check` fills those in later without
// disturbing the model state already set here.
const paragraphRefute: MessageEventHandlers["paragraph_refute"] = (m, ev) => {
  const list = m.paragraphChecks ?? [];
  const existing = list.find((c) => c.index === ev.index);
  const model: ParagraphCheck["model"] = !ev.parsed ? "failed" : ev.candidates > 0 ? "candidate" : "ok";
  const check: ParagraphCheck = { index: ev.index, text: existing?.text ?? "", findings: existing?.findings ?? [], model };
  return { ...m, paragraphChecks: upsertParagraphCheck(list, check) };
};

// The answer's audit: per-paragraph checks, citation marks, coverage, and
// the whole-answer verdict.
export const checkEventHandlers: MessageEventHandlers = {
  // Merges by doc uuid rather than replacing wholesale — nothing shown is
  // ever removed. The server sends one per turn; a re-send adds to, not
  // clobbers, marks already on screen.
  citation_marks: (m, ev) => ({ ...m, citationMarks: { ...m.citationMarks, ...ev.marks } }),
  answer_coverage: answerCoverage,
  // verify_result precedes done (see api.ts's event-ordering comment), so this
  // is normally where in-flight marks (pending / candidate) get cleared —
  // done repeats the same clear in case it ever lands first instead.
  verify_result: (m, ev) => ({ ...m, paragraphChecks: clearInFlightModelMarks(m.paragraphChecks), verify: verifyFromResult(ev) }),
  paragraph_check: paragraphCheck,
  paragraph_refute: paragraphRefute,
};
