// Lookup cards persisted ONCE, when a turn is saved, and replayed unchanged
// after that. The live turn still sees the full tool result (capped by
// CHAT_TOOL_RESULT_MAX_CHARS) — that is what the answer is written from.
// Later turns cannot afford to re-read those payloads: a handful of 30k
// results crowds out the conversation, and recomputing a card on every read
// would change bytes in the middle of the prompt. Provider prompt caches
// match a byte-identical prefix, so a card that is written once and then
// only appended keeps every earlier turn cached.
//
// This is a different compression from context-compact.ts. Compaction is a
// rare narrative summary of the whole prefix. A recall card is a
// deterministic extract of handles (ids, titles, doc numbers, a short
// excerpt) so the model can re-call the tool. It is not evidence the
// verifier may ground a quote against — evidenceFromTranscript skips ids
// that isRecallToolId recognizes.
import { randomUUID } from "node:crypto";

/**
 * Replay tool-call ids. New cards are `rcall` plus 20 hex characters: no `_`
 * or `-`, which some providers reject in `tool_call_id`. Rows written before
 * that change are `rcall_<uuid>` and stay valid — replay reads the stored id,
 * it does not remint it. `isRecallToolId` recognizes both so a card never
 * becomes verifier evidence.
 */
export const RECALL_ID_PREFIX = "rcall_";

export function isRecallToolId(id: string): boolean {
  return id.startsWith(RECALL_ID_PREFIX) || /^rcall[0-9a-f]{20}$/.test(id);
}

function mintRecallId(): string {
  return `rcall${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
export const RECALL_MAX_CHARS = 1_800;
export const RECALL_MAX_ITEMS = 12;
const SNIPPET_CHARS = 280;
const ARGS_CHARS = 400;

// Synthetic tool rounds seeded before the model runs. Their tool messages
// sit in the same transcript as real results; recall must not pair a real
// call with the prefetch / teachings / dispute payload.
const SYNTHETIC_TOOL_IDS = new Set(["call_prefetch", "call_dispute_flags", "call_teachings"]);

// Listing keys only. `ancestors` is a breadcrumb repeated on every atlas_get;
// treating the first object-array as the payload recorded the breadcrumb and
// dropped the document (measured on trace 0e97e0a6). `children` is often an
// empty array on atlas_neighbors and must not hide `siblings`.
const LIST_KEYS = ["results", "records", "rows", "items", "hits", "documents", "edges", "nodes", "siblings", "children"];
const BREADCRUMB_KEYS = new Set(["ancestors", "sources", "addressRefs"]);
const IDENTITY_KEYS = ["id", "uuid", "doc_id", "doc_no", "title", "name", "address", "chain", "slug", "type", "role"];
const SNIPPET_KEYS = ["snippet", "content", "definition", "text", "summary"];

export interface RecallToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  bytes: number;
  truncated?: boolean;
  originalBytes?: number;
  /** Deterministic extract. Absent on rows written before recall existed. */
  recall?: string;
  /** Stable tool_call id for replay. Minted once at persist time. */
  recall_id?: string;
}

interface TranscriptMsg {
  role: string;
  content?: unknown;
  tool_call_id?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

function recallFooter(name: string): string {
  return `Re-call ${name} for the full result before quoting it.`;
}

/** Keep the re-call line. A cap that ate it would leave a note the system prompt cannot recognize. */
function fitCard(body: string, footer: string): string {
  const tail = `\n${footer}`;
  if (body.length + tail.length <= RECALL_MAX_CHARS) return body + tail;
  const room = Math.max(0, RECALL_MAX_CHARS - tail.length - 1);
  return `${body.slice(0, room)}…${tail}`;
}

function nonEmptyObjs(v: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(v)) return null;
  const objs = v.filter(isObj);
  return objs.length ? objs : null;
}

function isDoc(obj: Record<string, unknown>): boolean {
  return typeof obj.id === "string" && (
    typeof obj.title === "string" || typeof obj.doc_no === "string" || typeof obj.content === "string"
  );
}

function itemsFrom(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isObj).slice(0, RECALL_MAX_ITEMS);
  if (!isObj(parsed)) return [];
  const items: Record<string, unknown>[] = [];
  // A single fetched document is the payload. Its ancestor chain is not.
  if (isDoc(parsed)) items.push(parsed);
  else {
    if (isObj(parsed.target) && isDoc(parsed.target)) items.push(parsed.target);
    if (isObj(parsed.parent) && isDoc(parsed.parent)) items.push(parsed.parent);
    for (const key of LIST_KEYS) {
      const objs = nonEmptyObjs(parsed[key]);
      if (objs) {
        items.push(...objs);
        break;
      }
    }
  }
  if (items.length === 0) {
    for (const [key, v] of Object.entries(parsed)) {
      if (BREADCRUMB_KEYS.has(key)) continue;
      const objs = nonEmptyObjs(v);
      if (objs) {
        items.push(...objs);
        break;
      }
    }
  }
  if (items.length === 0) items.push(parsed);
  return items.slice(0, RECALL_MAX_ITEMS);
}

function itemLine(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of IDENTITY_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() && v.length < 180) parts.push(`${key}=${v.trim()}`);
    else if (typeof v === "number" && Number.isFinite(v)) parts.push(`${key}=${v}`);
  }
  const snippetKey = SNIPPET_KEYS.find((k) => typeof obj[k] === "string" && (obj[k] as string).trim());
  if (snippetKey) parts.push(`${snippetKey}: ${clip(String(obj[snippetKey]), SNIPPET_CHARS)}`);
  return parts.join(" | ");
}

function argsBrief(args: Record<string, unknown>): string {
  // Tool calls in the trace ship every optional field as "" / [] / false.
  // The card only needs the fields that were actually set, so a later turn
  // can see the query rather than a wall of empty defaults.
  const slim: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(args ?? {})) {
    if (v === "" || v === null || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    slim[key] = v;
  }
  let raw: string;
  try {
    raw = JSON.stringify(slim);
  } catch {
    return "{}";
  }
  if (raw.length <= ARGS_CHARS) return raw;
  return JSON.stringify({ note: "arguments shortened", keys: Object.keys(slim) });
}

/** Arguments string replayed with a stored call. Large bodies (exports) stay out of later turns. */
export function replayArguments(args: Record<string, unknown> | undefined): string {
  return argsBrief(args ?? {});
}

/**
 * One card for one tool result. Same inputs always produce the same text —
 * but callers still persist it, so a later change to this function does not
 * rewrite cards already in the log (that would bust the prompt cache).
 */
export function toolRecall(name: string, args: Record<string, unknown>, raw: string, ok: boolean): string {
  const head = `${name}(${argsBrief(args)})`;
  if (!ok || raw.startsWith('{"error"')) {
    let msg = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (parsed && typeof parsed.error === "string") msg = parsed.error;
    } catch {
      // keep the raw slice
    }
    return clip(`${head} failed: ${msg}`, 500);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fitCard(`${head}\n${clip(raw, SNIPPET_CHARS)}`, recallFooter(name));
  }

  const lines = [head];
  if (isObj(parsed)) {
    for (const key of ["count", "total", "truncated", "hint", "liveness_hint", "error"] as const) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) lines.push(`${key}: ${clip(v, 240)}`);
      else if (typeof v === "number" || typeof v === "boolean") lines.push(`${key}: ${v}`);
    }
  }
  const items = itemsFrom(parsed);
  for (const item of items) {
    const line = itemLine(item);
    if (line) lines.push(`- ${line}`);
  }
  return fitCard(lines.join("\n"), recallFooter(name));
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
