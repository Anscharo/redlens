import { apiUrl } from "../components/chat/api";

// Typed client for POST /api/feedback — see src/server/feedback.ts for the
// authoritative contract. Clones the request<T> wrapper pattern at
// collectionsApi.ts:17-33.
//
// credentials: "same-origin" is REQUIRED — without it the rl_fb anti-spam
// cookie never round-trips, so the server can't tell repeat submitters from
// first-timers and the rate limiter/dedupe never engages.
export interface FeedbackConsoleEntry {
  level?: string;
  text: string;
}

export interface FeedbackContextFields {
  viewport?: string;
  theme?: string;
  route?: string;
  referrer?: string;
  language?: string;
}

export interface FeedbackSubmission {
  message: string;
  website: string; // honeypot — always sent, real users always send it empty
  elapsedMs: number;
  url?: string;
  host?: string;
  appCommit?: string;
  atlasCommit?: string;
  atlasBase?: string;
  previewId?: string;
  nodeId?: string;
  sessionId?: string;
  context?: FeedbackContextFields;
  console?: FeedbackConsoleEntry[];
}

export type FeedbackErrorCode =
  | "method_not_allowed"
  | "invalid_json"
  | "payload_too_large"
  | "empty_message"
  | "message_too_long"
  | "rate_limited"
  | "server_error";

export interface FeedbackApiError extends Error {
  code?: FeedbackErrorCode;
  retryAfterSeconds?: number;
}

// { ok: true, id } on 201 (inserted) and { ok: true } on 200 (accepted but
// silently discarded — honeypot / too fast / duplicate) get the SAME shape
// here (id optional): the UI must treat both identically, never revealing
// which filter tripped.
export interface FeedbackResponse {
  ok: true;
  id?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let code: FeedbackErrorCode | undefined;
    let retryAfterSeconds: number | undefined;
    try {
      const errBody = await res.json();
      if (typeof errBody?.error === "string") code = errBody.error;
      if (typeof errBody?.retryAfterSeconds === "number") retryAfterSeconds = errBody.retryAfterSeconds;
    } catch {
      // ignore — non-JSON error body
    }
    const err = new Error(code ?? `${res.status} ${res.statusText}`) as FeedbackApiError;
    err.code = code;
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function submitFeedback(body: FeedbackSubmission): Promise<FeedbackResponse> {
  return request<FeedbackResponse>("feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
