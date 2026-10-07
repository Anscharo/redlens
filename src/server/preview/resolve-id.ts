// Preview id → Resolved, shared by the SSE build stream (handler.ts) and the
// chat/MCP preview tools (tool-access.ts). The cache holds the raw resolution
// only; authorization is never cached here and is re-run by every caller.

import { config } from "../config.ts";
import { createCache } from "../ttl-cache.ts";
import { decodeId, gateError, makeGhClient, resolveRef, type Resolved, type PendingPrivate, type ResolveError } from "./resolve.ts";
import { getPreviewRow } from "./db.ts";

export const gh = makeGhClient(config.githubToken);

// Resolution TTL cache (per raw id). Tracks the branch/PR tip so a pushed commit
// is picked up within ~60s without re-hitting GitHub on every request.
// Exported (with the cap) for the eviction regression test only — not otherwise
// consumed outside this module. Mirrors handler.ts's diffCache/DIFF_CACHE_MAX pattern.
export type ResolveResult = Resolved | { error: ResolveError } | PendingPrivate;
// The `{ at, v }` entry shape and the TTL check live here because the eviction test seeds entries in that shape.
export const RESOLVE_CACHE_MAX = 1000; // FIFO cap — prevents indefinite growth under scanner traffic
export const resolveCache = createCache<{ at: number; v: ResolveResult }>({ max: RESOLVE_CACHE_MAX });
const RESOLVE_TTL_MS = 60_000;

// Called through open-gate.ts's resolveAuthorized by the SSE stream and the
// preview tools; tested directly for the sha-rebuild branch (kind/prBase
// reconstruction from a previews row) without a real background build.
export async function resolveId(rawId: string): Promise<ResolveResult> {
  const hit = resolveCache.get(rawId);
  const now = Date.now();
  if (hit && now - hit.at < RESOLVE_TTL_MS) return hit.v;

  const parsed = decodeId(rawId);
  let v: ResolveResult;
  if (!parsed) {
    v = { error: "not-found" };
  } else if (parsed.kind === "sha") {
    // Pinned sha: recover repo from the previews table (durability for a wiped bundle).
    const row = await getPreviewRow(parsed.sha);
    v = row
      ? {
          repo: row.repo,
          sha: row.sha,
          // Rebuild the ORIGINAL kind, not a hardcoded "branch": a canonical PR
          // row must come back as kind "pr" so build.ts's fork/trust screening
          // (keys on kind === "pr", not on the presence of `pr`) never gives it
          // fork treatment, and so pr-state.ts's `kind = 'pr'`-filtered UPDATE
          // still finds it. Everything else (fork/private PRs, plain branches)
          // stays "branch" exactly as resolveRef/resolvePrivateBranch produced it.
          kind: row.kind === "pr" ? "pr" : "branch",
          ref: row.ref,
          pr: row.pr_number
            ? { number: row.pr_number, title: row.pr_title ?? "", author: row.pr_author ?? "", state: (row.pr_state as any) ?? "open" }
            : undefined,
          // No sha here (see Resolved.prBase) — base-drift re-resolves the tip
          // rather than trusting a persisted one. The candidate resolver
          // (pr-diff.ts) keys on `prBase`, never `pr.number`, so this never
          // sends a private PR's number at canonical /pulls/N.
          prBase: row.pr_base_repo && row.pr_base_ref ? { repo: row.pr_base_repo, ref: row.pr_base_ref } : undefined,
          // Same round-trip for a fork branch's `repo` candidate: without it a
          // rebuilt bundle would redline against sky only and lose the switch.
          defaultBranch: row.default_branch ?? undefined,
          private: row.private,
        }
      : { error: "not-found" };
  } else if (gateError(parsed)) {
    // Not unit-tested directly: gateError (resolve.ts, out of scope here) is
    // hardcoded to always return null ("reserved for future grammar-level
    // gates"), so no input reaches this branch's body without changing that
    // file. bun's `/* v8 ignore */` comment did not suppress this line in this
    // file despite matching the syntax used elsewhere in the codebase — left
    // as a known, harmless gap rather than a directive that silently doesn't do
    // what it claims.
    v = { error: "gate-rejected" };
  } else {
    v = await resolveRef(parsed, gh);
  }
  // Don't cache app-not-installed: it flips to resolvable the instant the owner
  // installs the App on the repo, and a stale 60s error would make a fresh
  // install look like it didn't take — the user reloads and still sees "not
  // installed". Every other outcome is stable enough for the short TTL.
  if (!("error" in v) || v.error !== "app-not-installed") {
    resolveCache.set(rawId, { at: now, v });
  }
  return v;
}
