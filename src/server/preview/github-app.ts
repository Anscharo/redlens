// Server-to-server GitHub App auth for private atlas previews.
//
// Two distinct credentials are in play here, and it matters which one goes
// where:
//   - the APP JWT (appJwt()) — signed with the App's own private key,
//     identifies the App itself. Valid only for app-level calls: looking up
//     an installation, minting an installation token.
//   - the INSTALLATION TOKEN (installationToken()) — minted using the app
//     JWT, scoped to one repo's installation. Used for every repo-scoped
//     call: the private tarball download (elsewhere) and the permission
//     checks below.
//
// This module backs an access-control decision (does this GitHub user get to
// see this private atlas preview?), so every uncertain outcome — a network
// throw, an unexpected response shape, a 5xx — DENIES rather than grants.
// Never widen a catch/fallback to "ok: true" here.

import crypto from "node:crypto";
import { config } from "../config.ts";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Railway (and other env-var stores) mangle a pasted PEM in several ways: literal
// "\n" escapes instead of newlines, CRLFs, surrounding quotes, a stripped
// trailing newline, or — worst — every newline collapsed to a space so the whole
// key lands on one line. OpenSSL then rejects it (BAD_END_LINE / BAD_BASE64_DECODE).
// Rather than patch one symptom, reconstruct the PEM: find the BEGIN/END label,
// strip the body down to raw base64, and re-wrap at 64 chars with a clean header,
// footer, and trailing newline. Handles PKCS#1 ("RSA PRIVATE KEY") and PKCS#8
// ("PRIVATE KEY") alike. If it isn't a recognizable PEM, hand it back untouched so
// createSign fails loudly instead of silently mangling something valid.
export function normalizePem(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // If it isn't already a PEM, it may be the whole key base64-encoded — the
  // cleanest single-line form for env stores that split a value on newlines
  // (Railway pastes each PEM line as a separate variable). `base64 -w0 key.pem`
  // gives one line with no quotes/escapes to mangle; decode it back to the PEM.
  if (!s.includes("BEGIN")) {
    try {
      const decoded = Buffer.from(s.replace(/\s/g, ""), "base64").toString("utf8");
      if (decoded.includes("BEGIN")) s = decoded;
    } catch {
      /* not base64 — fall through and let the PEM parse below fail loudly */
    }
  }
  s = s.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r/g, "");
  const m = s.match(/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/);
  if (!m) return s;
  const label = m[1].trim();
  const body = m[2].replace(/[^A-Za-z0-9+/=]/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

// ---------------------------------------------------------------------------
// App JWT
// ---------------------------------------------------------------------------

// Reusable until exp, so we don't re-sign on every call. Refreshed a bit
// before its real expiry (see the 30s guard below) rather than racing it.
let cachedJwt: { token: string; exp: number } | null = null;

/** RS256 JWT identifying the App itself (iss = app id). */
export async function appJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.exp - 30 > now) return cachedJwt.token;

  // GitHub issues App private keys in PKCS#1 ("BEGIN RSA PRIVATE KEY") form.
  // jose's importPKCS8 flatly rejects that, so we sign manually with
  // node:crypto instead of pulling in a JWT library — createSign/createVerify
  // accept BOTH PKCS#1 and PKCS#8 PEMs, so this is robust to whichever an
  // operator pastes. Railway env vars often carry the PEM with literal "\n"
  // escapes instead of real newlines; normalize before handing it to OpenSSL.
  const privateKey = normalizePem(config.githubAppPrivateKey);

  const iat = now - 60; // clock skew tolerance
  const exp = now + 9 * 60; // GitHub's hard max is 10 minutes
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat, exp, iss: config.githubAppId };

  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  const token = `${signingInput}.${b64url(signature)}`;

  cachedJwt = { token, exp };
  return token;
}

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

// Calls the AMBIENT global fetch (not a captured reference) so tests can
// swap globalThis.fetch. Wraps the network call: a thrown error (DNS, abort,
// TLS…) collapses to `null` here so every caller has one shape to handle,
// instead of a propagating exception each call site would need to catch
// itself.
async function ghFetch(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any } | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "redlens-preview",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON (e.g. 5xx html) — leave null */
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// App metadata (install URL)
// ---------------------------------------------------------------------------

// The App's public install page — https://github.com/apps/<slug>/installations/new.
// We only configure the numeric app id + private key, not the slug, so derive it
// from GET /app (an app-JWT call). Cached on first success for the process; a
// failure returns null (and is NOT cached, so the next request retries) so the
// caller falls back to generic "ask the owner" copy rather than a broken link.
let cachedInstallUrl: string | null = null;

/** The App's install URL, or null if it couldn't be determined (unconfigured/failed). */
export async function appInstallUrl(): Promise<string | null> {
  if (cachedInstallUrl) return cachedInstallUrl;
  if (!config.githubAppId || !config.githubAppPrivateKey) return null;
  const r = await ghFetch("https://api.github.com/app", await appJwt());
  const slug = r?.ok ? r.json?.slug : null;
  if (typeof slug === "string" && slug) cachedInstallUrl = `https://github.com/apps/${slug}/installations/new`;
  return cachedInstallUrl;
}

// ---------------------------------------------------------------------------
// Installation lookup + token minting
// ---------------------------------------------------------------------------

const INSTALLATION_CACHE_MAX = 1000; // FIFO cap — matches handler.ts's RESOLVE_CACHE_MAX pattern
// TTL'd (unlike the old permanent cache): an uninstall+reinstall mints a NEW
// installation id, so a permanently-cached old id would strand the repo on a
// dead id until process restart. Bounded staleness + eviction-on-mint-failure
// (see installationToken) recover from a reinstall promptly.
const INSTALLATION_ID_TTL_MS = 30 * 60_000;
const installationIdCache = new Map<string, { id: number; exp: number }>();

/** The App's installation id for `repo`, or null if not installed / lookup failed. */
export async function installationIdForRepo(repo: string): Promise<number | null> {
  const now = Date.now();
  const cached = installationIdCache.get(repo);
  if (cached && cached.exp > now) return cached.id;

  const r = await ghFetch(`https://api.github.com/repos/${repo}/installation`, await appJwt());
  if (!r) return null; // network throw
  if (!r.ok) {
    // 404 = App not installed on this repo — an expected, non-error outcome,
    // so no log. Anything else (401/403/5xx/…) is unexpected; log at debug
    // and still return null — an uninstalled-looking repo is the safe read.
    if (r.status !== 404) console.debug(`[github-app] installation lookup failed for ${repo}: ${r.status}`);
    return null;
  }
  const id = r.json?.id;
  if (typeof id !== "number") return null;

  installationIdCache.set(repo, { id, exp: now + INSTALLATION_ID_TTL_MS });
  if (installationIdCache.size > INSTALLATION_CACHE_MAX) {
    installationIdCache.delete(installationIdCache.keys().next().value!);
  }
  return id;
}

interface TokenCacheEntry {
  token: string;
  exp: number; // ms epoch; our own cache cutoff, already backed off from GitHub's real 60min expiry
}
const TOKEN_CACHE_MAX = 1000;
const installationTokenCache = new Map<string, TokenCacheEntry>();

/** A short-lived, repo-scoped installation access token, or null if unavailable. */
export async function installationToken(repo: string): Promise<string | null> {
  const now = Date.now();
  const cached = installationTokenCache.get(repo);
  if (cached && cached.exp > now) return cached.token;

  const id = await installationIdForRepo(repo);
  if (id === null) return null;

  const r = await ghFetch(`https://api.github.com/app/installations/${id}/access_tokens`, await appJwt(), {
    method: "POST",
  });
  if (!r || !r.ok) {
    // A mint failure against a cached id is the tell-tale of a removed/reinstalled
    // installation (the id is now dead). Evict it so the next call re-resolves the
    // current installation id instead of retrying the stale one until it expires.
    installationIdCache.delete(repo);
    return null;
  }

  // Treat the token as opaque — GitHub is rolling out a longer stateless
  // format, so no assumption about a "ghs_..." prefix or fixed length.
  const token = r.json?.token;
  if (typeof token !== "string" || !token) return null;

  // GitHub tokens expire ~60min from mint; cache for 55min so we refresh a
  // little early instead of racing expiry mid-request.
  installationTokenCache.set(repo, { token, exp: now + 55 * 60_000 });
  if (installationTokenCache.size > TOKEN_CACHE_MAX) {
    installationTokenCache.delete(installationTokenCache.keys().next().value!);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Repo-scoped calls (installation token)
// ---------------------------------------------------------------------------

/** Whether `repo` is private, or null if the App isn't installed / the call failed. */
export async function repoIsPrivate(repo: string): Promise<boolean | null> {
  const token = await installationToken(repo);
  if (!token) return null;

  const r = await ghFetch(`https://api.github.com/repos/${repo}`, token);
  if (!r || !r.ok) return null;
  return typeof r.json?.private === "boolean" ? r.json.private : null;
}

export type PermissionResult =
  | { ok: true; userId: number; permission: string }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "unavailable" };

/**
 * Effective repo permission for `login` (highest across repo/team/org/
 * enterprise grants — that's what this endpoint returns). Fails closed:
 * anything short of a clean, well-typed grant denies.
 */
export async function userRepoPermission(repo: string, login: string): Promise<PermissionResult> {
  const token = await installationToken(repo);
  if (!token) return { ok: false, reason: "unavailable" };

  const r = await ghFetch(
    `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
    token,
  );
  if (!r) return { ok: false, reason: "unavailable" }; // network throw

  // 404 is GitHub's documented shape for "not a collaborator" — a clean deny,
  // not a failure.
  if (r.status === 404) return { ok: false, reason: "forbidden" };
  // 5xx (and any other non-ok, e.g. a misbehaving/rate-limited 4xx) is a
  // genuine uncertainty, not a permission answer — fail closed as
  // "unavailable" rather than reading it as a deny or a grant.
  if (!r.ok) return { ok: false, reason: "unavailable" };

  const permission = r.json?.permission;
  if (permission === "none") return { ok: false, reason: "forbidden" };

  const userId = r.json?.user?.id;
  const hasRead =
    permission === "read" ||
    permission === "write" ||
    permission === "admin" ||
    r.json?.user?.permissions?.pull === true;

  if (hasRead && typeof userId === "number") {
    return { ok: true, userId, permission };
  }
  // Any other shape (missing/non-numeric user id, unrecognized permission
  // string) — don't guess, deny.
  return { ok: false, reason: "forbidden" };
}

// ---------------------------------------------------------------------------
// Test-only cache reset
// ---------------------------------------------------------------------------

/** Clears in-process caches. Test-only — production code never needs this. */
export function __resetCachesForTest(): void {
  cachedJwt = null;
  cachedInstallUrl = null;
  installationIdCache.clear();
  installationTokenCache.clear();
}
