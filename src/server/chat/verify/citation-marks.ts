// Per-doc Sources-chip mark (docs/plans/jev-typesafe.md): after the answer
// streams, judges every (claim, cited doc) pair with Jev (cite-support.ts's
// judgeCitation) and folds the results into ONE mark per cited doc — the
// client shows this on the answer's Sources chips, not on the answer text
// itself, so it never gates or rewrites what already streamed.
//
// A `contradicts` verdict is not trusted on its own: a content-lane one goes
// through the same confirm gate the whole-turn verifier uses (verify/confirm.ts)
// before it is allowed to mark a doc "disputed". Confirm refusing — or never
// being asked — leaves the stored verdict as `contradicts` with `confirmed:
// false` and off the chip. It is not rewritten to a gap: that status is a
// shown warning, and confirm's refusal is not evidence the document is silent.
// A record-lane contradiction is not sent to confirm at all. Confirm would be
// shown the document, not the change record, and would disagree about a
// conflict the document does not contain. It draws nothing until confirm is
// given the record.
import { withDeadline } from "../../jev.ts";
import { citationPairs, type CitationPair } from "./cite-pairs.ts";
import { judgeCitation, type CiteVerdict } from "./cite-support.ts";
import { judgeMetadata, type MetadataVerdict } from "./cite-metadata.ts";

/** What either judge can return. The two lanes share one results array, one
 *  fold, and one persisted row, so the marks layer speaks both vocabularies. */
export type MarkVerdict = CiteVerdict | MetadataVerdict;
import type { DocProvenance } from "./provenance.ts";
import { runConfirm } from "./confirm.ts";
import type { Contradiction } from "./verifier.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { JsonCall } from "../llm.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";

// What the fold can produce. Ordered worst-first in aggregateMarks:
// a contradiction outranks a gap, which outranks partial support, which
// outranks any full support.
//   disputed     !  — a confirmed contradiction. SHOWN.
//   unread       ⚠  — the answer states what the document SAYS, but the turn
//                     only looked up a record ABOUT it. SHOWN.
//   uncovered    ⚠  — the document does not cover a line citing it. SHOWN.
//   partial      ✓⚠ — backs part of a compound claim. Recorded, not shown.
//   mixed        ✓⚠ — one citing line sure, another under the cliff. Recorded, not shown.
//   backed_weak  ✓  — full support under the measured cliff. Recorded, not shown.
//   backed       ✓✓ — full support the judge is sure of. SHOWN.
//
// Four of the seven reach the reader (`shownMarks`); the three that do not are
// `backed_weak`, `mixed` and `partial`, which stay on the persisted `judged`
// pairs so a later calibration can score them. The line between them is what
// the status MEASURES, not how bad it is. Those three are weak CONFIDENCE — a
// check under the cliff was right 16 of 27 times, so drawing one asserts a
// sureness the measurement does not support. `unread` and `uncovered` are
// categorical FINDINGS, not weak numbers: the document does not cover a line
// citing it, or the answer stated what it says while the turn only read a
// record about it. Hiding those would make the harness silent about the very
// thing it knows.
export type CitationMarkStatus = "backed" | "backed_weak" | "mixed" | "partial" | "unread" | "uncovered" | "disputed";

/** Statuses that reach the Sources chip. Everything else is calibration data. */
const SHOWN_STATUS: ReadonlySet<CitationMarkStatus> = new Set(["backed", "disputed", "unread", "uncovered"]);

export interface CitationMark {
  status: CitationMarkStatus;
  /** Per citing line. `confidence` is carried so the `mixed` tooltip can name
   *  which line is sure and which is not. */
  claims: { claim: string; verdict: "supports" | "supports_in_part" | "says_nothing" | "contradicts" | "states_content"; confidence?: number | null }[];
  /**
   * Jev's confidence (0–1) in `status`. A ✓ is only as sure as its weakest
   * support; a ! is as sure as its clearest contradiction. Null when the
   * pairs that decided the status reported none.
   */
  confidence: number | null;
}

/** Which question produced the verdict. `record` is cite-metadata.ts (a change
 *  event or listing row); `content` is cite-support.ts (the document). Absent
 *  on rows stored before the field existed — those were document questions. */
export type CiteLane = "content" | "record";

interface JudgedPair {
  uuid: string;
  claim: string;
  verdict: MarkVerdict | null;
  /** Jev Choice confidence in `verdict`, 0–1. Absent on pairs stored before it was read back. */
  confidence?: number | null;
  lane?: CiteLane;
  /**
   * Set only on `contradicts`. `false` means confirm did not agree, or was
   * not asked (a record-lane contradiction, or confirm unavailable). Those
   * pairs stay on the stored row and do not enter the fold. Absent means a
   * row from before the field: a stored `contradicts` then had already passed
   * confirm, because a refusal was rewritten away.
   */
  confirmed?: boolean;
}

/** A contradiction confirm did not stand behind. It must not become ! or ⚠. */
function unconfirmedContradiction(p: JudgedPair): boolean {
  return p.verdict === "contradicts" && p.confirmed === false;
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
const DECIDING: Partial<Record<CitationMarkStatus, MarkVerdict[]>> = {
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
    // An unconfirmed contradiction is not a gap and not a dispute. Drop it
    // before the fold so it cannot paint either chip. The pair stays on `judged`.
    const live = pairs.filter((p) => !unconfirmedContradiction(p));
    if (live.length === 0) continue;
    if (live.some((p) => p.verdict === null)) continue;
    const claims = live
      .filter((p): p is JudgedPair & { verdict: "supports" | "supports_in_part" | "says_nothing" | "contradicts" | "states_content" } =>
        p.verdict === "supports" || p.verdict === "supports_in_part" || p.verdict === "says_nothing" ||
        p.verdict === "contradicts" || p.verdict === "states_content",
      )
      .map((p) => ({ claim: p.claim, verdict: p.verdict, confidence: citeConfidence(p.confidence) }));
    let status: CitationMarkStatus;
    if (live.some((p) => p.verdict === "contradicts")) status = "disputed";
    // Above `uncovered` on purpose: "you stated what this document says and
    // never read it" is more actionable than "the record doesn't cover this".
    else if (live.some((p) => p.verdict === "states_content")) status = "unread";
    else if (live.some((p) => p.verdict === "says_nothing")) status = "uncovered";
    else if (live.some((p) => p.verdict === "supports_in_part")) status = "partial";
    else if (live.some(documentSupport)) {
      // A `supports` from the RECORD question (a date, a PR number) is not
      // "this document states the line." Counting it here painted a ✓✓ on a
      // document the turn never read. The pair stays on `judged`.
      const supporting = live.filter(documentSupport);
      const sure = supporting.filter((p) => (citeConfidence(p.confidence) ?? 0) >= MIN_BACKED_CONFIDENCE).length;
      status = sure === supporting.length ? "backed" : sure === 0 ? "backed_weak" : "mixed";
    } else continue; // pointers, or support that only a record can give — nothing to mark
    out[uuid] = { status, claims, confidence: confidenceFor(status, live) };
  }
  return out;
}

/** Document-question support. A record-lane `supports` matches a change row,
 *  not the document's text, so it must not earn a ✓✓. */
function documentSupport(p: JudgedPair): boolean {
  return p.verdict === "supports" && p.lane !== "record";
}

/**
 * The marks a reader is allowed to see: a sure document match (✓✓), a
 * confirmed contradiction (!), and the two warnings (⚠) — a document that
 * does not cover a line citing it, and a line that states what a document
 * says when only a record about it was read. Every weak-confidence status is
 * kept on the stored
 * `judged` pairs and dropped here. Returns the same object when nothing is
 * hidden, so a turn that is already only those two allocates nothing.
 */
export function shownMarks(marks: Record<string, CitationMark>): Record<string, CitationMark> {
  const hidden = Object.values(marks).some((m) => !SHOWN_STATUS.has(m.status));
  if (!hidden) return marks;
  const out: Record<string, CitationMark> = {};
  for (const [uuid, mark] of Object.entries(marks)) {
    if (SHOWN_STATUS.has(mark.status)) out[uuid] = mark;
  }
  return out;
}

export interface CitationMarksRun {
  marks: Record<string, CitationMark>;
  /** Raw per-pair verdicts, for persistence (checksMeta), not the wire event. */
  judged: { uuid: string; claim: string; verdict: MarkVerdict | null; confidence: number | null; lane: CiteLane; confirmed?: boolean }[];
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
  /**
   * What this turn actually retrieved, per document uuid (verify/provenance.ts).
   * It picks the QUESTION, not whether to ask one:
   *
   *   content  — the model saw the document's text. "Does this document state
   *              the claim?", judged against the indexed document. A misquote.
   *   identity — the model saw only a record ABOUT the document: a change
   *              event, a listing row. The claim was never sourced from the
   *              document's content, so that question has no honest answer and
   *              returns "Not stated in this source" about a citation that was
   *              never sourcing content. Ask instead whether the claim reads
   *              its own record correctly (cite-metadata.ts). A misreading.
   *   missing  — the document was not retrieved this turn at all, so NO mark
   *              is produced and no request is made. We cannot check what we
   *              did not see, and saying so is the honest output: the system
   *              prompt already forbids linking a document the turn did not
   *              retrieve, so this is either a legitimate carry-over from an
   *              earlier turn (chat.ts replays history as {role, content}, so
   *              last turn's lookups leave no trace here) or a prompt
   *              violation. Neither is checkable.
   *
   * Omitting the map entirely is different from an empty one: no map means
   * provenance is not engaged and every pair takes the content question, which
   * is what the tests and any caller predating this do.
   */
  provenance?: Map<string, DocProvenance>;
  obs?: ErrorContext;
}): Promise<CitationMarksRun> {
  try {
    // A citation to a document this turn never retrieved is dropped before any
    // request: see `provenance` above. Only when a map was supplied — without
    // one, provenance is not engaged and nothing is filtered.
    const pairs: CitationPair[] = citationPairs(p.answer)
      .filter((pair) => p.ix.docMap.has(pair.uuid))
      .filter((pair) => !p.provenance || p.provenance.has(pair.uuid));
    if (pairs.length === 0) return EMPTY;

    const t0 = Date.now();
    const deadlineMs = p.deadlineMs ?? 8000;
    const signal = withDeadline(deadlineMs, p.signal);

    const results: { pair: CitationPair; verdict: MarkVerdict | null; confidence: number | null; costUsd: number | null; lane: CiteLane; confirmed?: boolean }[] = new Array(
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
        const prov = p.provenance?.get(pairs[i].uuid);
        const lane: CiteLane = prov?.kind === "identity" ? "record" : "content";
        const j =
          lane === "record"
            ? await judgeMetadata({ claim: pairs[i].claim, record: prov!.record, model: p.model, signal })
            : await judgeCitation({ pair: pairs[i], ix: p.ix, model: p.model, signal });
        if (j.verdict === null) failed++;
        if (j.costUsd) costUsd += j.costUsd;
        results[i] = { pair: pairs[i], verdict: j.verdict, confidence: j.confidence, costUsd: j.costUsd, lane };
      }
    };
    const workerCount = Math.min(p.concurrency ?? 6, pairs.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    // Content-lane `contradicts` goes through confirm against the document —
    // same discipline the whole-turn verifier applies before a hard fail.
    // A record-lane `contradicts` does not: the evidence confirm would see is
    // the document, and the question was about the change record. Showing
    // that pair as "doesn't cover" was confirm disagreeing with evidence it
    // was never given. It stays `contradicts`, unconfirmed, and unmarked.
    const contraIndexes: number[] = [];
    const candidates: Contradiction[] = [];
    results.forEach((r, i) => {
      if (r.verdict !== "contradicts") return;
      if (r.lane === "record") {
        results[i] = { ...r, confirmed: false };
        return;
      }
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
      // nothing) keeps the original verdict. The confidence was Jev's
      // confidence in `contradicts`; it stays, and `confirmed: false` is what
      // keeps the pair off the chip.
      contraIndexes.forEach((resultIndex, candidateIndex) => {
        results[resultIndex] = { ...results[resultIndex], confirmed: run?.agreed.has(candidateIndex) ?? false };
      });
    }

    const judged = results.map((r) => ({
      uuid: r.pair.uuid,
      claim: r.pair.claim,
      verdict: r.verdict,
      confidence: r.confidence,
      lane: r.lane,
      ...(r.confirmed === undefined ? {} : { confirmed: r.confirmed }),
    }));
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
