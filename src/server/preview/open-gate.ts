// The resolve → authorize → takedown steps every preview opener runs before it
// may learn a sha: the SSE build stream (handler.ts drive()) and the chat/MCP
// preview tools (tool-access.ts). One implementation so the fail-closed order
// cannot drift between the two.
//
// Authorization runs BEFORE any sha leaves this module and, for a deferred
// private resolution, before the branch/PR → sha lookup itself, so an
// unauthorized caller can never probe whether a private branch or PR exists.
// The caller supplies the decision function; nothing here caches it.

import type { AccessDecision } from "./access.ts";
import { resolvePrivateBranch, type Resolved, type ResolveError } from "./resolve.ts";
import { resolveId } from "./resolve-id.ts";
import { isBlockedSha } from "./db.ts";
import { remove as removeBundle, type PreviewMeta } from "./cache.ts";

export type GateDenial = ResolveError | Exclude<AccessDecision, "ok">;
export interface GateDenied {
  denied: GateDenial;
  /** The repo the denial concerns, when known — for the install-link message. */
  repo?: string;
}
export interface GateOpened {
  r: Resolved;
  /** True when `r` came from resolvePrivateBranch on this call (fresh install data). */
  viaPrivateResolve: boolean;
}

export async function resolveAuthorized(
  rawId: string,
  authorize: (repo: string) => Promise<AccessDecision>,
): Promise<GateOpened | GateDenied> {
  const resolved = await resolveId(rawId);
  if ("error" in resolved) return { denied: resolved.error };
  if ("authRequired" in resolved) {
    const d = await authorize(resolved.repo);
    if (d !== "ok") return { denied: d };
    const done = await resolvePrivateBranch(resolved.repo, resolved.ref);
    if ("error" in done) return { denied: done.error, repo: resolved.repo };
    return { r: done, viaPrivateResolve: true };
  }
  if (resolved.private) {
    const d = await authorize(resolved.repo);
    if (d !== "ok") return { denied: d };
  }
  return { r: resolved, viaPrivateResolve: false };
}

/** Admin takedown: a blocked sha neither serves its cached bundle nor rebuilds.
 *  A failed lookup reads as not blocked, matching the stream's behaviour. */
export async function takedownBlocked(sha: string): Promise<boolean> {
  if (!(await isBlockedSha(sha).catch(() => false))) return false;
  removeBundle(sha);
  return true;
}

/** A ready bundle that predates a base the resolve now has: a private PR first
 *  built without Pull requests:read (no prBase on disk), or one that recorded no
 *  base at all before a default branch could stand in. Rebuilding is same-sha,
 *  so the new-sha quota gate does not fire. Never downgrades a recorded prBase. */
export function needsBaseRebuild(r: Resolved, meta: PreviewMeta | null): boolean {
  return !!((r.prBase && !meta?.prBase) || (r.defaultBranch && !meta?.defaultBranch && !meta?.prBase));
}
