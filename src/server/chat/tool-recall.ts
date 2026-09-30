// Lookup cards persisted ONCE, when a turn is saved, and replayed unchanged
// after that. The live turn still sees the full tool result (capped by
// CHAT_TOOL_RESULT_MAX_CHARS) — that is what the answer is written from.
// Later turns cannot afford to re-read those payloads: a handful of 30k
// results crowds out the conversation, and recomputing a card on every read
// would change bytes in the middle of the prompt. Provider prompt caches
// match a byte-identical prefix, so a card that is written once and then
// only appended keeps every earlier turn cached.
//
// This file is the persistence half — ids and pairing. The card text itself is
// built by tool-recall-card.ts, and this is a different compression from
// context-compact.ts: compaction is a rare narrative summary of the whole
// prefix, a card is a deterministic extract of handles.
import { randomUUID } from "node:crypto";
import { toolRecall, type RecallToolCall } from "./tool-recall-card.ts";

/**
 * Replay tool-call ids. New cards are `rcall` plus 20 hex characters: no `_`
 * or `-`, which some providers reject in `tool_call_id`. Rows written before
 * that change are `rcall_<uuid>` and stay valid — replay reads the stored id,
 * it does not remint it. `isRecallToolId` recognizes both so a card never
 * becomes verifier evidence.
 */
export const RECALL_ID_PREFIX = "rcall_";

export function isRecallToolId(id: string | undefined | null): boolean {
  if (typeof id !== "string") return false;
  return id.startsWith(RECALL_ID_PREFIX) || /^rcall[0-9a-f]{20}$/.test(id);
}

function mintRecallId(): string {
  return `rcall${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// Synthetic tool rounds seeded before the model runs. Their tool messages
// sit in the same transcript as real results; recall must not pair a real
// call with the prefetch / teachings / dispute payload.
const SYNTHETIC_TOOL_IDS = new Set(["call_prefetch", "call_dispute_flags", "call_teachings"]);

interface TranscriptMsg {
  role: string;
  content?: unknown;
  tool_call_id?: string;
}

/** Tool-message bodies that belong to real calls, in transcript order. */
export function recalledToolContents(transcript: TranscriptMsg[]): string[] {
  const out: string[] = [];
  for (const m of transcript) {
    if (m.role !== "tool" || typeof m.content !== "string") continue;
    if (m.tool_call_id && SYNTHETIC_TOOL_IDS.has(m.tool_call_id)) continue;
    out.push(m.content);
  }
  return out;
}

/**
 * Attach a recall card and a stable id to each persisted tool call.
 * Ids are random and stored — replay reads them back, it does not mint new
 * ones, so the tool_call_id prefix stays byte-identical across turns.
 */
export function attachRecall(calls: RecallToolCall[], transcript: TranscriptMsg[]): RecallToolCall[] {
  const contents = recalledToolContents(transcript);
  return calls.map((call, i) => ({
    ...call,
    recall_id: call.recall_id ?? mintRecallId(),
    recall: call.recall ?? toolRecall(call.name, call.args ?? {}, contents[i] ?? "", call.ok),
  }));
}
