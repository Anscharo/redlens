// Redaction for anything captured for a bug report (console buffer text,
// URLs, etc.) before it leaves the browser/server. ZERO imports — the Bun
// server imports this file directly too, so it must stay dependency-free and
// runtime-agnostic (no DOM/node globals).
//
// The failure mode we're avoiding is over-redaction: 0x… EVM addresses,
// base58 Solana addresses, and UUIDs are the atlas's actual subject matter
// and the single most useful thing in a bug report, so every rule below is
// anchored to a literal secret-shaped prefix/context rather than a bare
// "looks like a long token" heuristic (which would eat addresses).

// JWTs: three dot-separated base64url segments, each long enough to not be a
// coincidental short token. Must run BEFORE the generic key rules below,
// since a JWT segment could otherwise partially match something else.
const JWT_RE = /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g;

// Query-string params carrying secrets/session material. Keeps the param
// name + "=" (via the capture group), replaces only the value.
const QUERY_PARAM_RE =
  /([?&](?:code|state|token|key|secret|password|access_token|id_token|api_key)=)[^&\s]+/gi;

// API-key shapes, each anchored to its literal service prefix so a bare hex
// address or UUID can never match.
const API_KEY_RES = [
  /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style
  /phc_[A-Za-z0-9]{20,}/g, // PostHog
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub (ghp_, gho_, ghu_, ghs_, ghr_)
];

const BEARER_RE = /Bearer \S+/g;

export function redact(s: string): string {
  let out = s.replace(JWT_RE, "[jwt]");
  out = out.replace(QUERY_PARAM_RE, "$1[redacted]");
  for (const re of API_KEY_RES) out = out.replace(re, "[key]");
  out = out.replace(BEARER_RE, "Bearer [key]");
  return out;
}
