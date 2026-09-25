// Per-doc Sources-chip mark (docs/plans/jev-typesafe.md): after the answer
// streams, judges every (claim, cited doc) pair with Jev (cite-support.ts's
// judgeCitation) and folds the results into ONE mark per cited doc — the
// client shows this on the answer's Sources chips, not on the answer text
// itself, so it never gates or rewrites what already streamed.
//
// A `contradicts` verdict is not trusted on its own: it goes through the same
// confirm gate the whole-turn verifier uses (verify/confirm.ts) before it is
// allowed to mark a doc "disputed". An unconfirmed contradiction downgrades to
// "uncovered" (informational) rather than shipping an unconfirmed warning —
// the confirm gate is a HARD gate here too, same rule as computeOverall's.
import { withDeadline } from "../../jev.ts";
import { citationPairs, type CitationPair } from "./cite-pairs.ts";
import { judgeCitation, type CiteVerdict } from "./cite-support.ts";
import { runConfirm } from "./confirm.ts";
import type { Contradiction } from "./verifier.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { JsonCall } from "../llm.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";

// What the reader sees on the chip. Ordered worst-first in aggregateMarks:
// a contradiction outranks a gap, which outranks partial support, which
// outranks any full support.
//   disputed     !  — a confirmed contradiction
//   uncovered    ⚠  — the document does not cover a line citing it
//   partial      ✓⚠ — backs part of a compound claim, silent on the rest
//   mixed        ✓⚠ — backs one citing line surely and another weakly
//   backed_weak  ✓  — full support, but under the measured confidence cliff
//   backed       ✓✓ — full support the judge is sure of
export type CitationMarkStatus = "backed" | "backed_weak" | "mixed" | "partial" | "uncovered" | "disputed";

export interface CitationMark {
  status: CitationMarkStatus;
  /** Per citing line. `confidence` is carried so the `mixed` tooltip can name
   *  which line is sure and which is not. */
  claims: { claim: string; verdict: "supports" | "supports_in_part" | "says_nothing" | "contradicts"; confidence?: number | null }[];
  /**
   * Jev's confidence (0–1) in `status`. A ✓ is only as sure as its weakest
   * support; a ! is as sure as its clearest contradiction. Null when the
   * pairs that decided the status reported none.
   */
  confidence: number | null;
}

interface JudgedPair {
  uuid: string;
  claim: string;
  verdict: CiteVerdict | null;
  /** Jev Choice confidence in `verdict`, 0–1. Absent on pairs stored before it was read back. */
  confidence?: number | null;
}

/** A stored confidence outside 0–1 is not a confidence. */
export function citeConfidence(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/**
 * The confidence cliff, and the only threshold in this file.
 *
 * Measured 2026-09-24 (`pnpm eval:citation:calibration`, 57 checks over 80
 * real citations and 327 repointed ones). It is a CLIFF, not a scale: at or
 * above 0.95 a check was right 29 times in 30, and below it only 16 in 27. Of
 * the 12 citations certified wrongly, ELEVEN sat below 0.95. That split is
 * what transfers — unlike the raw rates, it does not depend on how many wrong
 * citations the corpus holds.
 *
 * The same pass found the number carries NO information on a warning, which
 * is why `disputed` and `uncovered` are not split on it, and why there are two
 * bands here rather than the three unmeasured ones the display used to draw.
 */
export const MIN_BACKED_CONFIDENCE = 0.95;

// Which verdicts DECIDED a status, for the confidence the mark carries.
// `mixed` and `partial` are absent: both are about DISAGREEMENT between citing
// lines, so one number cannot describe them and their copy names the lines
// instead. `uncovered` is absent because its tooltip quotes the lines too.
const DECIDING: Partial<Record<CitationMarkStatus, CiteVerdict[]>> = {
  disputed: ["contradicts"],
  backed: ["supports"],
  backed_weak: ["supports"],
};

function confidenceFor(status: CitationMarkStatus, pairs: JudgedPair[]): number | null {
  const deciding = DECIDING[status];
  if (!deciding) return null;
  const values: number[] = [];
  for (const p of pairs) {
    if (!p.verdict || !deciding.includes(p.verdict)) continue;
    const c = citeConfidence(p.confidence);
    if (c !== null) values.push(c);
  }
  if (values.length === 0) return null;
  return status === "disputed" ? Math.max(...values) : Math.min(...values);
}

/**
 * Folds every judged (claim, doc) pair into one mark per doc — worst verdict
 * wins. A doc with an unjudged (null) pair gets NO mark, including when
 * another pair on it is `contradicts`: we don't claim what we didn't check.
 * A doc whose only pairs are `about_document` pointers also gets no mark — a
 * pointer citation makes no claim about the doc's content.
 *
 * Full support then splits on MIN_BACKED_CONFIDENCE. Every supporting line
 * over the cliff is `backed`, every line under it is `backed_weak`, and a
 * document with lines on both sides is `mixed` — that last case is why the
 * split is not simply "weakest support wins": a document that clearly backs
 * one sentence and barely backs another is telling the reader something a
 * single number hides. A supporting line with NO confidence counts as under
 * the cliff; Jev always reports one on a live Choice, so a missing value means
 * something went wrong, which is not a reason to promote the mark.
 */
export function aggregateMarks(judged: JudgedPair[]): Record<string, CitationMark> {
  const byUuid = new Map<string, JudgedPair[]>();
  for (const j of judged) {
    const list = byUuid.get(j.uuid);
    if (list) list.push(j);
    else byUuid.set(j.uuid, [j]);
  }
  const out: Record<string, CitationMark> = {};
  for (const [uuid, pairs] of byUuid) {
    // Before worst-verdict. A timed-out pair used to lose to `contradicts`,
    // so a doc we had not finished checking still shipped as disputed.
    if (pairs.some((p) => p.verdict === null)) continue;
    const claims = pairs
      .filter((p): p is JudgedPair & { verdict: "supports" | "supports_in_part" | "says_nothing" | "contradicts" } =>
        p.verdict === "supports" || p.verdict === "supports_in_part" || p.verdict === "says_nothing" || p.verdict === "contradicts",
      )
      .map((p) => ({ claim: p.claim, verdict: p.verdict, confidence: citeConfidence(p.confidence) }));
    let status: CitationMarkStatus;
    if (pairs.some((p) => p.verdict === "contradicts")) status = "disputed";
    else if (pairs.some((p) => p.verdict === "says_nothing")) status = "uncovered";
    else if (pairs.some((p) => p.verdict === "supports_in_part")) status = "partial";
    else if (pairs.some((p) => p.verdict === "supports")) {
      const sure = pairs.filter((p) => p.verdict === "supports" && (citeConfidence(p.confidence) ?? 0) >= MIN_BACKED_CONFIDENCE).length;
      const total = pairs.filter((p) => p.verdict === "supports").length;
      status = sure === total ? "backed" : sure === 0 ? "backed_weak" : "mixed";
    } else continue; // only `about_document` pointers — no content claim to mark
    out[uuid] = { status, claims, confidence: confidenceFor(status, pairs) };
  }
  return out;
}

export interface CitationMarksRun {
  marks: Record<string, CitationMark>;
  /** Raw per-pair verdicts, for persistence (checksMeta), not the wire event. */
  judged: { uuid: string; claim: string; verdict: CiteVerdict | null; confidence: number | null }[];
  calls: number;
  failed: number;
  costUsd: number;
  latencyMs: number;
  confirm: { candidates: number; agreed: number } | null;
}

const EMPTY: CitationMarksRun = { marks: {}, judged: [], calls: 0, failed: 0, costUsd: 0, latencyMs: 0, confirm: null };

const CONTRADICTS_WHY =
  "The citation check compared this sentence to the cited document and found them incompatible. The evidence below is that document's full text.";

/**
 * The cited document, in full. Confirm's contract is "agree only if THIS
 * evidence states the incompatibility." A prefix of the document (the first
 * 600 characters) made it disagree whenever the conflicting sentence sat
 * past the cut, and that refusal was then stored as says_nothing — the chip
 * asserted "doesn't cover" about a document confirm was never shown.
 */
function citedDocument(ix: Indexes, uuid: string): string {
  return (ix.docMap.get(uuid)?.content ?? "").trim();
}

export async function runCitationMarks(p: {
  answer: string;
  ix: Indexes;
  model: string;
  jsonCall?: JsonCall;
  confirmModel?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  concurrency?: number;
  obs?: ErrorContext;
}): Promise<CitationMarksRun> {
  try {
    const pairs: CitationPair[] = citationPairs(p.answer).filter((pair) => p.ix.docMap.has(pair.uuid));
    if (pairs.length === 0) return EMPTY;

    const t0 = Date.now();
    const deadlineMs = p.deadlineMs ?? 8000;
    const signal = withDeadline(deadlineMs, p.signal);

    const results: { pair: CitationPair; verdict: CiteVerdict | null; confidence: number | null; costUsd: number | null }[] = new Array(
      pairs.length,
    );
    let nextIndex = 0;
    let calls = 0;
    let failed = 0;
    let costUsd = 0;
    const worker = async () => {
      for (;;) {
        const i = nextIndex++;
        if (i >= pairs.length) return;
        calls++;
        const j = await judgeCitation({ pair: pairs[i], ix: p.ix, model: p.model, signal });
        if (j.verdict === null) failed++;
        if (j.costUsd) costUsd += j.costUsd;
        results[i] = { pair: pairs[i], verdict: j.verdict, confidence: j.confidence, costUsd: j.costUsd };
      }
    };
    const workerCount = Math.min(p.concurrency ?? 6, pairs.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    // Every `contradicts` pair becomes a confirm-gate candidate — same
    // discipline the whole-turn verifier applies before it will call
    // something a hard fail (verifier.ts's computeOverall).
    const contraIndexes: number[] = [];
    const candidates: Contradiction[] = [];
    results.forEach((r, i) => {
      if (r.verdict !== "contradicts") return;
      contraIndexes.push(i);
      candidates.push({
        answer_span: r.pair.claim,
        evidence_span: citedDocument(p.ix, r.pair.uuid),
        why: CONTRADICTS_WHY,
        evidence_label: "",
        uuid: r.pair.uuid,
        source: "cited-doc",
        agreed: false,
      });
    });

    let confirm: { candidates: number; agreed: number } | null = null;
    if (candidates.length > 0) {
      const run =
        p.jsonCall && p.confirmModel
          ? await runConfirm({
              call: p.jsonCall, model: p.confirmModel, answer: p.answer, candidates, signal, obs: p.obs,
              evidenceIsDocument: true,
            })
          : null;
      confirm = { candidates: candidates.length, agreed: run?.agreed.size ?? 0 };
      // NOT agreed (including "confirm unavailable/failed", which agrees with
      // nothing) downgrades to says_nothing — informational, never an
      // unconfirmed warning.
      contraIndexes.forEach((resultIndex, candidateIndex) => {
        // The number was confidence in `contradicts`. Confirm rejected that
        // verdict, so it must not describe the downgraded "doesn't cover".
        if (!run?.agreed.has(candidateIndex)) results[resultIndex] = { ...results[resultIndex], verdict: "says_nothing", confidence: null };
      });
    }

    const judged = results.map((r) => ({ uuid: r.pair.uuid, claim: r.pair.claim, verdict: r.verdict, confidence: r.confidence }));
    const marks = aggregateMarks(judged);
    return { marks, judged, calls, failed, costUsd, latencyMs: Date.now() - t0, confirm };
  } catch (err) {
    // Never throws outward — a failure here must mean "no marks", same
    // fail-open discipline as judgeCitation itself. Reported, though: a lane
    // that silently produces nothing looks identical to a turn with no
    // citations, which is exactly the confusion the other Jev lanes avoid by
    // capturing here.
    captureError(err, p.obs, { stage: "citation_marks", model: p.model });
    return EMPTY;
  }
}
