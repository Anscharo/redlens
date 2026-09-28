// For each atlas document uuid a chat turn's tool results surfaced, did the
// model see its TEXT, or only its IDENTITY? cite-support.ts's buildCiteRequest
// judges a citation against the FULL document from the built index, never
// against what the turn actually retrieved — so a line built from a 240-char
// atlas_search snippet, or an atlas_recent_changes row carrying only a uuid
// and a title, gets judged against content the model never saw, and a
// legitimate citation reads "Not stated in this source". This module answers
// the missing question; it does not change how cite-support uses the answer.
//
// Four traps found surveying every tool shape (see also createLinkJudge in
// citation-repair.ts, which filters the same uuid surface for a different job):
//
// 1. Entity ids are uuid-shaped — slugToId (scripts/lib/graph-patterns.mjs)
//    sha256-hashes a slug into a v4-shaped uuid. ix.docMap.has() is the
//    allowlist that keeps entities out (Instance/Invocation/multisig entities
//    deliberately reuse their defining document's uuid, so the filter keeps
//    those correctly).
// 2. Key names are not uniform (id, uuid, doc_id, docId, node_id,
//    defining_doc_id, activeDataId, controllerId, from_id, parent_id,
//    ancestor_ids[], a bare uuid at a params tuple's index 1, …) — step 1
//    below scans every string VALUE (object property or array element),
//    never an enumerated key allowlist, so a new field name can't rot it.
// 3. Text vs identity is per-ROW, not per-tool: an object with a text-bearing
//    key can still hold a DIFFERENT uuid that is a cross-reference, not its
//    own text. atlas_get's node has `parentId` sitting beside `content` in
//    the very same flat object, and in real data parentId === the first
//    entry of `ancestors` (ancestorChain starts at the parent) — so a plain
//    "same object has a text key ⇒ every uuid in it is content" rule would
//    let the content/identity merge (content always wins) launder the
//    parent's identity-only appearance into content. So content is granted
//    only to a uuid stored under a SELF-identity key — id/uuid/doc_id/docId/
//    node_id, the row's own handle — never to a uuid under any other key,
//    even one sharing the object with real body text. This is a narrower use
//    of the key than trap 2: trap 2 is about *finding* candidate uuids (never
//    skip a value because of its key); this is only about which one
//    candidate a text key belongs to when more than one is present.
// 4. A truncated chat-transport result ({truncated, original_chars,
//    preview_json}, llm-tools.ts's applyChatToolBudget) is valid JSON —
//    JSON.parse succeeds on it. What keeps a mid-value cut from being
//    misread is that the uuid match below is a whole-string test: a uuid
//    sliced off inside preview_json's one long string value never matches it
//    intact. The try/catch here exists only for content that fails to parse
//    at all — that message contributes nothing, and a missing entry means
//    "unknown", which callers already treat as today's behaviour.
import type OpenAI from "openai";
import { UUID_RE } from "../../../lib/patterns.ts";
import type { Indexes } from "../../retrieval/indexes.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type ProvenanceKind = "content" | "identity";
export interface DocProvenance {
  kind: ProvenanceKind;
  record: unknown;
  tool: string;
}

// Text a claim could plausibly be sourced from, surveyed across every tool
// that returns one. `summary`/`description`-as-commit-prose on
// atlas_recent_changes is deliberately NOT here under either name that would
// catch it — a change log is provenance about the EDIT, not the document.
const TEXT_KEYS = new Set([
  "content", "snippet", "quote", "duty", "assessedText", "context",
  "definition", "diff", "tracking", "description", "statement", "value",
]);

// Keys that denote a row's OWN identity rather than a pointer to some other
// document — see trap 3 above.
const SELF_ID_KEYS = new Set(["id", "uuid", "doc_id", "docId", "node_id"]);

// `diff` counts on any non-empty value (a structured diff), everything else
// only on a non-empty string — per the task's text-bearing-key rule.
function isNonEmpty(key: string, v: unknown): boolean {
  if (key === "diff") return Array.isArray(v) ? v.length > 0 : typeof v === "object" ? v !== null && Object.keys(v).length > 0 : v != null && v !== "";
  return typeof v === "string" && v.trim() !== "";
}

function hasTextKey(obj: Record<string, unknown>): boolean {
  for (const k of TEXT_KEYS) if (k in obj && isNonEmpty(k, obj[k])) return true;
  return false;
}

// content beats identity (rule 4 of the task); an existing content verdict is
// never downgraded, and an existing identity verdict is upgraded in place.
function note(out: Map<string, DocProvenance>, uuid: string, kind: ProvenanceKind, rec: unknown, tool: string): void {
  if (out.get(uuid)?.kind === "content") return;
  out.set(uuid, { kind, record: rec, tool });
}

function candidate(v: string, ix: Indexes): string | null {
  const t = v.trim().toLowerCase();
  return UUID_RE.test(t) && ix.docMap.has(t) ? t : null;
}

// Recurse the parsed tool-result object graph. Arrays have no keys of their
// own, so an element — whether a bare uuid string (ancestor_ids[], a params
// tuple's index 1) or a nested object — is always evaluated in its own
// scope: it never inherits a text key from whatever object holds the array.
function walk(node: unknown, ix: Indexes, tool: string, out: Map<string, DocProvenance>): void {
  if (Array.isArray(node)) {
    for (const el of node) {
      if (typeof el === "string") {
        const uuid = candidate(el, ix);
        if (uuid) note(out, uuid, "identity", node, tool);
      } else {
        walk(el, ix, tool, out);
      }
    }
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const textPresent = hasTextKey(obj);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const uuid = candidate(value, ix);
      if (uuid) note(out, uuid, textPresent && SELF_ID_KEYS.has(key) ? "content" : "identity", obj, tool);
    } else {
      walk(value, ix, tool, out);
    }
  }
}

// Pairs role:"assistant" tool_calls to role:"tool" results by tool_call_id —
// same shape as verifier.ts's evidenceFromTranscript — then classifies every
// atlas uuid each result contains.
export function docProvenance(transcript: Msg[], ix: Indexes): Map<string, DocProvenance> {
  const callById = new Map<string, string>(); // tool_call_id -> tool name
  const out = new Map<string, DocProvenance>();
  for (const m of transcript) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc.type === "function") callById.set(tc.id, tc.function.name);
    }
    if (m.role !== "tool" || typeof m.content !== "string") continue;
    const tool = callById.get(m.tool_call_id) ?? "unknown";
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.content);
    } catch {
      continue; // unparseable/truncated-mid-parse — see trap 4
    }
    walk(parsed, ix, tool, out);
  }
  return out;
}
