import type { ParamMismatch, ToolCallRecord, VerifyContradiction, VerifyOverall } from "./api";

// Shared ChatMsg/trace/verify shape, split out of useChatStream.ts so
// applyEvent.ts (pure event-application logic) and useChatStream.ts (the
// stateful hook) can both import it without a cycle. useChatStream.ts
// re-exports every symbol here so existing `from "./useChatStream"` imports
// keep working.

export interface TraceRow {
  name: string;
  args: Record<string, unknown>;
  ok: boolean | null; // null until the matching tool_result arrives
  bytes: number | null;
  // "fact" rows are knowledge the server injected before the model ran (no call
  // to pair with a result, so they arrive already resolved). `summary` is the
  // server's reader-facing phrase for what it contributed.
  kind?: "tool" | "fact";
  summary?: string;
  // The turn's `rounds` value at the moment this row was appended (0 before
  // the first tool call; fact rows are always 0 — they run before round 1).
  round: number;
}

// Reliability-harness verdict for one assistant message. "checking" while the
// audit is in flight. Refutation-only: the verifier never says what the
// answer got right, only what the evidence contradicts — `contradictions`
// (agreed by both auditors) drive `fail`, `rulingIssued` drives `warn`, and
// `notFound` is informational only. A contradiction candidate the confirm
// judge did NOT agree with never reaches this state at all — the confirm
// gate is hard, and the unagreed candidate survives only in the persisted
// Verdict (message_checks.verdict) as calibration data.
export interface VerifyState {
  status: VerifyOverall | "checking";
  contradictions: VerifyContradiction[];
  notFound: string[];
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

// One paragraph's deterministic audit result (server: `paragraph_check`,
// api.ts), plus the model audit's state once it resolves (server:
// `paragraph_refute`). Reader-facing `findings` are already phrased
// sentences, `[]` when the paragraph is clean.
//
// `model` states:
//   - "pending"   — submitted, no result yet. Set when `paragraph_check`
//                   lands, since the server submits the model call right
//                   after emitting that event.
//   - "ok"        — the model call parsed and found 0 candidates.
//   - "candidate" — the model call parsed and found >=1 contradiction
//                   candidate, still under review by the confirm gate.
//   - "failed"    — the model call failed or timed out for this paragraph.
// Absent only before any `paragraph_check`/`paragraph_refute` has landed for
// the index (should not happen in practice — see applyEvent).
export interface ParagraphCheck {
  index: number;
  text: string;
  findings: string[];
  model?: "pending" | "ok" | "candidate" | "failed";
}

// A downloadable file the agent produced this session via export_findings.
// Auto-downloaded on arrival; kept on the message so the reply can offer a
// re-download button. Live-session only — not persisted across reloads.
export interface ExportArtifact {
  format: "markdown" | "csv";
  filename: string;
  mime: string;
  content: string;
  bytes: number;
}

// One row per distinct stage the harness has entered, in arrival order. `at`
// is the entry's position in stageLog, not a wall-clock timestamp — keeps
// render output deterministic (see CLAUDE.md deterministic-builds convention,
// which this mirrors for UI state even though it isn't a build artifact).
//
// Product rule: anything shown to the reader in the chat must never
// disappear. `details` accumulates every distinct detail line the stage
// reported, in arrival order — a later status event for the same stage
// (e.g. each tool call's `querying` line) APPENDS rather than replacing, and
// the whole list stays rendered after the row is done, not just while it is
// active.
export interface StageLogEntry {
  stage: string;
  details: string[];
  at: number;
  // The turn's `rounds` value at the moment this row was appended.
  round: number;
}

// One draft the turn showed the reader and then replaced. `reason` mirrors the
// server's `clear.reason` (chat-loop.ts): `tool_round` = prose the model set
// aside to go on searching (it may have been written from atlas data already
// retrieved, or before any — the clear fires on any round that produced both
// text and tool calls). Leaked tool-call markup in that same buffer is stripped
// out and appended to `reasoning` instead — it is thinking, not a draft.
// There is deliberately no `degenerate` member — that clear is the one that
// genuinely deletes (see applyEvent).
export interface SupersededDraft {
  text: string;
  reason: "tool_round";
  // The turn's `rounds` value at the moment this draft was superseded.
  round: number;
  // The paragraph checks that had landed for this draft before it was set
  // aside. A set-aside draft keeps its marks — nothing shown is ever
  // removed, same rule as the draft text itself. Absent/[] when none had
  // landed yet.
  checks?: ParagraphCheck[];
}

export interface ChatMsg {
  role: "user" | "assistant";
  // FINAL answer text. Set only by `answer_final` or `done` — empty before
  // either arrives. Never mutated by `token`; see `draft`.
  content: string;
  // Live token buffer while the model is generating. Accumulates `token`
  // deltas; cleared the moment the answer is revealed (`answer_final` or
  // `done`) or discarded (`clear`).
  draft: string;
  // True once the answer has been revealed (`answer_final`, or `done` when
  // no `answer_final` preceded it — an early exit). The signal the UI uses
  // to swap the live draft view for the final rendered answer.
  generated: boolean;
  trace: TraceRow[];
  rounds: number;
  sources: ToolCallRecord[]; // authoritative tool calls from `done`
  done: boolean;
  verify?: VerifyState;
  statusLine?: string | null; // transient harness status ticker (streaming only)
  // Set when the turn ended via the SSE "error" event or a fetch/read
  // exception (never for the 429 path, which finalizes with its message as
  // `content` instead). Lets the UI distinguish "no answer because it broke"
  // from a genuinely empty response.
  failed?: boolean;
  exports?: ExportArtifact[]; // files handed to the user this session (live only)
  // Accumulated model "thinking" text from `reasoning` deltas. Rendered above
  // the answer (ReasoningBlock), separately from `content` so it never gets
  // treated as answer prose (markdown, citations, verification). Live-session
  // only — not persisted (hydrate.ts never sets it), same as `exports`.
  reasoning?: string;
  // Every draft this turn streamed to the reader and then moved on from, in
  // arrival order. NOTHING the reader has seen is ever deleted (beta feedback:
  // "text shown to user to never be deleted just restyled … i just saw text
  // disappear from under my eyes") — a `clear` moves the live buffer here and
  // the replacement renders BELOW it, rather than the text vanishing. Carries
  // its `reason` so the UI can say WHY each block stopped being the answer.
  // Live-session only — not persisted, same as `exports`.
  superseded?: SupersededDraft[];
  // Progress checklist (populated on every live turn; hydrated/persisted
  // messages predate it and never need it — send() seeds [] on live turns;
  // readers `?? []`).
  stageLog?: StageLogEntry[];
  // Deterministic per-paragraph audit results for the CURRENT live draft, in
  // index order. Reset to [] on `clear` (a set-aside draft's checks move onto
  // its SupersededDraft.checks first). Live-session only — not persisted,
  // same as `exports`/`reasoning`.
  paragraphChecks?: ParagraphCheck[];
}
