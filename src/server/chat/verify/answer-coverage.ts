// "Did it answer the question?" (docs/plans/jev-typesafe.md §2 / §A2): ONE Jev
// request over { question, answer } after `answer_final`. A Choice rules how
// the reply responds — answers / declines / deflects / asks — and, when code
// splits the question into ≥2 parts (question-parts.ts), one Noul per part
// says whether that part was addressed, so a dropped part can be NAMED.
// Annotate-only and fail-open: any failure returns null, which means "say
// nothing", never a warning. Question wording: answer-coverage-questions.ts.
import { askJev, choiceOf, noulOf, withDeadline } from "../../jev.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import { splitQuestionParts } from "./question-parts.ts";
import { partQuestion, RESPONDS_QUESTION } from "./answer-coverage-questions.ts";


export type CoverageVerdict = "answers" | "declines" | "deflects" | "asks";

// Thresholds — every one from the 2026-09-22 re-run of this exact request
// (buildCoverageRequest below) over the research corpus: 311 distinct real
// (question, answer) pairs from our own eval material + 28 gold announcement
// strings × 3 real questions. IN-SAMPLE (tuned on the same pairs after
// reading the first run), and there has been NO real-traffic false-fire pass.
//
// A ruling that produces a line must clear a floor, not merely win the
// argmax: the line tells the user something about their answer, so it is only
// said when Jev is sure. Below every floor the ruling falls to the quiet
// default (`answers`), which renders nothing.
//
// NON-ANSWER = P(deflects) + P(asks). The two split their mass on the
// boundary between narration and a question back ("Let me get more specific
// information about the individual multisigs' signers and thresholds:" came
// back 0.54 / 0.46), so each alone has a knife-edge margin while their SUM is
// cleanly separated: every real answer ≤ 0.05, every real non-answer ≥ 0.76,
// every gold announcement ≥ 0.99 (84/84 announcement × question pairs — 28
// strings × 3 questions, 12 strings phrased around the announcement regexes).
// Which of the two it is, is then the larger.
export const NON_ANSWER_MIN = 0.5;
// `declines` scores 0.50–0.79 on MIXED replies — content delivered plus a
// note that part isn't recorded (a Pioneers table with "not specified"
// cells) — and ≥ 0.84 where the gap IS the reply. The line would misdescribe
// the first kind, so it waits for the second. The cost: ~22 honest gap
// replies (e.g. "no Atlas Axis team is recorded", 0.53–0.69) show nothing.
export const DECLINES_MIN = 0.8;
// A part is reported as not addressed only below this. The one confirmed
// drop (a token ledger with no dates, part "when") scored 0.17 and 0.19 on the
// two runs; the lowest part that was NOT a drop scored 0.48 (a reply saying no
// Pioneers are listed at all, part "when did they gain that status"), and a
// nearby-set answer moved 0.41 → 0.55 between runs, so ±0.1 is run-to-run
// noise in that band. 0.35 sits mid-gap. One confirmed drop is thin evidence:
// this errs toward saying nothing.
export const PART_MISSING_BELOW = 0.35;
// Bounds the request: each part is its own Noul. Parts past this are not
// judged (and so never reported missing).
export const MAX_PARTS = 8;
// Jev's window is 32k tokens; measured ~0.31 tokens/char, and the largest
// stripped state in the corpus was 4.3k tokens. This cap only bites a runaway.
const ANSWER_CHAR_CAP = 60_000;

// Link targets are pure token cost for this judgment (input p50 1578 → 1288
// tokens); the research's stripped arm agreed with the unstripped one on
// 309/311 answers.
export const stripLinkTargets = (s: string) => s.replace(/\]\((?:[^()]|\([^()]*\))*\)/g, "]");

/** The exact request production sends — the offline re-run imports it too, so the two can't diverge. */
export function buildCoverageRequest(question: string, answer: string) {
  const split = splitQuestionParts(question);
  const parts = split.length >= 2 ? split.slice(0, MAX_PARTS) : [];
  const questions: Record<string, typeof RESPONDS_QUESTION | ReturnType<typeof partQuestion>> = { responds: RESPONDS_QUESTION };
  parts.forEach((p, i) => (questions[`part_${i}`] = partQuestion(p)));
  const state = { question: question.slice(0, 2000), answer: stripLinkTargets(answer).slice(0, ANSWER_CHAR_CAP) };
  return { state, questions, parts };
}

// A tool-call payload shipped as the answer: a JSON object, a JSON array of
// objects/strings, or DeepSeek's DSML tool-call markup (fullwidth bars,
// U+FF5C). Deliberately NOT "starts with `[`": a markdown answer can open
// with a link. Load-bearing, not a nicety: Jev alone ruled `{"id": [...]}`
// `answers` (0.54) — only the DSML payload did it catch on its own (0.86).
const RAW_TOOL_OUTPUT_RE = /^\s*(?:\{\s*"|\[\s*[{"])|<\uFF5C\uFF5CDSML/;
export const looksLikeRawToolOutput = (answer: string) => RAW_TOOL_OUTPUT_RE.test(answer);

export function coverageVerdict(p: Record<string, number>): CoverageVerdict {
  const deflects = p.deflects ?? 0;
  const asks = p.asks ?? 0;
  if (deflects + asks >= NON_ANSWER_MIN) return deflects >= asks ? "deflects" : "asks";
  if ((p.declines ?? 0) >= DECLINES_MIN) return "declines";
  return "answers";
}

export interface AnswerCoverage {
  verdict: CoverageVerdict;
  /** The Choice's raw distribution; null on the raw-tool-output short-circuit (no call made). */
  probabilities: Record<string, number> | null;
  /** One entry per judged part; [] for a single-part question. `p` null = that Noul came back malformed. */
  parts: { text: string; p: number | null }[];
  /** Parts below PART_MISSING_BELOW. Only for `answers`/`declines` — a non-answer already says it all. */
  missingParts: string[];
  rawToolOutput: boolean;
  usage: { input: number; output: number } | null;
  costUsd: number | null;
  generationId: string | null;
  latencyMs: number;
}

export async function judgeAnswerCoverage(params: {
  question: string;
  answer: string;
  model: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  obs?: ErrorContext;
}): Promise<AnswerCoverage | null> {
  const t0 = Date.now();
  if (looksLikeRawToolOutput(params.answer)) {
    return {
      verdict: "deflects", probabilities: null, parts: [], missingParts: [], rawToolOutput: true,
      usage: null, costUsd: null, generationId: null, latencyMs: Date.now() - t0,
    };
  }
  // The deadline is owned HERE and handed down as a signal — askJev's own
  // timeoutMs is per attempt and it retries a 5xx with backoff, so on its own
  // a "4s" call could run ~20s (same division as smalltalk-jev.ts).
  const deadlineMs = params.deadlineMs ?? 4000;
  const signal = withDeadline(deadlineMs, params.signal);
  try {
    const { state, questions, parts } = buildCoverageRequest(params.question, params.answer);
    const run = await askJev({ state, questions, model: params.model, signal, timeoutMs: deadlineMs });
    const choice = choiceOf(run, "responds");
    if (!choice) return null; // wrong answer type — a question-definition bug, not a ruling
    const verdict = coverageVerdict(choice.probabilities);
    const judged = parts.map((text, i) => ({ text, p: noulOf(run, `part_${i}`) }));
    // A non-answer scores every part low (≤ 0.10 on the announcements), so
    // naming them would only repeat "didn't answer" part by part.
    const missingParts =
      verdict === "answers" || verdict === "declines"
        ? judged.filter((j) => j.p !== null && j.p < PART_MISSING_BELOW).map((j) => j.text)
        : [];
    return {
      verdict, probabilities: choice.probabilities, parts: judged, missingParts, rawToolOutput: false,
      usage: run.usage, costUsd: run.cost, generationId: run.generationId, latencyMs: Date.now() - t0,
    };
  } catch (err) {
    captureError(err, params.obs, { stage: "answer_coverage", model: params.model });
    return null;
  }
}
