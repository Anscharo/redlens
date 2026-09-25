// Same-origin API helper. The Bun server mounts the API at the origin ROOT
// (it matches `pathname === "/api/chat"` etc.), so API calls hit "/api/…".
// The app's base is "/" (Railway serves from the domain root), and in dev vite
// proxies "/api" → the Bun server (:3000).
export function apiUrl(path: string): string {
  return `/api/${path.replace(/^\/+/, "")}`;
}

// Mirrors the server's HarnessEvent union (src/server/chat/chat-orchestrator.ts —
// ChatEvent plus the reliability-harness `status`/`verify_result` events) and
// the `meta`/`error` envelope events emitted by the route (src/server/chat/chat.ts).
export type VerifyOverall = "pass" | "warn" | "fail" | "unverified";

// A statement the verifier's evidence contradicts (server: chat/verify — the
// refutation-only design). `uuid` is the cited/relevant doc when the auditor
// could resolve one, else null. Only AGREED contradictions (a second
// `confirm` auditor independently agreed) reach the wire — the confirm gate
// is a hard gate, so a candidate it did not agree with is dropped server-side
// and never reaches the client at all.
export interface VerifyContradiction {
  answer: string; // the sentence/statement from the answer being disputed
  evidence: string; // the quoted evidence span that contradicts it
  why: string; // the auditor's stated reason
  uuid: string | null;
}

// A wrong stated value for a known atlas parameter (server:
// verify/param-checks.ts). Structured rather than a sentence so the badge can
// link the parameter's document and show the reader-facing `title` instead of
// the terse extracted kv key in `name`.
export interface ParamMismatch {
  stated: string; // the number as the answer wrote it
  actual: string; // our extraction's value, unit-formatted
  name: string; // extracted kv key — machine vocabulary, not for display
  title: string; // containing doc's title — this is what to show
  owner: string | null;
  uuid: string;
  doc_no: string;
}

// Per-source-doc verdict from the post-answer citation check (server: judges
// each (claim, cited doc) pair against that doc). Keyed by doc uuid on the
// wire (see the `citation_marks` event below) — one entry per cited doc that
// was actually checked; an uncited/unchecked doc gets no entry at all, which
// the Sources chip renders as no mark rather than as any particular verdict.
export interface CitationMark {
  // What the chip draws: ✓✓ sure, ✓ unsure, ✓⚠ backs the line with a caveat,
  // ⚠ the document does not cover a line citing it, ! a contradiction.
  // See src/server/chat/verify/citation-marks.ts for how one is chosen.
  status: "backed" | "backed_weak" | "mixed" | "partial" | "uncovered" | "disputed";
  // `supports_in_part` (2026-09-24): the document states one of a compound
  // claim's assertions outright and says nothing about the rest.
  // `confidence` is per citing line, so the `mixed` tooltip can name which
  // line the source backs surely and which only weakly.
  claims: { claim: string; verdict: "supports" | "supports_in_part" | "says_nothing" | "contradicts"; confidence?: number | null }[];
  /** 0–1 confidence in `status`, null where one number cannot describe it —
   *  `mixed`, `partial` and `uncovered` name their citing lines instead. */
  confidence?: number | null;
}

// "Did it answer the question?" (server: verify/answer-coverage.ts) — one
// ruling per turn over the question and the finished answer. `answers` is the
// quiet default: the client shows nothing extra for it. `missingParts` are
// parts of the user's own question the answer did not address (only ever set
// alongside `answers`/`declines`); `parts` lists every judged part, present
// only when the question was split into two or more.
export type AnswerCoverageVerdict = "answers" | "declines" | "deflects" | "asks";
export interface AnswerCoverage {
  verdict: AnswerCoverageVerdict;
  missingParts: string[];
  parts?: string[];
}

// The streaming-vs-staged delivery split is gone: every token/clear is always
// forwarded, and the orchestrator emits `status{stage:"synthesizing"}` once
// per generation burst plus `answer_final` after citation repair (before
// checking/verify_result/done). Stage vocabulary below.
export type Stage =
  | "recalling"
  | "querying"
  | "synthesizing"
  | "comparing"
  | "checking";

export type ChatEvent =
  | { type: "meta"; conversationId: string; tier?: string }
  | { type: "token"; text: string }
  // Incremental reasoning/"thinking" delta — interleaved with the rest of
  // the stream. Never part of the answer: useChatStream accumulates it onto
  // ChatMsg.reasoning, never `content`/`draft`.
  | { type: "reasoning"; text: string }
  | {
      type: "clear";
      // Why the live buffer is being replaced. Optional for back-compat.
      //   - tool_round / absent reason — the round produced text AND tool
      //     calls. The client keeps remaining prose as an unverified draft
      //     (not struck) and folds leaked tool-call markup into thinking.
      //   - degenerate — a repetition loop; the client still wipes.
      reason?: "tool_round" | "degenerate";
    }
  // A deterministic per-paragraph audit result — the incremental pass that
  // runs while the answer streams (a per-paragraph MODEL audit runs
  // concurrently — see `paragraph_refute` below). Emitted right after the
  // token that completes a paragraph, plus once more at generation end for
  // the trailing paragraph, before `answer_final`. Ordering within a
  // generation burst: token* (paragraph_check | paragraph_refute)* …
  // answer_final — a `paragraph_refute` for a given index may arrive before
  // or after its `paragraph_check` (the model call races the deterministic
  // one). `index` counts from 0 within the current burst and resets on
  // `tool_call`/`clear`. `text` is the checked paragraph (citation-repaired).
  // `findings` are reader-facing sentences, `[]` when clean.
  | { type: "paragraph_check"; index: number; text: string; findings: string[] }
  // The model's `refute` audit result for one paragraph, submitted right
  // after that paragraph's `paragraph_check` and reported when it resolves —
  // may land before or after the matching `paragraph_check` event.
  // `parsed:false` means the model call failed or timed out for this
  // paragraph. `candidates` is the count of contradiction candidates the
  // model asserted that survived code-span validation — they still have to
  // clear the confirm gate before affecting the verdict, so this is "under
  // review", not a verdict.
  | { type: "paragraph_refute"; index: number; parsed: boolean; candidates: number }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; bytes: number; truncated?: boolean; originalBytes?: number }
  // A downloadable file the agent produced via the export_findings tool.
  // `content` is the whole file; the client auto-downloads it and keeps a
  // button to re-download (see useChatStream `export` case).
  | { type: "export"; format: "markdown" | "csv"; filename: string; mime: string; content: string; bytes: number }
  | { type: "status"; stage: Stage; detail?: string }
  // Deterministic knowledge the server injected before the model ran (glossary
  // definitions, entity rows, censuses, app documentation — src/server/facts).
  // One entry per fact that fired, already phrased for the reader.
  | { type: "facts"; facts: { id: string; summary: string }[]; bytes?: number }
  // The final answer text, after deterministic citation repair, emitted once
  // per turn BEFORE checking/verify_result/done — rewrites are gone, so this
  // content is final. If the server took an early exit, no `answer_final`
  // arrives and `done` is the reveal instead.
  | { type: "answer_final"; content: string }
  // Post-answer citation check: one entry per cited doc the server actually
  // judged against its content, keyed by doc uuid. Arrives after
  // `answer_final` and before `verify_result`/`done` — may never arrive at
  // all (feature off, no citations, timeout), in which case no source chip
  // gets a mark.
  | { type: "citation_marks"; marks: Record<string, CitationMark> }
  // Answer-coverage ruling (see AnswerCoverage above). Arrives at most once,
  // after `answer_final` (and after `citation_marks`) and before
  // `verify_result`/`done` — may never arrive at all (feature off, the check
  // failed or timed out, small talk), in which case nothing is shown.
  | ({ type: "answer_coverage" } & AnswerCoverage)
  | {
      type: "verify_result";
      overall: VerifyOverall;
      // Contradictions both auditors agreed on — these drive `fail`. An
      // unagreed candidate never reaches this array or the wire at all; it
      // survives only in the persisted Verdict (message_checks.verdict) as
      // the confirm gate's calibration record.
      contradictions: VerifyContradiction[];
      // Statements the auditor could not locate in evidence at all, capped at
      // The answer issued a ruling/verdict instead of reporting what the
      // atlas says (the `overreach` auditor). Optional for the same reason.
      rulingIssued?: boolean;
      invalidCitations: string[];
      invalidDocNos: string[];
      docNoMismatches: string[];
      ungroundedQuotes: string[];
      ungroundedAddresses: string[];
      // Hard failures too — optional only so an older server that predates
      // them still parses. Absent is treated as empty/false, never as "clean".
      ungroundedCitationValues?: string[];
      paramMismatches?: ParamMismatch[];
      completenessFailures?: string[];
      missingExternalDisclaimer?: boolean;
      mscCitedAsAtlas?: string[];
  // The answer hit the output-token cap mid-generation. Not a citation
      // problem, but it forces a `fail` server-side, so the badge has to be
      // able to say so.
      lengthCapped?: boolean;
    }
  | {
      type: "done";
      content: string;
      usage: { input: number; output: number };
      generationId: string | null;
      toolCalls: ToolCallRecord[];
      // True context size of the turn (last llm round's prompt_tokens).
      // Optional so an older server (pre this field) still parses.
      contextTokens?: number | null;
    }
  | { type: "error"; message: string };

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  bytes: number;
  truncated?: boolean;
  originalBytes?: number;
}

export interface AuthUser {
  id: string;
  name: string | null;
  avatarUrl: string;
  provider: string;
  email: string | null;
}

export interface UsageWindow {
  tokens: number;
  limit: number;
  resetsAt: string; // ISO timestamp
  exceeded: boolean;
  windowMinutes: number;
  // True when `limit` is the boosted tier rather than the base one — a GitHub
  // login on RATE_LIMIT_BOOST_LOGINS (server: rate-limit.ts). Optional so an
  // older server that predates the tier still parses; absent means base.
  boosted?: boolean;
}

// The shared "commons" dollar pool — one account-wide balance shown to every
// signed-in user (src/server/chat/credits.ts). Omitted from /api/usage when the
// feature is off or the credits API is unreachable.
export interface CommonsPool {
  used: number; // dollars spent account-wide
  total: number; // dollars purchased (pool size)
  remaining: number; // total - used, floored at 0
}
