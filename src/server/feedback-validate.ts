// Pure validation + clamping for POST /api/feedback. Split out of feedback.ts
// so it stays testable with no DB and no request object.
//
// Everything here is authoritative: the client runs equivalent caps before
// sending, but these run again server-side and are the ones that count.
import { createHash } from "node:crypto";
import { isNonEmptyString } from "./http.ts";

export const MIN_MESSAGE_LEN = 2;
export const MAX_MESSAGE_LEN = 2000;
export const MAX_CONSOLE_ENTRIES = 50;
export const MAX_CONSOLE_ENTRY_CHARS = 400;
export const TIMING_FLOOR_MS = 1500;

// Untyped on purpose (every field is client-controlled JSON) — every read
// goes through a typeof/isNonEmptyString guard before use.
export interface FeedbackBody {
  message?: unknown;
  website?: unknown; // honeypot: a real user never fills this (CSS-hidden field)
  elapsedMs?: unknown; // ms between form-open and submit — the timing floor
  url?: unknown;
  host?: unknown;
  appCommit?: unknown;
  atlasCommit?: unknown;
  atlasBase?: unknown;
  previewId?: unknown;
  nodeId?: unknown;
  sessionId?: unknown; // client PostHog distinct id, if analytics is on
  context?: unknown;
  console?: unknown;
}

export interface ConsoleEntryOut {
  level: string;
  text: string;
}

export function messageHash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export type ValidateResult =
  | { ok: true; message: string }
  | { ok: false; error: "empty_message" | "message_too_long" };

export function validateFeedback(body: FeedbackBody): ValidateResult {
  if (!isNonEmptyString(body.message)) return { ok: false, error: "empty_message" };
  const trimmed = body.message.trim();
  if (trimmed.length < MIN_MESSAGE_LEN) return { ok: false, error: "empty_message" };
  if (trimmed.length > MAX_MESSAGE_LEN) return { ok: false, error: "message_too_long" };
  return { ok: true, message: trimmed };
}

// Server-side re-clamp of the client console buffer: at most 50 entries, each
// truncated to 400 chars. Never trust the client's own cap — this runs
// regardless of what the request claimed.
export function normalizeConsole(entries: unknown): ConsoleEntryOut[] {
  if (!Array.isArray(entries)) return [];
  const out: ConsoleEntryOut[] = [];
  for (const raw of entries.slice(0, MAX_CONSOLE_ENTRIES)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as { level?: unknown; text?: unknown };
    const text = typeof e.text === "string" ? e.text.slice(0, MAX_CONSOLE_ENTRY_CHARS) : "";
    if (!text) continue;
    const level = typeof e.level === "string" && e.level ? e.level.slice(0, 20) : "log";
    out.push({ level, text });
  }
  return out;
}

// Allowlisted keys for the free-form `context` blob — anything else is dropped
// so a client can't stuff arbitrary/megabyte JSON into the jsonb column.
// Extend this list (not the shape below) when a new field is needed.
const CONTEXT_KEYS = ["viewport", "theme", "route", "referrer", "language"] as const;

// `interactions` is the one allowlisted ARRAY key: the trail of what the user
// clicked/focused before opening the modal. Bounded on both axes — element
// count and per-entry length — so it keeps the same size guarantee the scalar
// keys have. The client applies equivalent caps; these are the ones that count.
export const MAX_CONTEXT_INTERACTIONS = 5;
export const MAX_INTERACTION_CHARS = 160;

export function buildContext(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const k of CONTEXT_KEYS) {
    const v = obj[k];
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    // Objects/arrays under a SCALAR allowlisted key are dropped — the
    // allowlist bounds size, not just key names.
  }
  if (Array.isArray(obj.interactions)) {
    const trail = obj.interactions
      .filter((v): v is string => typeof v === "string")
      .slice(0, MAX_CONTEXT_INTERACTIONS)
      .map((s) => s.slice(0, MAX_INTERACTION_CHARS));
    if (trail.length) out.interactions = trail;
  }
  return out;
}

// A trimmed string, or null for anything else (missing/blank/wrong type).
// Every optional text column is client-supplied context, not identity — null
// is a fine, common value.
export function str(v: unknown, maxLen = 2048): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, maxLen) : null;
}
