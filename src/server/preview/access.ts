// Per-visitor access gate for private atlas previews ("Phase 3 security
// core"). Every uncertain outcome DENIES — a missing session, a missing DB
// row, a stale/never-logged-in github_login, a GitHub API hiccup all fail
// closed. Never widen any branch here to grant access on doubt.
//
// GUARDRAIL: the live GitHub permission check below (mod the ~60s cache) is
// what makes the stateless 7-day session cookie SAFE to serve private
// content against. A future refactor must NOT "optimize" this into a claim
// baked into the session JWT, and must NOT cache a decision long-term — the
// cookie has no way to be revoked early, so only a live-ish recheck keeps a
// removed collaborator's access bounded to the cache TTL instead of 7 days.

import { getSessionUser } from "../session.ts";
import { sql } from "../db.ts";
import { userRepoPermission } from "./github-app.ts";

export type AccessDecision = "ok" | "login-required" | "forbidden" | "unavailable";

interface UserRow {
  provider: string;
  provider_id: string;
  github_login: string | null;
}

// ---------------------------------------------------------------------------
// Negative/positive decision cache — keyed on (provider_id, repo), NOT on
// sha (many shas share a repo) and NOT on repo alone (would blur users
// together). Caching "forbidden" too protects userRepoPermission's own rate
// budget (installation-token minting) from a denied user hammering refresh.
// "unavailable" and "login-required" are deliberately never cached: the
// former is transient (let it recover), the latter has no stable user key.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 1000; // FIFO cap — matches handler.ts's RESOLVE_CACHE_MAX pattern

type CacheableDecision = "ok" | "forbidden";
const accessCache = new Map<string, { at: number; decision: CacheableDecision }>();

function cacheKey(providerId: string, repo: string): string {
  return `${providerId} ${repo}`;
}

function cacheGet(key: string): CacheableDecision | null {
  const hit = accessCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    accessCache.delete(key);
    return null;
  }
  return hit.decision;
}

function cacheSet(key: string, decision: CacheableDecision): void {
  accessCache.set(key, { at: Date.now(), decision });
  if (accessCache.size > CACHE_MAX) {
    accessCache.delete(accessCache.keys().next().value!);
  }
}

/** Test-only: clears the in-process decision cache. Production code never needs this. */
export function __resetAccessCacheForTest(): void {
  accessCache.clear();
}

/**
 * Does the current visitor get to see `repo`'s private preview content?
 * Fail-closed at every step — see the module guardrail comment above.
 */
export async function authorizePreviewAccess(req: Request, repo: string): Promise<AccessDecision> {
  const session = await getSessionUser(req);
  if (!session) return "login-required";

  const rows = (await sql`
    SELECT provider, provider_id, github_login FROM users WHERE id = ${session.user.id}
  `) as UserRow[];
  const row = rows[0];
  if (!row) return "forbidden";

  // GitHub is the only live login provider today; this branch is defensive
  // only (a stray/legacy row) — no Google-specific UX to build here.
  if (row.provider !== "github") return "forbidden";

  // A GitHub user who logged in before migration 015 has a NULL
  // github_login. That's not a permission denial — it's a stale row a fresh
  // login repopulates, so prompt re-login rather than a dead-end "forbidden".
  if (!row.github_login) return "login-required";

  const key = cacheKey(row.provider_id, repo);
  const cached = cacheGet(key);
  if (cached) return cached;

  const perm = await userRepoPermission(repo, row.github_login);

  if (perm.ok) {
    // G4: bind on the immutable numeric GitHub user id, not the login
    // string — logins are re-claimable after a rename, so matching on login
    // alone could grant a renamed-away user's access to whoever claims their
    // old handle.
    const decision: CacheableDecision = perm.userId === Number(row.provider_id) ? "ok" : "forbidden";
    cacheSet(key, decision);
    return decision;
  }

  if (perm.reason === "forbidden") {
    cacheSet(key, "forbidden");
    return "forbidden";
  }
  // perm.reason === "unavailable" — transient, don't cache, let it recover.
  return "unavailable";
}
