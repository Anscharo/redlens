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
import { isExternalMscTool } from "../../external/envelope.ts";
import { FACT_TOOL_NAME } from "../../facts/registry.ts";

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
  source: "model" | "param-table";
  agreed: boolean; // confirm-gate outcome
}

export interface Verdict {
  contradictions: Contradiction[]; // ALL validated candidates (agreed and not)
  not_found: string[]; // ≤ 5, text only
  ruling_issued: boolean;
  notes: string; // refute + overreach notes, ≤ 600 chars (persistence only)
  refuteParsed: boolean; // the refute backbone parsed
  confirm: { ran: boolean; model: string | null; candidates: number; agreed: number } | null;
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
  sourceClass?: "atlas" | "external" | "reference";
}

// Pull the turn's tool calls + results out of the loop transcript, labeled
// [E1..En] in chronological order. The char budget is applied NEWEST-first
// (later rounds are usually the refined, relevant retrievals).
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
      entries.push({
        label: `[E${entries.length + 1}]`,
        tool: call.tool,
        args: call.args,
        content: m.content,
        sourceClass: isExternalMscTool(call.tool) ? "external" : call.tool === FACT_TOOL_NAME ? "reference" : "atlas",
      });
    }
  }
  // Budget newest-first: walk from the end, keep entries while they fit; an
  // oversized entry is truncated rather than dropped so its identity survives.
  //
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
