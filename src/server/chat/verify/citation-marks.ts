// Per-doc Sources-chip mark (docs/plans/jev-typesafe.md): after the answer
// streams, judges every (claim, cited doc) pair with Jev (cite-support.ts's
// judgeCitation) and folds the results into ONE mark per cited doc — the
// client shows this on the answer's Sources chips, not on the answer text
// itself, so it never gates or rewrites what already streamed.
//
// A `contradicts` verdict is not trusted on its own: it goes through the same
// confirm gate the whole-turn verifier uses (verify/confirm.ts) before it is
// allowed to mark a doc "disputed". An unconfirmed contradiction downgrades to
// "unbacked" (informational) rather than shipping an unconfirmed warning —
// the confirm gate is a HARD gate here too, same rule as computeOverall's.
import { withDeadline } from "../../jev.ts";
import { citationPairs, type CitationPair } from "./cite-pairs.ts";
import { judgeCitation, type CiteVerdict } from "./cite-support.ts";
import { runConfirm } from "./confirm.ts";
import type { Contradiction } from "./verifier.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { JsonCall } from "../llm.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";

export type CitationMarkStatus = "backed" | "unbacked" | "disputed";

export interface CitationMark {
  status: CitationMarkStatus;
  claims: { claim: string; verdict: "supports" | "says_nothing" | "contradicts" }[];
}

interface JudgedPair {
  uuid: string;
  claim: string;
  verdict: CiteVerdict | null;
}

/**
 * Folds every judged (claim, doc) pair into one mark per doc — worst verdict
 * wins. A doc with an unjudged (null) pair gets NO mark, including when
 * another pair on it is `contradicts`: we don't claim what we didn't check.
 * A doc whose only pairs are `about_document` pointers also gets no mark — a
 * pointer citation makes no claim about the doc's content.
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
      .filter((p): p is JudgedPair & { verdict: "supports" | "says_nothing" | "contradicts" } =>
        p.verdict === "supports" || p.verdict === "says_nothing" || p.verdict === "contradicts",
      )
      .map((p) => ({ claim: p.claim, verdict: p.verdict }));
    let status: CitationMarkStatus;
    if (pairs.some((p) => p.verdict === "contradicts")) status = "disputed";
    else if (pairs.some((p) => p.verdict === "says_nothing")) status = "unbacked";
    else if (pairs.some((p) => p.verdict === "supports")) status = "backed";
    else continue; // only `about_document` pointers — no content claim to mark
    out[uuid] = { status, claims };
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
        if (!run?.agreed.has(candidateIndex)) results[resultIndex] = { ...results[resultIndex], verdict: "says_nothing" };
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
