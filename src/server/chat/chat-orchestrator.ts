// Chat reliability harness orchestrator (docs/chat-system.md §6).
// Wraps the pure runChat loop with: live status events, a streaming citation
// gate (invalid links repaired before their tokens reach the client),
// incremental per-paragraph deterministic checks (verify/incremental.ts —
// `paragraph_check` events as the answer streams), pipelined deterministic
// round checks over the finished answer, and a post-answer verifier audit
// (stream + badge — annotate-only, never gates or rewrites the answer).
// Unset model slots degrade to today's behavior; harness flakiness never breaks
// a turn. `transcript`/`checksMeta` are internal — the SSE route strips them
// via sanitizeDone before events reach a client.
import type OpenAI from "openai";
import { runChat, type ChatEvent, type RoundInfo } from "./chat-loop.ts";
import type { ChatStream } from "./chat-loop.ts";
import type { JsonCall } from "./llm.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { config } from "../config.ts";
import { createRoundChecker } from "./verify/round-checks.ts";
import { runDeterministicChecks, type CheckReport } from "./verify/verify-checks.ts";
import { findParamsMentioned, type ParamMismatch } from "./verify/param-checks.ts";
import type { CompletenessEvidence } from "./verify/completeness.ts";
import { createLinkJudge, displayText, repairCitations, repairDefinitionBlock, resolveLabelToUuid, type CitationRepair, type LinkJudge } from "./verify/citation-repair.ts";
import { expandReferenceLinks, type ReferenceExpansion } from "./verify/citation-normalize.ts";
import { repairIdentifierLeaks, type IdentifierRepair } from "./verify/identifier-leak.ts";
import { gatedChat } from "./verify/stream-link-gate.ts";
import { createCitationGate } from "./verify/definition-block-gate.ts";
import { isUncheckableAnswer, judgeSmalltalk } from "./verify/smalltalk.ts";
import { computeOverall, evidenceFromTranscript, priorTurnsEvidence, type EvidenceEntry, type Verdict, type VerifierRun, type VerifyOverall } from "./verify/verifier.ts";
import { runSlicedVerifier, sliceModels } from "./verify/sliced-verifier.ts";
import { createParagraphStream, type ParagraphEvidence } from "./verify/incremental.ts";
import { atlasDescribe } from "./tools/tools.ts";
import { isExternalMscTool } from "../external/envelope.ts";
import { captureError, captureEvent, type ErrorContext } from "../posthog-node.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type DoneEvent = Extract<ChatEvent, { type: "done" }>;

export interface CheckRowMeta {
  kind: "round_checks" | "verify" | "smalltalk_judge";
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
  // post-answer audit below. All four are real progress the client renders as
  // a stage checklist.
  | { type: "status"; stage: "querying" | "checking" | "comparing" | "synthesizing"; detail?: string }
  // Emitted once, right after deterministic repair succeeds — done.content is
  // final past this point (rewrites are gone), so the client reveals the
  // answer here and lets the verify badge trail. Not emitted on the
  // config-off/aborted/empty-content early exit; the client falls back to
  // revealing on `done` there.
  | { type: "answer_final"; content: string }
  // Deterministic checks (docs/chat-system.md §6) run against EACH paragraph
  // as it completes during streaming, not just once over the finished answer
  // — the substrate for a later per-paragraph MODEL audit. `index` counts
  // from 0 within the current generation burst and resets on `tool_call`/
  // `clear` (the buffered draft is being set aside). `text` is the paragraph
  // as checked: citation-repaired, reference-style links expanded. `findings`
  // mirrors the wording of the whole-answer badge (verify/incremental.ts's
  // describeFindings), empty when the paragraph is clean. Emitted once more
  // at generation end for the trailing paragraph, before `answer_final`. The
  // full-text pass after `done` remains the authority — it alone owns
  // completeness, the external disclaimer, and the length cap.
  | { type: "paragraph_check"; index: number; text: string; findings: string[] }
  | {
      type: "verify_result";
      overall: VerifyOverall;
      // AGREED contradictions only — refute + an independent confirm call both
      // read the evidence as incompatible with the answer. Drives `overall`
      // "fail" on its own. A candidate the confirm judge did NOT agree with
      // never reaches this wire — it stays only in the persisted Verdict
      // (message_checks.verdict) as the confirm gate's calibration record.
      contradictions: { answer: string; evidence: string; why: string; uuid: string | null }[];
      notFound: string[];
      rulingIssued: boolean;
      invalidCitations: string[];
      invalidDocNos: string[];
      docNoMismatches: string[];
      ungroundedQuotes: string[];
      ungroundedAddresses: string[];
      // These three are HARD failures too (verify-checks.ts's `failed`, plus
      // repairedChecks' lengthCapped fold below), so they must reach the
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

// The wire-safe done: internal evidence/persistence fields removed.
export function sanitizeDone(done: DoneEvent & { checksMeta?: CheckRowMeta[] }): Omit<DoneEvent, "transcript"> {
  const { transcript: _t, checksMeta: _c, ...wire } = done as DoneEvent & { checksMeta?: CheckRowMeta[] };
  return wire;
}

// Human-readable status detail off the tool args — zero model cost.
export function describeCall(name: string, args: Record<string, unknown>): string {
  if (name === "ask_external_msc" || name === "external_msc") {
    return "Consulting settlement sources (not Atlas)…";
  }
  const query = args.query;
  if (typeof query === "string" && query.length > 0) return `Searching the atlas for “${query.slice(0, 80)}”…`;
  if (name === "atlas_get") return "Reading documents…";
  return `Consulting ${name}…`;
}

// Copy for the verification stages. A turn can reach the audit with nothing
// retrieved — a meta-question, or a follow-up answered from the conversation —
// and "against 0 sources" reads as a broken counter rather than a state. A
// count is printed only when it is real; the call site suppresses the stage
// entirely when there is no basis to name at all (see `grounded`), so the
// sourceless branch here only ever describes conversation grounding.
function checkingDetail(citations: number, sources: number): string {
  const subject = citations > 0 ? `${citations} cited claim${citations === 1 ? "" : "s"}` : "the answer";
  if (sources > 0) return `Cross-checking ${subject} against ${sources} source${sources === 1 ? "" : "s"}…`;
  return `Cross-checking ${subject} against earlier turns of this conversation…`;
}

function verifyEvent(
  overall: VerifyOverall,
  verdict: Verdict | null,
  checks: CheckReport,
): Extract<HarnessEvent, { type: "verify_result" }> {
  const asWire = (c: { answer_span: string; evidence_span: string; why: string; uuid: string | null }) =>
    ({ answer: c.answer_span, evidence: c.evidence_span, why: c.why, uuid: c.uuid });
  const contradictions = verdict?.contradictions ?? [];
  return {
    type: "verify_result",
    overall,
    // Unagreed candidates are dropped here — the confirm gate is hard, so a
    // candidate the second judge did not agree with must never reach the wire.
    contradictions: contradictions.filter((c) => c.agreed).map(asWire),
    notFound: verdict?.not_found ?? [],
    rulingIssued: verdict?.ruling_issued ?? false,
    invalidCitations: checks.invalidCitations,
    invalidDocNos: checks.invalidDocNos,
    docNoMismatches: checks.docNoMismatches,
    ungroundedQuotes: checks.ungroundedQuotes,
    ungroundedAddresses: checks.ungroundedAddresses,
    ungroundedCitationValues: checks.ungroundedCitationValues,
    paramMismatches: checks.paramMismatches,
    completenessFailures: checks.completenessFailures,
    missingExternalDisclaimer: checks.missingExternalDisclaimer,
    mscCitedAsAtlas: checks.mscCitedAsAtlas,
    lengthCapped: checks.lengthCapped,
  };
}

// Reference-style citations — `[text][label]` plus a `[label]: /atlas/<uuid>`
// definition block — are expanded to the canonical inline form BEFORE repair
// and before the deterministic checks, so the whole checking layer keeps
// keying on one shape (docs/plans/reference-citations.md). Repair remains the
// authority; it simply operates on the canonical form, which it has to, since
// a garbled UUID in a reference answer lives in a definition line that is not
// a `[text](href)` link at all.
//
// The repaired result becomes done.content whenever it differs from what the
// model wrote — the comparison at each call site is against the ORIGINAL, not
// the normalized string, so a normalization-only fix still ships. That is a
// deliberate, narrow exception to the "streamed text and done.content must not
// disagree" guard below:
//   • today's inline-only answers normalize byte-identically, so this is a
//     strict no-op and the guard is untouched;
//   • a well-formed reference answer renders identically either way (remark
//     resolves reference links to the same <a href="/atlas/…"> and drops the
//     definition nodes), so the swap is invisible to the user;
//   • where the swap IS visible it is precisely the repair — the two measured
//     malformed shapes otherwise ship as literal brackets in the prose;
//   • and done.content is what the verifier, the Sources cluster and the
//     persisted message all read, so one canonical shape across those
//     consumers beats byte-fidelity to raw model output.
// Exported for the offline evals (scripts/aux/eval-bakeoff.ts), which must grade
// the string production would SHIP: a reference-style answer has no inline
// citations at all until this runs, so a checker fed the raw model output scores
// every well-formed reference answer as uncited.
export function normalizeAndRepair(content: string, toolTexts: string[], ix: Indexes): { refs: ReferenceExpansion; repair: CitationRepair; identifiers: IdentifierRepair } {
  // A used-but-undeclared label is resolved against this turn's retrieved docs
  // and synthesized as an inline link when it maps uniquely (undefined-label
  // degradation); unresolvable ones the normalizer strips to plain text and
  // reports, and the orchestrator folds those into a hard failure below.
  const judge = createLinkJudge(toolTexts, ix);
  const resolveLabel = (label: string): string | null => {
    const uuid = resolveLabelToUuid(label, judge);
    return uuid ? `/atlas/${uuid}` : null;
  };
  const refs = expandReferenceLinks(content, resolveLabel);
  const repair = repairCitations(refs.content, toolTexts, ix);
  // Last: internal machine handles pasted into prose as pseudo-citations
  // (`(Slug: grove-freezer-multisig)`) become real citations when the handle
  // names a doc retrieved this turn, and vanish otherwise. Folded into
  // repair.content because every call site swaps on that one string.
  const identifiers = repairIdentifierLeaks(repair.content, toolTexts, ix);
  return { refs, repair: { ...repair, content: identifiers.content }, identifiers };
}

// Reference bookkeeping for the checks row — observability only, never a
// verdict. The remaining `undefinedLabels` here are the ones that could NOT be
// resolved to a retrieved doc (the resolvable ones were already synthesized
// into inline links by normalizeAndRepair) and were de-linkified to plain text
// — recorded here, never a failure (the reader saw prose, not a bad link).
// `undefined` so the key vanishes from the persisted JSON on the
// overwhelmingly common turn that uses no reference syntax at all.
function refsMeta(r: ReferenceExpansion) {
  if (r.definitions.size + r.undefinedLabels.length + r.unusedLabels.length === 0) return undefined;
  return { definitions: r.definitions.size, undefinedLabels: r.undefinedLabels, unusedLabels: r.unusedLabels };
}

// Same bookkeeping shape for leaked machine handles: observability only (the
// leak is already gone from the shipped text), `undefined` so the key vanishes
// from the persisted JSON on the turns — nearly all of them — with no leak.
function identifiersMeta(i: IdentifierRepair) {
  if (i.linkified.length + i.removed.length === 0) return undefined;
  return { linkified: i.linkified, removed: i.removed };
}

// Repair the answer's atlas links in code. A link the repair could not
// resolve is de-linkified (stream-link-gate.ts did the same to the token
// stream), so the reader never sees it — and the checks judge what the reader
// sees: a stripped link is NOT folded back in as a failure. It used to be
// ("a fabricated citation is still a fabrication"), which produced a red
// badge naming a doc that appeared nowhere in the shipped answer (observed
// 2026-09-10: "cites a document that does not exist: a2e7af9" under an answer
// with no such link). The strip is still recorded on the round_checks row for
// calibration. Unresolvable reference labels (de-linkified to plain text by
// the normalizer) are treated identically. Only a length-capped answer (cut
// off mid-generation) still forces `failed`: the reader sees the truncation.
function repairedChecks(
  content: string,
  toolTexts: string[],
  ix: Indexes,
  lengthCapped: boolean,
  completeness?: { question: string; evidence: CompletenessEvidence[] },
  split?: { atlasTexts?: string[]; externalTexts?: string[] },
): CheckReport {
  const checks = runDeterministicChecks(content, toolTexts, ix, completeness, split);
  if (!lengthCapped) return checks;
  return { ...checks, lengthCapped, failed: true };
}

const toolTextsOf = (transcript: Msg[]): string[] =>
  transcript.filter((m) => m.role === "tool" && typeof m.content === "string").map((m) => m.content as string);

function splitFromTranscript(transcript: Msg[]): { atlasTexts: string[]; externalTexts: string[] } {
  const entries = evidenceFromTranscript(transcript, 500_000);
  return {
    atlasTexts: entries.filter((e) => e.sourceClass !== "external").map((e) => e.content),
    externalTexts: entries.filter((e) => e.sourceClass === "external").map((e) => e.content),
  };
}

// The live schema the system prompt hands the model (doc counts, type + edge
// vocabularies) is legitimate knowledge it never retrieves via tools — without
// this entry the verifier flags TRUE schema facts ("the atlas has ~N docs")
// as invented.
const schemaEvidence = (ix: Indexes): EvidenceEntry => ({
  label: "[E0]",
  tool: "atlas_schema",
  args: "(live schema, injected into the assistant's system prompt)",
  content: JSON.stringify(atlasDescribe(ix)),
});

// [E-const]: deterministic parameter-table rows the answer text mentions
// (docs/research/synlang-wiki.md §3.1) — evidence for the VERIFIER only,
// never the answerer's prompt/loop (a measured ~6x loop-amplification cost is
// why). Gives the refute slice a real value to check a numeric/status claim
// against even on a turn that never re-retrieved the owning doc, so it can
// flag a WRONG figure as a genuine contradiction rather than having nothing
// to compare against. (The absence contract, verify/absence.ts's
// refuteAbsenceSentences, does NOT read this entry — it queries the parameter
// index directly, so an absence sentence is refuted even when [E-const]
// itself found nothing to attach to the answer's own claims.) Uses the same
// broadened name-or-title matcher as the Task-1 hard check
// (param-checks.ts's findParamsMentioned) — a false positive here is cheap
// (one extra evidence row, not a wrongful failure), so the ambiguous-doc
// suppression the hard check needs is deliberately skipped.
const CONST_EVIDENCE_CAP = 40;
function constEvidence(ix: Indexes, answerText: string): EvidenceEntry | null {
  const matches = findParamsMentioned(answerText, ix);
  if (matches.length === 0) return null;
  const ranked = [...matches]
    .sort((a, b) => {
      const aOwner = a.row.owner ? 0 : 1;
      const bOwner = b.row.owner ? 0 : 1;
      return aOwner !== bOwner ? aOwner - bOwner : b.row.name.length - a.row.name.length;
    })
    .slice(0, CONST_EVIDENCE_CAP);
  return {
    label: "[E-const]",
    tool: "atlas_param_table",
    args: "(deterministic parameter-table rows matching the answer — derived from the served atlas at index build)",
    content: JSON.stringify(
      ranked.map(({ row }) => ({ name: row.name, value: row.value, unit: row.unit, owner: row.owner, doc_no: row.doc_no, uuid: row.uuid })),
    ),
  };
}

// One model audit of an answer: two concurrent narrow auditors
// (verify/sliced-verifier.ts) — `refute` (evidence-contradiction) and
// `overreach` (stance) — plus one CONDITIONAL `confirm` call that only runs
// when either produced a candidate. `modelLabel` is what the check row
// records as `model`.
async function runAudit(params: {
  jsonCall: JsonCall;
  ix: Indexes;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  checks: CheckReport;
  signal?: AbortSignal;
  obs?: ErrorContext;
}): Promise<{ run: VerifierRun; modelLabel: string }> {
  const models = sliceModels();
  const run = await runSlicedVerifier({
    call: params.jsonCall, models, ix: params.ix, question: params.question, answer: params.answer,
    evidence: params.evidence, checks: params.checks, signal: params.signal, obs: params.obs,
  });
  return { run, modelLabel: `sliced(${[...new Set(Object.values(models))].join(",")})` };
}

export async function* runVerifiedChat(opts: {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  jsonCall?: JsonCall;
  question: string;
  signal?: AbortSignal;
  maxIterations?: number;
  obs?: ErrorContext;
}): AsyncGenerator<HarnessEvent> {
  const max = Math.max(1, opts.maxIterations ?? config.chatMaxIterations);
  const checker = createRoundChecker();

  // ── Streaming citation gate ───────────────────────────────────────────────
  // The same LinkJudge the post-answer repair pass uses, fed the same evidence
  // (history tool texts + this turn's rounds so far), applied to token events
  // so an invalid link is repaired/de-linkified BEFORE it reaches the client —
  // done.content then matches what streamed instead of swapping it. The judge
  // is rebuilt lazily after each tool round; a gate failure falls back to
  // emitting the link as written, with the post-answer pass as the safety net.
  // History tool texts count as atlas evidence for the incremental checks
  // below, same as splitFromTranscript classifies them. In practice this is
  // the facts prefetch round (sourceClass "reference", grouped with atlas),
  // not earlier turns' raw tool results — §6's Deferred list notes
  // `chat.ts` replays only `{role, content}` for history, so a genuine prior
  // tool result is never in `opts.messages` to begin with, and there is no
  // assistant tool_call name left to pair one with even if it were.
  const historyTexts = toolTextsOf(opts.messages);
  const gateEvidence: string[] = [...historyTexts];
  // This turn's tool results, named — the incremental checks below split them
  // by provenance the same way splitFromTranscript does for the whole-answer
  // pass (isExternalMscTool), which gateEvidence's flat content list can't.
  const gateResults: { name: string; content: string }[] = [];
  let judge: LinkJudge | null = null;
  const renderLink = (title: string, target: string, raw: string): string => {
    try {
      judge ??= createLinkJudge(gateEvidence, opts.ix);
      const v = judge(title, target);
      if (v.action === "repair") return `[${displayText(title, v.to, opts.ix)}](/atlas/${v.to})`;
      if (v.action === "strip") return title;
      // keep — but a uuid used as the link text still reads as an address to the
      // reader; show the title, same as the post-answer pass will.
      const uuid = target.match(/[0-9a-f-]{36}/i)?.[0];
      if (uuid) {
        const text = displayText(title, uuid, opts.ix);
        if (text !== title) return `[${text}](/atlas/${uuid.toLowerCase()})`;
      }
    } catch (err) {
      captureError(err, opts.obs, { stage: "stream_link_gate" });
    }
    return raw;
  };
  // Reference-style answers stream a definition block first; the gate buffers it
  // and repairs the whole citation table once (same judge, same evidence) before
  // releasing it, so a garbled definition never flashes as a live dead link.
  // A gate failure degrades to emitting the block unrepaired — the post-answer
  // pass is the safety net.
  const repairBlock = (block: string): string => {
    try {
      judge ??= createLinkJudge(gateEvidence, opts.ix);
      return repairDefinitionBlock(block, judge).content;
    } catch (err) {
      captureError(err, opts.obs, { stage: "stream_link_gate" });
      return block;
    }
  };
  const makeGate = () => createCitationGate({ render: renderLink, repairBlock });

  const onRoundEnd = (info: RoundInfo) => {
    checker.record(info);
    for (const r of info.results) {
      gateEvidence.push(r.content);
      gateResults.push({ name: r.name, content: r.content });
    }
    judge = null; // new evidence — rebuild on the next link
  };

  // ── Incremental (per-paragraph) deterministic checks ─────────────────────
  // Same checks the whole-answer pass runs, but per paragraph as it streams
  // (docs/chat-system.md §6). `evidence` is a getter, not a snapshot: it reads
  // gateResults/gateEvidence live, so a paragraph is checked against whatever
  // has been retrieved by the time IT closes. Reveal timing is unchanged —
  // the answer still reveals at `answer_final`; the full-text pass after
  // `done` remains the authority.
  const paragraphEvidence = (): ParagraphEvidence => ({
    atlasTexts: [...historyTexts, ...gateResults.filter((r) => !isExternalMscTool(r.name)).map((r) => r.content)],
    externalTexts: gateResults.filter((r) => isExternalMscTool(r.name)).map((r) => r.content),
    allTexts: gateEvidence,
  });
  const paragraphs = createParagraphStream({ ix: opts.ix, question: opts.question, evidence: paragraphEvidence });
  // Tallied for the round_checks row, reset alongside the paragraph stream —
  // this describes the FINAL burst (the shipped answer), not every draft the
  // turn ever streamed and set aside.
  let incrementalParagraphs = 0;
  let incrementalFlagged = 0;
  const resetParagraphs = () => {
    paragraphs.reset();
    incrementalParagraphs = 0;
    incrementalFlagged = 0;
  };

  // ── Small-talk judge (concurrent — never blocks the answer) ──────────────
  // Fired alongside the conversationalist, not after it, so its ruling has
  // resolved by the time the stream ends. Question-side gates keep it to at
  // most one tiny call per conversation: only the FIRST user message (later
  // turns lean on conversation context and always audit), and only when the
  // message itself contains nothing groundable — "what is A.1.6?" needs no
  // judge to be ruled factual. judgeSmalltalk never rejects (fail-closed
  // internally), so an unconsumed promise is safe to abandon.
  const smalltalkJudgeModel = opts.jsonCall ? config.chatSmalltalkJudgeModel : "";
  const firstTurn = opts.messages.filter((m) => m.role === "user").length <= 1;
  const judgePromise =
    smalltalkJudgeModel && firstTurn && isUncheckableAnswer(opts.question)
      ? judgeSmalltalk({ call: opts.jsonCall!, model: smalltalkJudgeModel, question: opts.question, signal: opts.signal, obs: opts.obs })
      : null;

  // ── Conversationalist pass (answer streams at full speed) ────────────────
  let done: DoneEvent | null = null;
  // Real progress, not a route-side inference: a burst is the run of tokens
  // since the last tool_call (or since the stream started), and the FIRST
  // token of each burst is preceded by a "synthesizing" status so the client
  // can show it as a stage rather than silence before the draft appears.
  let announced = false;
  for await (const ev of gatedChat(runChat({ ix: opts.ix, messages: opts.messages, stream: opts.stream, signal: opts.signal, maxIterations: max, onRoundEnd, obs: opts.obs, jsonCall: opts.jsonCall, userQuestion: opts.question }), makeGate)) {
    if (ev.type === "done") {
      // Flush the trailing paragraph BEFORE breaking — this is still inside
      // the streaming loop, ahead of the bypass/checks-off exits below, so it
      // fires on every turn with a non-empty draft regardless of what happens
      // to the answer afterward.
      try {
        const tail = paragraphs.flush();
        if (tail) {
          incrementalParagraphs++;
          if (tail.findings.length > 0) incrementalFlagged++;
          yield { type: "paragraph_check", ...tail };
        }
      } catch (err) {
        captureError(err, opts.obs, { stage: "incremental_checks" });
      }
      done = ev;
      break; // held back — the harness emits its own terminal done
    }
    if (ev.type === "tool_call") {
      resetParagraphs(); // the buffered draft is being set aside
      announced = false; // next generation round re-announces
      yield { type: "status", stage: "querying", detail: describeCall(ev.name, ev.args) };
      yield ev;
      continue;
    }
    if (ev.type === "clear") {
      resetParagraphs(); // the buffered draft is being set aside
      yield ev;
      continue;
    }
    if (ev.type === "token" && !announced) {
      announced = true;
      yield { type: "status", stage: "synthesizing", detail: "Writing an answer from the evidence…" };
    }
    yield ev;
    if (ev.type === "token") {
      try {
        for (const pc of paragraphs.push(ev.text)) {
          incrementalParagraphs++;
          if (pc.findings.length > 0) incrementalFlagged++;
          yield { type: "paragraph_check", ...pc };
        }
      } catch (err) {
        // An incremental-check failure must never break a turn — the
        // full-text pass after `done` is still the authority.
        captureError(err, opts.obs, { stage: "incremental_checks" });
      }
    }
  }
  if (!done) return; // loop can only end via done; defensive
  const checksMeta: CheckRowMeta[] = [];
  const finish = (d: DoneEvent): HarnessDone => ({ ...d, checksMeta });

  if (!config.chatVerifyChecks || opts.signal?.aborted || !done.content.trim()) {
    // No audit runs here — but the streaming gate already repaired links in the
    // token stream, and the client treats done.content as authoritative. Without
    // the same repair applied to done.content, the client swaps the repaired
    // stream back to the invalid link at completion (the exact bug this gate
    // exists to prevent). Verification being off must not lose the repair.
    // Aborted/empty answers have nothing meaningful to repair, so skip them.
    // Normalization runs here too: with checks off this is the only thing
    // standing between a malformed reference citation and the user.
    if (!opts.signal?.aborted && done.content.trim()) {
      try {
        const { repair } = normalizeAndRepair(done.content, toolTextsOf(done.transcript), opts.ix);
        if (repair.content !== done.content) done = { ...done, content: repair.content };
      } catch (err) {
        captureError(err, opts.obs, { stage: "citation_repair_verify_disabled" });
      }
    }
    yield finish(done);
    return;
  }

  // ── Small-talk bypass ────────────────────────────────────────────────────
  // Skips the audit for pure greetings — behind deterministic conditions plus
  // the concurrent judge above, every one fail-closed toward auditing:
  //   1. the judge fired at all (model configured + FIRST user message of the
  //      conversation + the question itself contains nothing groundable);
  //   2. zero tool rounds — the conversationalist itself judged no atlas was
  //      needed (the system prompt tells it plain conversation is tool-free);
  //   3. the answer contains nothing checkable — no doc numbers, links
  //      (markdown or bare autolink), reference labels, addresses, figures,
  //      or slug/code spans (smalltalk.ts) — a zero-tool answer that cites
  //      or quantifies is exactly the hallucination case the verifier exists
  //      for;
  //   4. the judge, given the USER MESSAGE, rules it expects no factual
  //      content. This closes the hole the answer-side predicate can't see:
  //      "is the fee governance-controlled?" answered with a marker-free
  //      "Yes." Judge failure/timeout/garbage = not small talk = full audit.
  // On bypass the answer returns immediately — no comparing/checking ticker,
  // no verify chip. Citation repair is provably a no-op here (condition 3
  // rejects every link/label shape), so it is skipped too. The judge call is
  // always recorded in checksMeta when it fired — even if the ruling is
  // discarded because tools ran or the answer is checkable — so its tokens
  // land in message_checks and count toward the rate-limit window like every
  // other harness call. The prompt is tiny (a few-line classifier + the user
  // message, maxTokens 50), but it is still a billed call.
  if (judgePromise) {
    const judge = await judgePromise; // long since resolved — it raced the whole answer
    checksMeta.push({
      kind: "smalltalk_judge", model: smalltalkJudgeModel,
      verdict: { smalltalk: judge.smalltalk }, overall: null,
      inputTokens: judge.usage?.input ?? null, outputTokens: judge.usage?.output ?? null,
      generationId: judge.generationId, latencyMs: judge.latencyMs,
    });
    if (done.toolCalls.length === 0 && !done.lengthCapped && isUncheckableAnswer(done.content) && judge.smalltalk) {
      captureEvent("chat_smalltalk_bypass", opts.obs, { chars: done.content.length });
      yield finish(done);
      return;
    }
  }

  // ── Verification (deterministic always; model audit when configured) ─────
  // Reference-link normalization, then citation repair, on the FULL tool texts (the verifier evidence
  // budget doesn't apply to free string scans). The streaming gate already
  // applied the same judge to the token stream, so this pass normally agrees
  // with what streamed — it is the authority and the record (repaired/stripped
  // feed the checks), and done.content stays authoritative client-side for
  // the rare case where the gate had to flush a malformed link raw.
  //
  // Everything from here down is pure post-processing of an answer that has
  // ALREADY streamed to the client (token events are long gone). A throw here
  // must never lose that answer — degrade to "skip verification" (same as the
  // config-off path above) rather than letting the exception propagate out and
  // skip persistAssistant entirely.
  const telemetry = checker.telemetry();
  const evidence = evidenceFromTranscript(done.transcript);
  let toolTexts: string[];
  let checks: CheckReport;
  // Earlier-turn answers count as grounding for follow-ups (the system prompt
  // says so), so the verifier gets them as one [E-prev] entry alongside the
  // schema — otherwise every "summarize what you said" turn has nothing to
  // check its claims against.
  // Hoisted above the status events because it is also half of `grounded`.
  const prevEvidence = priorTurnsEvidence(done.transcript);
  // Entering verification is progress worth surfacing — but only when there is
  // something to name as the basis: this turn's retrievals, or earlier turns
  // of the conversation. With neither (a tool-free answer that still carries
  // groundable content — pure small talk exited above) the audit still runs,
  // silently — announcing a comparison against nothing is worse than no
  // ticker at all, and the verdict badge is the outcome channel either way.
  const grounded = evidence.length > 0 || prevEvidence !== null;
  if (grounded) {
    yield {
      type: "status", stage: "comparing",
      detail: evidence.length > 0 ? "Comparing the draft against the retrieved sources…" : "Comparing the draft against the conversation so far…",
    };
  }
  try {
    toolTexts = toolTextsOf(done.transcript);
    const { refs, repair, identifiers } = normalizeAndRepair(done.content, toolTexts, opts.ix);
    if (repair.content !== done.content) done = { ...done, content: repair.content };
    checks = repairedChecks(done.content, toolTexts, opts.ix, done.lengthCapped, {
      question: opts.question,
      evidence,
    }, splitFromTranscript(done.transcript));
    checksMeta.push({
      kind: "round_checks", model: null,
      verdict: {
        telemetry, repair: { repaired: repair.repaired, stripped: repair.stripped, retitled: repair.retitled },
        refs: refsMeta(refs), identifiers: identifiersMeta(identifiers), checks: { ...checks, citations: checks.citations.length },
        incremental: { paragraphs: incrementalParagraphs, flagged: incrementalFlagged },
      },
      overall: null, inputTokens: null, outputTokens: null, generationId: null, latencyMs: null,
    });
  } catch (err) {
    captureError(err, opts.obs, { stage: "citation_repair_or_checks" });
    yield finish(done);
    return;
  }

  // done.content is final past this point — deterministic repair has already
  // run and rewrites are gone, so the client reveals the answer now and lets
  // the verify badge trail rather than waiting on the audit below.
  yield { type: "answer_final", content: done.content };

  const verifierModel = opts.jsonCall ? config.chatVerifierModel : "";
  // constEvidence is computed from the audited answer (done.content) itself,
  // not once up front — kept as a function of answerText since baseEvidence
  // is shared with runAudit below and must stay in sync with whatever text
  // it audits.
  const baseEvidence = (turnEvidence: EvidenceEntry[], answerText: string) => {
    const ce = constEvidence(opts.ix, answerText);
    return [schemaEvidence(opts.ix), ...(prevEvidence ? [prevEvidence] : []), ...(ce ? [ce] : []), ...turnEvidence];
  };
  let verdict: Verdict | null = null;
  if (verifierModel) {
    if (grounded) yield { type: "status", stage: "checking", detail: checkingDetail(checks.citations.length, evidence.length) };
    const { run, modelLabel } = await runAudit({
      jsonCall: opts.jsonCall!, ix: opts.ix, question: opts.question,
      answer: done.content, evidence: baseEvidence(evidence, done.content), checks, signal: opts.signal, obs: opts.obs,
    });
    verdict = run.verdict;
    checksMeta.push({
      kind: "verify", model: modelLabel, verdict: run.verdict,
      overall: computeOverall(checks, run.verdict),
      inputTokens: run.usage?.input ?? null, outputTokens: run.usage?.output ?? null,
      generationId: run.generationId, latencyMs: run.latencyMs,
    });
  }
  const overall = verifierModel ? computeOverall(checks, verdict) : checks.failed ? "fail" : "unverified";

  // Deterministic-only turns stay quiet unless something actually failed —
  // a permanent "unverified" chip on every clean answer is noise, not signal.
  const emitVerify = verifierModel !== "" || checks.failed;
  if (emitVerify) yield verifyEvent(overall, verdict, checks);
  yield finish(done);
  return;
}
