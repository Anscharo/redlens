// Verifier — the strong-model final claim audit of the chat reliability
// harness. Runs ONCE per turn, after the answer already streamed (stream +
// badge, never gate). REFUTATION-ONLY: the model lists statements the
// retrieved evidence CONTRADICTS (verify/refute.ts), not statements it
// supports — a statement the evidence merely doesn't mention is not flagged.
// `overall` is computed IN CODE so the model can never upgrade a
// deterministic citation failure. Any transport/parse failure degrades to
// "unverified" — verification flakiness must never break chat.
import type OpenAI from "openai";
import { config } from "../../config.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { ScreenRecord } from "./refute-screen-record.ts";
import { isExternalMscTool } from "../../external/envelope.ts";
import { FACT_TOOL_NAME } from "../../facts/registry.ts";
import { isUserTeachingTool } from "../teach/inject.ts";
import { DISPUTE_TOOL_NAME } from "../dispute-round.ts";
import { TOOLS_BY_NAME } from "../tools/tool-registry.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// One code-validated contradiction between the answer and the retrieved
// evidence. `answer_span`/`evidence_span` are re-checked against the answer
// and the evidence respectively (verify/refute.ts's validateContradictions) —
// the model cannot assert a contradiction into existence any more than the
// old design let it assert support into existence.
export interface Contradiction {
  answer_span: string; // the answer sentence (validated: spanOverlap ≥ 0.8 vs the answer with link markup stripped)
  evidence_span: string; // verbatim evidence (validated: locateSpan ≥ 0.8)
  why: string; // ≤ 20 words
  evidence_label: string; // "[E3]" — the entry the span matched
  uuid: string | null; // nearest `"id":"<uuid>"` (or "uuid") preceding the match inside that entry, else null
  source: "model" | "param-table" | "cited-doc";
  agreed: boolean; // confirm-gate outcome
}

export interface Verdict {
  contradictions: Contradiction[]; // ALL validated candidates (agreed and not)
  ruling_issued: boolean;
  notes: string; // refute + overreach notes, ≤ 600 chars (persistence only)
  refuteParsed: boolean; // the refute backbone parsed
  // `parsed: false` means the confirm call itself failed (timeout/unparseable/
  // throw) — NOT that it disagreed. `runConfirm` returns `agreed: ∅` in both
  // cases, so without this field an outage is indistinguishable from a
  // considered "no, none of these" and reads as a clean pass — the only path
  // that can assert cleanliness the second auditor never actually granted.
  confirm: { ran: boolean; model: string | null; candidates: number; agreed: number; parsed: boolean } | null;
  // Present only in paragraph refute mode (CHAT_REFUTE_MODE, verify/paragraph-refute.ts):
  // per-burst stats for the persisted verdict — count of paragraphs submitted,
  // how many parsed, how many raw candidates they produced before span
  // validation, how many were discarded by validation, and how many timed out.
  // `screen`: one row per paragraph call when the Jev refute screen ran
  // (CHAT_REFUTE_SCREEN, verify/refute-screen-record.ts) — its calibration record.
  paragraphs?: { count: number; parsed: number; candidates: number; discarded: number; timedOut: number; screen?: ScreenRecord[] };
}

export type VerifyOverall = "pass" | "warn" | "fail" | "unverified";

// overall is computed here, not by the model. Deterministic failures are
// un-appealable; the verdict can only add severity, never remove it.
//
// The confirm gate is a HARD gate: a contradiction candidate the second judge
// did NOT agree with must never reach the reader. Unagreed candidates stay
// only inside the persisted Verdict (message_checks.verdict) as the confirm
// gate's calibration record — they never influence overall.
export function computeOverall(checks: CheckReport | null, verdict: Verdict | null): VerifyOverall {
  if (checks?.failed) return "fail";
  if (!verdict) return "unverified";
  // An AGREED contradiction (refute + independent confirm) is a hard fail —
  // two auditors, one narrative and one adversarial-checklist, both read the
  // evidence as incompatible with the answer.
  if (verdict.contradictions.some((c) => c.agreed)) return "fail";
  // The confirm gate itself failed to run (timeout/unparseable/throw) while
  // there was at least one candidate on the table — not a clean pass (the
  // second auditor never actually looked) and not a fail (nothing agreed to
  // it either): the honest answer is that this candidate was never resolved.
  if (verdict.confirm?.ran && !verdict.confirm.parsed && verdict.confirm.candidates > 0) return "unverified";
  // An overreach ruling is caution.
  if (verdict.ruling_issued) return "warn";
  // The refute backbone never parsed and nothing else is wrong — don't bless
  // an answer the audit never actually checked.
  if (!verdict.refuteParsed) return "unverified";
  return "pass";
}

export interface EvidenceEntry {
  label: string; // [E1], [E2], …
  tool: string;
  args: string;
  content: string;
  // "reference" = RedLens-injected context (facts/registry.ts): glossary rows,
  // entity rows, concept censuses, the product guide. It is NOT a retrieval of
  // atlas document text, so the judge must not hold it to atlas-quotation
  // rules — but it IS legitimate grounding, which is the whole point of
  // injecting it. Deliberately still grouped with atlas (not external) for
  // quote-grounding in splitFromTranscript: glossary definitions genuinely are
  // atlas text, and moving them out would start failing quotes that are real.
  /** See classifyToolSource: "atlas" is EARNED by a registry tool, never assumed. */
  sourceClass?: SourceClass;
}

// Budget a flat list of evidence entries to `maxChars`, newest-first (later
// rounds are usually the refined, relevant retrievals), with the prefetch
// round exempt from eviction and always kept first. Shared by
// `evidenceFromTranscript` (whole-answer path) and `evidenceFromResults`
// (per-paragraph path, chat-orchestrator.ts's `gateResults`) so the two
// cannot drift on budgeting policy. `entries` is assumed already in
// chronological order; labels are ignored on the way in and reassigned
// `[E1], [E2], …` contiguous on the way out.
export function budgetEvidence(entries: EvidenceEntry[], maxChars: number): EvidenceEntry[] {
  // The prefetch round is EXEMPT from eviction. It is always the oldest tool
  // entry (facts are seeded before the model runs), so newest-first budgeting
  // drops it first — precisely the material the answer was built from, on the
  // tool-heavy turns where the budget actually binds. The verifier then judges
  // an answer against evidence missing its source and can flag correct content
  // as a false refutation, shipping a false fail badge on an otherwise-correct
  // answer. Facts are small and deterministic; reserving them costs little and
  // removes a whole class of false "not supported by the provided evidence".
  const isPrefetch = (e: EvidenceEntry) => e.tool === FACT_TOOL_NAME;
  let remaining = maxChars;
  const reserved: EvidenceEntry[] = [];
  for (const e of entries) {
    if (!isPrefetch(e)) continue;
    const content = e.content.length > remaining ? `${e.content.slice(0, remaining)}…[truncated]` : e.content;
    remaining -= content.length;
    reserved.push({ ...e, content });
  }
  const kept: EvidenceEntry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (remaining <= 0) break;
    const e = entries[i];
    if (isPrefetch(e)) continue; // already reserved above
    const content = e.content.length > remaining ? `${e.content.slice(0, remaining)}…[truncated]` : e.content;
    remaining -= content.length;
    kept.unshift({ ...e, content });
  }
  // Re-label so [E1], [E2], … stay contiguous after the partition.
  return [...reserved, ...kept].map((e, i) => ({ ...e, label: `[E${i + 1}]` }));
}

// Pull the turn's tool calls + results out of the loop transcript, labeled
// [E1..En] in chronological order, then budgeted (see budgetEvidence).
export type SourceClass = "atlas" | "external" | "reference" | "user" | "unknown";

/**
 * What KIND of text a tool result is. Atlas provenance is an ALLOWLIST —
 * earned by being a tool in the registry (tools/tool-registry.ts's
 * ATLAS_TOOLS, via TOOLS_BY_NAME) — and everything unrecognised falls to
 * "unknown".
 *
 * This used to default to "atlas", which had it exactly backwards. Atlas text
 * is the privileged class: it is what quote-grounding will certify a quote
 * against and what the refute auditor reads as authoritative. Defaulting to it
 * meant any tool result the harness did not recognise was silently promoted to
 * atlas evidence — and that was not hypothetical. `export_findings`
 * (llm-tools.ts appends it to CHAT_TOOLS outside ATLAS_TOOLS, so it is not in
 * the registry) was being classed as atlas, as was the `{ tool: "unknown" }`
 * fallback below for a tool message whose assistant tool_call is missing.
 *
 * Order matters: the external-MSC check runs first because ask_external_msc is
 * appended to CHAT_TOOLS outside ATLAS_TOOLS too, and the facts/teach rounds
 * are synthetic names that are deliberately not registry tools.
 */
export function classifyToolSource(tool: string): SourceClass {
  if (isExternalMscTool(tool)) return "external";
  if (tool === FACT_TOOL_NAME) return "reference";
  if (isUserTeachingTool(tool)) return "user";
  return TOOLS_BY_NAME.has(tool) ? "atlas" : "unknown";
}

/**
 * Does this class count as atlas text for grounding? "reference" is the facts
 * prefetch round, which is atlas-derived (glossary rows, entity rows,
 * censuses) and has always been grouped here deliberately.
 *
 * An ALLOWLIST on purpose, and every caller in chat-orchestrator.ts goes
 * through it. The three filters that used to spell this out inline were
 * blacklists ("not external and not user"), so adding a new class would have
 * silently admitted it to the grounding pool at all three sites at once.
 */
export function isAtlasText(cls: SourceClass | undefined): boolean {
  return cls === "atlas" || cls === "reference";
}

// The dispute round (dispute-round.ts) is NOT evidence and is dropped from
// both extractors below. It is a note about the PREVIOUS turn's verifier
// result, and it quotes the model's own flagged sentence verbatim — so left
// in, it would fall through to the `"atlas"` default here and land in
// `atlasTexts` (chat-orchestrator.ts groups "atlas" and "reference" together).
// Quote-grounding would then certify the very sentence the harness disputed
// the moment the model repeated it, and the refute auditor would read the
// flag's own text as retrieved atlas material. A `"reference"` class would
// not have helped: it is grouped with atlas too.
//
// The cost of dropping it is that a model which QUOTES the truncated atlas
// span out of the dispute block gets an ungrounded-quote flag. That is the
// conservative direction, and the block's own footer already tells the model
// to look the source document up with atlas_get rather than quote the excerpt.
function isDisputeRound(tool: string): boolean {
  return tool === DISPUTE_TOOL_NAME;
}

export function evidenceFromTranscript(transcript: Msg[], maxChars = config.chatVerifierEvidenceMaxChars): EvidenceEntry[] {
  const callById = new Map<string, { tool: string; args: string }>();
  const entries: EvidenceEntry[] = [];
  for (const m of transcript) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc.type === "function") callById.set(tc.id, { tool: tc.function.name, args: tc.function.arguments });
      }
    }
    if (m.role === "tool" && typeof m.content === "string") {
      const call = callById.get(m.tool_call_id) ?? { tool: "unknown", args: "{}" };
      if (isDisputeRound(call.tool)) continue; // not evidence — see isDisputeRound
      entries.push({
        label: `[E${entries.length + 1}]`,
        tool: call.tool,
        args: call.args,
        content: m.content,
        sourceClass: classifyToolSource(call.tool),
      });
    }
  }
  return budgetEvidence(entries, maxChars);
}

// Mid-stream twin of evidenceFromTranscript: the orchestrator's per-paragraph
// refuter has no finished transcript to pull tool_calls/tool results out of —
// it only has `results` accumulated live (chat-orchestrator.ts's
// `historyResults`/`gateResults`, named `{name, content}` pairs). Same
// labels/sourceClass rule, same newest-first budget with prefetch reserved —
// factored through the shared `budgetEvidence` so the two paths cannot diverge
// on policy. `args` is always "(streamed)": there is no tool_call arguments
// string to recover mid-stream (or, for history, chat.ts replays only
// `{role, content}` — see docs/chat-system.md §6's Deferred note).
export function evidenceFromResults(results: { name: string; content: string }[], maxChars = config.chatVerifierEvidenceMaxChars): EvidenceEntry[] {
  // Filtered BEFORE the map so the [E..] labels stay contiguous.
  const entries: EvidenceEntry[] = results.filter((r) => !isDisputeRound(r.name)).map((r, i) => ({
    label: `[E${i + 1}]`,
    tool: r.name,
    args: "(streamed)",
    content: r.content,
    sourceClass: classifyToolSource(r.name),
  }));
  return budgetEvidence(entries, maxChars);
}

// Assistant answers from EARLIER turns of the conversation, folded into one
// evidence entry. The system prompt tells the model that atlas material already
// in the conversation counts as grounding, so a follow-up ("summarize what you
// just said") legitimately answers with zero this-turn tool calls — without
// this entry the refute slice has nothing to check every such claim against.
export function priorTurnsEvidence(transcript: Msg[], maxChars = 8000): EvidenceEntry | null {
  const lastUser = transcript.findLastIndex((m) => m.role === "user");
  const answers = transcript
    .slice(0, Math.max(lastUser, 0))
    .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => m.content as string);
  if (answers.length === 0) return null;
  // Newest-first budget, same policy as tool evidence: recent turns matter most.
  let joined = "";
  for (let i = answers.length - 1; i >= 0; i--) {
    const next = answers[i] + (joined ? "\n---\n" + joined : "");
    if (next.length > maxChars) {
      joined = joined || `${answers[i].slice(0, maxChars)}…[truncated]`;
      break;
    }
    joined = next;
  }
  return {
    label: "[E-prev]",
    tool: "conversation",
    args: "(the assistant's own answers from earlier turns of this conversation)",
    content: joined,
  };
}

export interface VerifierRun {
  verdict: Verdict | null;
  usage: { input: number; output: number } | null;
  generationId: string | null;
  latencyMs: number | null;
}
