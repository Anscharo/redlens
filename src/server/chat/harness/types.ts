// The harness's wire events and persisted check rows. chat-orchestrator.ts
// re-exports the public ones, so importers keep reading them from there.
import type OpenAI from "openai";
import type { ChatEvent, ChatStream } from "../chat-loop.ts";
import type { JsonCall } from "../llm.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ErrorContext } from "../../posthog-node.ts";
import type { VerifyOverall } from "../verify/verifier.ts";
import type { ParamMismatch } from "../verify/param-checks.ts";
import type { CitationMark } from "../verify/citation-marks.ts";
import type { CoverageVerdict } from "../verify/answer-coverage.ts";

export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type DoneEvent = Extract<ChatEvent, { type: "done" }>;

export interface VerifiedChatOpts {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  jsonCall?: JsonCall;
  question: string;
  signal?: AbortSignal;
  maxIterations?: number;
  obs?: ErrorContext;
}

export interface CheckRowMeta {
  // `message_checks.kind` is plain TEXT with no CHECK constraint (migration 014),
  // so this union is the only vocabulary and a new kind needs no migration.
  kind: "round_checks" | "verify" | "smalltalk_judge" | "citation_check" | "answer_coverage" | "quote_attribution";
  model: string | null;
  verdict: unknown;
  overall: VerifyOverall | null;
  inputTokens: number | null;
  outputTokens: number | null;
  generationId: string | null;
  latencyMs: number | null;
}

export type HarnessEvent =
  | ChatEvent
  // "querying" fires per tool call; "synthesizing" fires once per generation
  // burst (the run of tokens since the last tool_call, or since the stream
  // started) right before its first token; "comparing"/"checking" bracket the
  // post-answer audit. All four are real progress the client renders as
  // a stage checklist.
  | { type: "status"; stage: "querying" | "checking" | "comparing" | "synthesizing"; detail?: string }
  // Emitted once, right after deterministic repair succeeds — done.content is
  // final past this point (rewrites are gone), so the client reveals the
  // answer here and lets the verify badge trail. Not emitted on the
  // config-off/aborted/empty-content early exit; the client falls back to
  // revealing on `done` there.
  | { type: "answer_final"; content: string }
  // Per-cited-doc Sources-chip mark (verify/citation-marks.ts) — emitted once,
  // after `answer_final` and before `verify_result`/`done`, only when at least
  // one citation was judged. Keyed by uuid; a doc with no key gets no chip
  // change (nothing was judged for it, or its only citations were pointers).
  | { type: "citation_marks"; marks: Record<string, CitationMark> }
  // "Did it answer the question?" (verify/answer-coverage.ts) — emitted at
  // most once, after `answer_final` (and after `citation_marks`) and before
  // `verify_result`/`done`. `verdict` is thresholded, not Jev's argmax:
  // `answers` is the quiet default. `missingParts` names question parts the
  // reply did not address (only on answers/declines); `parts` lists every
  // judged part, present only for a question code split into ≥2 parts.
  | { type: "answer_coverage"; verdict: CoverageVerdict; missingParts: string[]; parts?: string[] }
  // Deterministic checks (docs/chat-system.md §6) run against EACH paragraph
  // as it completes during streaming, not just once over the finished answer
  // — the substrate for a per-paragraph MODEL audit. `index` counts
  // from 0 within the current generation burst and resets on `tool_call`/
  // `clear` (the buffered draft is being set aside). `text` is the paragraph
  // as checked: citation-repaired, reference-style links expanded. `findings`
  // mirrors the wording of the whole-answer badge (verify/incremental.ts's
  // describeFindings), empty when the paragraph is clean. Emitted once more
  // at generation end for the trailing paragraph, before `answer_final`. The
  // full-text pass after `done` remains the authority — it alone owns
  // completeness, the external disclaimer, and the length cap.
  | { type: "paragraph_check"; index: number; text: string; findings: string[] }
  // CHAT_REFUTE_MODE="paragraph" (the default, docs/chat-system.md §6.1): one
  // per paragraph once its `refute` model call lands — during streaming when
  // it lands in time, or right before `verify_result` for whatever is still
  // outstanding at generation end. `parsed:false` means the model call failed
  // or timed out for that paragraph, not that it found nothing.
  | { type: "paragraph_refute"; index: number; parsed: boolean; candidates: number }
  | {
      type: "verify_result";
      overall: VerifyOverall;
      // AGREED contradictions only — refute + an independent confirm call both
      // read the evidence as incompatible with the answer. Drives `overall`
      // "fail" on its own. A candidate the confirm judge did NOT agree with
      // never reaches this wire — it stays only in the persisted Verdict
      // (message_checks.verdict) as the confirm gate's calibration record.
      contradictions: { answer: string; evidence: string; why: string; uuid: string | null }[];
      rulingIssued: boolean;
      invalidCitations: string[];
      invalidDocNos: string[];
      docNoMismatches: string[];
      ungroundedQuotes: string[];
      ungroundedAddresses: string[];
      // These three are HARD failures too (verify-checks.ts's `failed`, plus
      // repairedChecks' lengthCapped fold), so they must reach the
      // client: each can be the ONLY finding on a turn, and without it the
      // badge shows an unexpandable red chip that says the answer failed and
      // then cannot say why. Every input to `failed` belongs on this wire.
      ungroundedCitationValues: string[];
      paramMismatches: ParamMismatch[];
      completenessFailures: string[];
      missingExternalDisclaimer: boolean;
      mscCitedAsAtlas: string[];
      lengthCapped: boolean;
    };

export type HarnessDone = DoneEvent & { checksMeta: CheckRowMeta[] };
