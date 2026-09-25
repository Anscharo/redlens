// Read-side twin of what chat-orchestrator.ts's `persistChecks` (the
// `checksMeta.push({kind: ...})` calls around the end of a turn) writes into
// `message_checks`. Everything here parses a persisted JSONB payload back
// into the shapes the live wire path produces, so a reloaded conversation
// shows the same reliability-harness badge, dispute list, and answer-coverage
// line the user saw live. Every function in this file NEVER THROWS: a row in
// a shape it doesn't recognise — a future format change, a corrupted row, a
// partial write from a crashed process — degrades to "nothing usable" for
// that one field or row rather than failing the whole conversation load.
// Callers (conversations.ts) rely on that.
import { citeConfidence } from "./citation-marks.ts";
import { VERDICTS, type CiteVerdict } from "./cite-support.ts";
import { agreedContradictionsFrom, type AgreedContradiction } from "./disputes.ts";
import { computeOverall, type Verdict, type Contradiction, type VerifyOverall } from "./verifier.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { ParamMismatch } from "./param-checks.ts";
import type { CoverageVerdict } from "./answer-coverage.ts";

// Reliability-harness badge + dispute list, reconstructed on reload — shaped
// to match the client's VerifyState (apps/web/src/components/chat/chatTypes.ts)
// field for field, minus its "checking" status member (a restored row is
// always already resolved). Server-side type, not imported from apps/web:
// src/server and apps/web are separate tsc -b projects (tsconfig.server.json
// only includes src/server). See conversations.ts's verifyFor for how each
// field is reconstructed.
export interface VerifyOut {
  status: VerifyOverall;
  contradictions: AgreedContradiction[];
  rulingIssued: boolean;
  invalidCitations: string[];
  invalidDocNos: string[];
  docNoMismatches: string[];
  ungroundedQuotes: string[];
  ungroundedAddresses: string[];
  ungroundedCitationValues: string[];
  paramMismatches: ParamMismatch[];
  completenessFailures: string[];
  missingExternalDisclaimer: boolean;
  mscCitedAsAtlas: string[];
  lengthCapped: boolean;
}

// Every CiteVerdict value the persisted citation_check payload can carry,
// taken from the module that defines them so a new verdict can't be accepted
// live and dropped on reload. Anything else in a stored `verdict` field means
// a future/changed shape, not this one.
const CITE_VERDICTS: ReadonlySet<string> = new Set(VERDICTS);

// Defensive parse of a message_checks.verdict payload (JSONB, already
// deserialized to a JS value by Bun.sql) into aggregateMarks' input shape.
// Never throws: a row in a shape this doesn't recognise — a future format
// change, or anything otherwise corrupted — degrades to "no marks" for that
// message (null) rather than failing the whole conversation load. A single
// malformed pair within an otherwise-good row is dropped rather than
// poisoning the row's other pairs.
export function judgedPairsFrom(verdict: unknown): { uuid: string; claim: string; verdict: CiteVerdict | null; confidence: number | null }[] | null {
  if (!verdict || typeof verdict !== "object") return null;
  const judged = (verdict as { judged?: unknown }).judged;
  if (!Array.isArray(judged)) return null;
  const out: { uuid: string; claim: string; verdict: CiteVerdict | null; confidence: number | null }[] = [];
  for (const j of judged) {
    if (!j || typeof j !== "object") continue;
    const { uuid, claim, verdict: v, confidence } = j as Record<string, unknown>;
    if (typeof uuid !== "string" || typeof claim !== "string") continue;
    if (v !== null && !CITE_VERDICTS.has(v as string)) continue;
    out.push({ uuid, claim, verdict: (v as CiteVerdict) ?? null, confidence: citeConfidence(confidence) });
  }
  return out;
}

// The recomputable slice of a 'round_checks' row's `verdict.checks` — every
// field VerifyOut needs, plus `failed` (used only to rebuild a CheckReport for
// computeOverall below, never returned to the client directly). Deliberately
// NOT the full CheckReport shape: chat-orchestrator.ts overwrites `checks`'
// `citations` field with a bare COUNT before persisting it
// (`{ ...checks, citations: checks.citations.length }`), so the stored row
// does not actually conform to CheckReport (its `citations` is a number, not
// Citation[]) — one of the two reasons `status` sometimes can't be an honest
// recompute; see verifyFor's comment for the other.
export interface DeterministicChecks {
  invalidCitations: string[];
  invalidDocNos: string[];
  docNoMismatches: string[];
  ungroundedQuotes: string[];
  ungroundedAddresses: string[];
  ungroundedCitationValues: string[];
  paramMismatches: ParamMismatch[];
  completenessFailures: string[];
  missingExternalDisclaimer: boolean;
  mscCitedAsAtlas: string[];
  lengthCapped: boolean;
  failed: boolean;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function paramMismatchesFrom(v: unknown): ParamMismatch[] {
  if (!Array.isArray(v)) return [];
  const out: ParamMismatch[] = [];
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const { stated, actual, name, title, owner, uuid, doc_no } = p as Record<string, unknown>;
    if (
      typeof stated !== "string" || typeof actual !== "string" || typeof name !== "string" ||
      typeof title !== "string" || typeof uuid !== "string" || typeof doc_no !== "string"
    ) continue;
    out.push({ stated, actual, name, title, uuid, doc_no, owner: typeof owner === "string" ? owner : null });
  }
  return out;
}

// Defensive parse of a 'round_checks' row's verdict payload (chat-orchestrator.ts
// ~line 793) down to the fields VerifyOut needs. Never throws: an
// unrecognised shape (missing `checks`, or `checks.failed` not a boolean —
// the one field every version of this payload has always carried) degrades to
// null, same discipline as judgedPairsFrom above.
export function deterministicChecksFrom(roundChecksVerdict: unknown): DeterministicChecks | null {
  if (!roundChecksVerdict || typeof roundChecksVerdict !== "object") return null;
  const checks = (roundChecksVerdict as { checks?: unknown }).checks;
  if (!checks || typeof checks !== "object") return null;
  const c = checks as Record<string, unknown>;
  if (typeof c.failed !== "boolean") return null;
  return {
    invalidCitations: strArray(c.invalidCitations),
    invalidDocNos: strArray(c.invalidDocNos),
    docNoMismatches: strArray(c.docNoMismatches),
    ungroundedQuotes: strArray(c.ungroundedQuotes),
    ungroundedAddresses: strArray(c.ungroundedAddresses),
    ungroundedCitationValues: strArray(c.ungroundedCitationValues),
    paramMismatches: paramMismatchesFrom(c.paramMismatches),
    completenessFailures: strArray(c.completenessFailures),
    missingExternalDisclaimer: c.missingExternalDisclaimer === true,
    mscCitedAsAtlas: strArray(c.mscCitedAsAtlas),
    lengthCapped: c.lengthCapped === true,
    failed: c.failed,
  };
}

// Rebuilds a CheckReport for computeOverall out of a DeterministicChecks. Only
// `failed` is ever read by computeOverall (verifier.ts) — the other fields
// defaulted here (`citations`, `bareAtlasLinks`, `uncitedParagraphs`,
// `untracedNumbers`) exist solely to satisfy the type and are never consulted
// by it, so defaulting them costs nothing and asserts nothing false.
export function checkReportForOverall(det: DeterministicChecks): CheckReport {
  return {
    citations: [], invalidCitations: det.invalidCitations, invalidDocNos: det.invalidDocNos,
    docNoMismatches: det.docNoMismatches, bareAtlasLinks: [], uncitedParagraphs: 0,
    ungroundedQuotes: det.ungroundedQuotes, ungroundedAddresses: det.ungroundedAddresses,
    ungroundedCitationValues: det.ungroundedCitationValues, untracedNumbers: [],
    paramMismatches: det.paramMismatches, completenessFailures: det.completenessFailures,
    missingExternalDisclaimer: det.missingExternalDisclaimer, mscCitedAsAtlas: det.mscCitedAsAtlas,
    lengthCapped: det.lengthCapped, failed: det.failed,
  };
}

export function rulingIssuedFrom(verdict: unknown): boolean {
  return !!verdict && typeof verdict === "object" && (verdict as { ruling_issued?: unknown }).ruling_issued === true;
}

const VERIFY_OVERALLS: ReadonlySet<string> = new Set(["pass", "warn", "fail", "unverified"]);
export function storedOverall(overall: string | null): VerifyOverall {
  return overall && VERIFY_OVERALLS.has(overall) ? (overall as VerifyOverall) : "unverified";
}

/**
 * Defensive parse of a 'verify' row's verdict payload down to exactly the
 * fields computeOverall (verifier.ts) reads: ruling_issued, refuteParsed,
 * confirm.{ran,parsed,candidates}, and contradictions[].agreed. That last one
 * is NOT re-parsed from the raw payload here — it is built from `agreed`, the
 * caller's own `agreedContradictionsFrom(verdict)` result (disputes.ts), the
 * SAME validated list VerifyOut.contradictions returns to the client.
 * Independently re-deriving "does anything have agreed:true" straight off the
 * raw payload — the previous shape of this function — let a corrupted entry
 * (agreed: true, a non-string span) make computeOverall see an agreed
 * contradiction while the client-visible contradictions list stayed empty: a
 * fail badge with nothing to show for it. Folding from the same validated
 * list structurally rules that out — the badge can never claim a
 * contradiction the list does not contain.
 *
 * The mapped `Contradiction`s carry blank `evidence_label`/`source: "model"`
 * placeholders: computeOverall only ever reads `.agreed` off this array, so
 * defaulting the rest costs nothing (same discipline as
 * checkReportForOverall's blanks above).
 *
 * Still returns null (never throws) when a field computeOverall DOES read
 * fails to parse — `ruling_issued`/`refuteParsed` missing or the wrong type,
 * `confirm` malformed, or `contradictions` not even an array (the one
 * remaining shape check on that field — a non-array `contradictions` means
 * the row itself is a bad parse, not that this function should quietly treat
 * it as "zero contradictions" when the caller's own `agreed` list already
 * says otherwise). The caller falls back to the row's stored `overall` column
 * in that case.
 */
export function verdictForOverall(verdict: unknown, agreed: AgreedContradiction[]): Verdict | null {
  if (!verdict || typeof verdict !== "object") return null;
  const v = verdict as Record<string, unknown>;
  if (!Array.isArray(v.contradictions)) return null;
  if (typeof v.ruling_issued !== "boolean" || typeof v.refuteParsed !== "boolean") return null;
  let confirm: Verdict["confirm"] = null;
  if (v.confirm !== null && v.confirm !== undefined) {
    if (typeof v.confirm !== "object") return null;
    const c = v.confirm as Record<string, unknown>;
    if (typeof c.ran !== "boolean" || typeof c.parsed !== "boolean" || typeof c.candidates !== "number") return null;
    confirm = {
      ran: c.ran, parsed: c.parsed, candidates: c.candidates,
      model: typeof c.model === "string" ? c.model : null,
      agreed: typeof c.agreed === "number" ? c.agreed : 0,
    };
  }
  const contradictions: Contradiction[] = agreed.map((c) => ({
    answer_span: c.answer, evidence_span: c.evidence, why: c.why, evidence_label: "",
    uuid: c.uuid, source: "model", agreed: true,
  }));
  return { contradictions, ruling_issued: v.ruling_issued, notes: "", refuteParsed: v.refuteParsed, confirm };
}

/**
 * Reconstructs one assistant message's VerifyOut from its 'verify' row (if
 * any, already checked by the caller to have an object `verdict`) and its
 * 'round_checks' row's raw verdict (if any). Pure — no SQL, no I/O — so both
 * branches below are unit-testable without a database.
 *
 * `status` is recomputed with the SAME computeOverall() a live turn uses
 * (verifier.ts), not trusted off either row's stored `overall` column in
 * isolation — so a future change to the fold applies to old rows too, without
 * a backfill (the recompute-don't-trust precedent citationMarksFor already
 * follows for marks). That recompute needs BOTH rows to parse: the
 * 'round_checks' row for `checks.failed`, the 'verify' row for the rest. When
 * either payload doesn't parse (deterministicChecksFrom/verdictForOverall
 * returned null), recomputing honestly isn't possible — this falls back to
 * the 'verify' row's own stored `overall` column, which was computed live, by
 * the same computeOverall, at write time.
 *
 * `verifyRow === null` (no 'verify' row at all) mirrors chat-orchestrator.ts's
 * `emitVerify = verifierModel !== "" || checks.failed` (~line 944): a turn
 * with the verifier model OFF but a FAILED deterministic check still emits
 * (and the live client still shows) a fail badge — but the
 * `checksMeta.push({kind: "verify", ...})` that would persist a 'verify' row
 * only runs inside `if (auditPromise)`, which requires a configured verifier
 * model. So that turn persists a 'round_checks' row and NO 'verify' row, and
 * a restore that only ever reads 'verify' rows silently drops that turn's red
 * badge on reload. Reconstruct the fail badge from the 'round_checks' row
 * ALONE in exactly that one case (`contradictions: []` and
 * `rulingIssued: false` — there was no audit to produce either). A
 * 'round_checks' row whose `failed` is FALSE restores null here too, because
 * the live path emits nothing in that case either — getting this backwards
 * would put a badge on every clean, unverified turn.
 */
export function restoreVerify(
  verifyRow: { verdict: unknown; overall: string | null } | null,
  roundChecksVerdict: unknown,
): VerifyOut | null {
  const det = deterministicChecksFrom(roundChecksVerdict);

  if (!verifyRow) {
    if (!det || !det.failed) return null;
    return {
      status: computeOverall(checkReportForOverall(det), null), // "fail" — checks.failed is computeOverall's first, unconditional branch
      contradictions: [],
      rulingIssued: false,
      invalidCitations: det.invalidCitations,
      invalidDocNos: det.invalidDocNos,
      docNoMismatches: det.docNoMismatches,
      ungroundedQuotes: det.ungroundedQuotes,
      ungroundedAddresses: det.ungroundedAddresses,
      ungroundedCitationValues: det.ungroundedCitationValues,
      paramMismatches: det.paramMismatches,
      completenessFailures: det.completenessFailures,
      missingExternalDisclaimer: det.missingExternalDisclaimer,
      mscCitedAsAtlas: det.mscCitedAsAtlas,
      lengthCapped: det.lengthCapped,
    };
  }

  // The SAME agreedContradictionsFrom result feeds both the returned
  // `contradictions` (what the client is shown) and verdictForOverall's fold
  // input (what `status` is computed from) — see verdictForOverall's comment
  // for the inconsistency this rules out.
  const agreed = agreedContradictionsFrom(verifyRow.verdict);
  const parsedVerdict = verdictForOverall(verifyRow.verdict, agreed);
  const status =
    det && parsedVerdict ? computeOverall(checkReportForOverall(det), parsedVerdict) : storedOverall(verifyRow.overall);
  return {
    status,
    contradictions: agreed,
    rulingIssued: rulingIssuedFrom(verifyRow.verdict),
    invalidCitations: det?.invalidCitations ?? [],
    invalidDocNos: det?.invalidDocNos ?? [],
    docNoMismatches: det?.docNoMismatches ?? [],
    ungroundedQuotes: det?.ungroundedQuotes ?? [],
    ungroundedAddresses: det?.ungroundedAddresses ?? [],
    ungroundedCitationValues: det?.ungroundedCitationValues ?? [],
    paramMismatches: det?.paramMismatches ?? [],
    completenessFailures: det?.completenessFailures ?? [],
    missingExternalDisclaimer: det?.missingExternalDisclaimer ?? false,
    mscCitedAsAtlas: det?.mscCitedAsAtlas ?? [],
    lengthCapped: det?.lengthCapped ?? false,
  };
}

// "Did it answer the question?" line — the wire shape the client's
// AnswerCoverage expects (apps/web/src/components/chat/api.ts), reconstructed
// on reload from an 'answer_coverage' row. Server-side type, not imported
// from apps/web, same reason as VerifyOut above.
export interface AnswerCoverageOut {
  verdict: CoverageVerdict;
  missingParts: string[];
  parts?: string[];
}

// Every CoverageVerdict value the persisted answer_coverage payload can
// carry, hardcoded here rather than imported as a value the way CITE_VERDICTS
// borrows VERDICTS from cite-support.ts — verify/answer-coverage.ts only
// exports the type, not a runtime list — same pattern VERIFY_OVERALLS already
// uses above for VerifyOverall. Anything else in a stored `verdict` field
// means a future/changed shape, not this one.
const COVERAGE_VERDICTS: ReadonlySet<string> = new Set(["answers", "declines", "deflects", "asks"]);

/**
 * Defensive parse of an 'answer_coverage' row's verdict payload
 * (chat-orchestrator.ts's `resolveAnswerCoverage`: `{ verdict, probabilities,
 * parts, missingParts, rawToolOutput }`, built from verify/answer-coverage.ts's
 * AnswerCoverage) down to the wire shape the client's AnswerCoverage expects.
 * `probabilities` and `rawToolOutput` are the ruling's own calibration
 * record — read here only to be dropped, never sent to the client, the same
 * discipline Verdict.contradictions' unagreed entries follow above.
 *
 * The stored `parts` is `{ text: string; p: number | null }[]`
 * (AnswerCoverage.parts) but the wire/client shape is `parts?: string[]` — the
 * live event maps `run.parts.map((p) => p.text)` and omits the key entirely
 * when there are none (chat-orchestrator.ts:
 * `...(run.parts.length > 0 ? { parts: run.parts.map((p) => p.text) } : {})`).
 * Mirrored exactly here — a pass-through would hand the renderer `{text,p}`
 * objects where it expects strings. A malformed individual part (missing/non-
 * string `text`) is dropped rather than poisoning the whole array, same
 * discipline as judgedPairsFrom's per-item drops above.
 *
 * `verdict` is validated against COVERAGE_VERDICTS the way storedOverall
 * validates against VERIFY_OVERALLS — an unrecognised value means a
 * future/changed shape, so the whole row degrades to null (never throws,
 * never passed through unchecked) rather than there being a partial /
 * best-effort restore.
 */
export function answerCoverageFromRow(verdict: unknown): AnswerCoverageOut | null {
  if (!verdict || typeof verdict !== "object") return null;
  const v = verdict as Record<string, unknown>;
  if (typeof v.verdict !== "string" || !COVERAGE_VERDICTS.has(v.verdict)) return null;
  const missingParts = strArray(v.missingParts);
  const parts = Array.isArray(v.parts)
    ? v.parts
        .filter((p): p is { text: string } => !!p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string")
        .map((p) => p.text)
    : [];
  return {
    verdict: v.verdict as CoverageVerdict,
    missingParts,
    ...(parts.length > 0 ? { parts } : {}),
  };
}
