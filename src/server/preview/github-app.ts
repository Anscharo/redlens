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
        // An empty token means an unauthenticated call (public endpoints only,
        // e.g. the account-id lookup below); GitHub rejects a bare `Bearer `.
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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

// GitHub's install page also accepts `/installations/new/permissions?target_id=<account id>`,
// which skips the account picker and opens the permission screen for THAT account
// only — so an installer is never offered every org they belong to. The id of a
// user or org is public (GET /users/<login>, no auth needed), so it can be looked
// up for the repo the preview named even though the App can't see the repo yet.
// The repository itself CAN'T be pre-set: `repository_ids[]` ticks "Only select
// repositories" with the listed repos, but a private repo's numeric id is
// invisible until the App is installed on it — exactly the state this link is
// shown in. So we pass a PLACEHOLDER id the account can't own: GitHub drops ids
// the target doesn't own, and the presence of the parameter is what flips the
// selector off its "All repositories" default. Decided 2026-09-17 without a
// verified GitHub reference (docs unreachable from the sandbox) — if the
// install page ever errors on it, drop INSTALL_REPO_PLACEHOLDER first. The
// install screen's copy names the repo to pick either way.
const INSTALL_REPO_PLACEHOLDER = "&repository_ids[]=0";
const OWNER_ID_CACHE_MAX = 1000;
const OWNER_ID_TTL_MS = 24 * 60 * 60_000; // account ids never change; TTL only bounds a deleted/renamed login
const ownerIdCache = new Map<string, { id: number; exp: number }>();

/** Numeric GitHub account id for a user/org login, or null if unknown. Public endpoint. */
export async function accountIdForLogin(login: string): Promise<number | null> {
  const now = Date.now();
  const cached = ownerIdCache.get(login);
  if (cached && cached.exp > now) return cached.id;
  const r = await ghFetch(`https://api.github.com/users/${encodeURIComponent(login)}`, config.githubToken);
  const id = r?.ok ? r.json?.id : null;
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  ownerIdCache.set(login, { id, exp: now + OWNER_ID_TTL_MS });
  if (ownerIdCache.size > OWNER_ID_CACHE_MAX) ownerIdCache.delete(ownerIdCache.keys().next().value!);
  return id;
}

/**
 * The App's install URL, or null if it couldn't be determined (unconfigured/failed).
 * With `repo` ("owner/name"), targets that owner's account when its id resolves
 * (`/installations/new/permissions?target_id=…&repository_ids[]=0`, the placeholder
 * pre-selecting "Only select repositories"); otherwise the generic page.
 */
export async function appInstallUrl(repo?: string): Promise<string | null> {
  if (!cachedInstallUrl) {
    if (!config.githubAppId || !config.githubAppPrivateKey) return null;
    const r = await ghFetch("https://api.github.com/app", await appJwt());
    const slug = r?.ok ? r.json?.slug : null;
    if (typeof slug === "string" && slug) cachedInstallUrl = `https://github.com/apps/${slug}/installations/new`;
    if (!cachedInstallUrl) return null;
  }
  const owner = repo?.split("/")[0];
  if (!owner) return cachedInstallUrl;
  const id = await accountIdForLogin(owner);
  return id === null ? cachedInstallUrl : `${cachedInstallUrl}/permissions?target_id=${id}${INSTALL_REPO_PLACEHOLDER}`;
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

export interface InstallationInfo {
  id: number;
  /** Configure page for this install (user or org). Null if GitHub omitted it. */
  htmlUrl: string | null;
  /** Repo permissions this install has actually granted (not the App's requested set). */
  permissions: Record<string, string>;
  /** GitHub's `repository_selection`: "all" = every repo on the account, "selected" =
   *  a chosen list. Null when GitHub omitted or mis-shaped it. */
  repositorySelection: "all" | "selected" | null;
}

const installationCache = new Map<string, { info: InstallationInfo; exp: number }>();

function parseInstallation(json: any): InstallationInfo | null {
  const id = json?.id;
  if (typeof id !== "number") return null;
  const htmlUrl = typeof json?.html_url === "string" && json.html_url ? json.html_url : null;
  const permissions: Record<string, string> = {};
  const raw = json?.permissions;
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") permissions[k] = v;
    }
  }
  const sel = json?.repository_selection;
  const repositorySelection = sel === "all" || sel === "selected" ? sel : null;
  return { id, htmlUrl, permissions, repositorySelection };
}

/** GitHub's pending-permission review screen for an install, or null if we have no html_url. */
export function permissionsUpdateUrl(htmlUrl: string | null | undefined): string | null {
  if (typeof htmlUrl !== "string" || !htmlUrl) return null;
  return `${htmlUrl.replace(/\/+$/, "")}/permissions/update`;
}

/** True when this install has granted Pull requests: read or write. */
export function installationHasPullsRead(permissions: Record<string, string> | undefined): boolean {
  const p = permissions?.pull_requests;
  return p === "read" || p === "write";
}

/** The App's installation for `repo`, or null if not installed / lookup failed. */
export async function installationInfoForRepo(repo: string): Promise<InstallationInfo | null> {
  const now = Date.now();
  const cached = installationCache.get(repo);
  if (cached && cached.exp > now) return cached.info;

  const r = await ghFetch(`https://api.github.com/repos/${repo}/installation`, await appJwt());
  if (!r) return null; // network throw
  if (!r.ok) {
    // 404 = App not installed on this repo — an expected, non-error outcome,
    // so no log. Anything else (401/403/5xx/…) is unexpected; log at debug
    // and still return null — an uninstalled-looking repo is the safe read.
    if (r.status !== 404) console.debug(`[github-app] installation lookup failed for ${repo}: ${r.status}`);
    return null;
  }
  const info = parseInstallation(r.json);
  if (!info) return null;

  installationCache.set(repo, { info, exp: now + INSTALLATION_ID_TTL_MS });
  if (installationCache.size > INSTALLATION_CACHE_MAX) {
    installationCache.delete(installationCache.keys().next().value!);
  }
  return info;
}

/** The App's installation id for `repo`, or null if not installed / lookup failed. */
export async function installationIdForRepo(repo: string): Promise<number | null> {
  const info = await installationInfoForRepo(repo);
  return info?.id ?? null;
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
    installationCache.delete(repo);
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
  ownerIdCache.clear();
  installationCache.clear();
  installationTokenCache.clear();
}
