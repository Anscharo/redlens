// Preview id resolution.
//
// A preview URL id is human and mutable; it resolves to an immutable head SHA.
// Forms:
//   pull-256          → PR #256 against the canonical repo (head may be a fork)
//   owner:branch      → branch `branch` on `owner/next-gen-atlas` (a fork)
//   branch            → branch on the canonical repo
//   <40-hex>          → a pinned SHA (repo recovered from the previews table upstream)
// `/` in a branch name is encoded as `~` in the URL id (git forbids `~` in refs,
// so the mapping is unambiguous and reversible).
//
// MVP trigger gate: only PRs (incl. fork-head PRs) and canonical-repo branches
// resolve. A bare fork branch (`owner:branch`, owner ≠ canonical) is gate-rejected
// until arbitrary-fork safety screening lands (P2).

export const CANONICAL_OWNER = "sky-ecosystem";
export const ATLAS_REPO_NAME = "next-gen-atlas";
export const CANONICAL_REPO = `${CANONICAL_OWNER}/${ATLAS_REPO_NAME}`;

export type ParsedId =
  | { kind: "sha"; sha: string }
  | { kind: "pr"; prNumber: number }
  | { kind: "branch"; owner: string; repo: string; ref: string };

const SHA_RE = /^[0-9a-f]{40}$/i;
const PULL_RE = /^pull-(\d+)$/;

function decodeRef(s: string): string {
  return s.replaceAll("~", "/");
}

/** Parse a URL id segment into a structured ref. Pure; null = unparseable. */
export function decodeId(raw: string): ParsedId | null {
  if (!raw) return null;
  if (SHA_RE.test(raw)) return { kind: "sha", sha: raw.toLowerCase() };

  const pm = raw.match(PULL_RE);
  if (pm) return { kind: "pr", prNumber: Number(pm[1]) };

  const ci = raw.indexOf(":");
  if (ci >= 0) {
    const owner = raw.slice(0, ci);
    const ref = decodeRef(raw.slice(ci + 1));
    if (!owner || !ref) return null;
    return { kind: "branch", owner, repo: `${owner}/${ATLAS_REPO_NAME}`, ref };
  }
  const ref = decodeRef(raw);
  return { kind: "branch", owner: CANONICAL_OWNER, repo: CANONICAL_REPO, ref };
}

/** MVP trigger gate. Pure. */
export function gateError(p: ParsedId): "gate-rejected" | null {
  if (p.kind === "branch" && p.owner !== CANONICAL_OWNER) return "gate-rejected";
  return null;
}

// ---------------------------------------------------------------------------
// GitHub resolution
// ---------------------------------------------------------------------------

export interface GhClient {
  fetchJson(path: string): Promise<{ ok: boolean; status: number; json: any }>;
}

export function makeGhClient(token: string): GhClient {
  return {
    async fetchJson(path) {
      const res = await fetch(`https://api.github.com${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "redlens-preview",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON (e.g. 5xx html) — leave null */
      }
      return { ok: res.ok, status: res.status, json };
    },
  };
}

export interface Resolved {
  repo: string; // owner/name for the tarball download
  sha: string;
  kind: "pr" | "branch";
  ref: string; // human label (pull-256, branch name)
  pr?: { number: number; title: string; author: string; state: "open" | "merged" | "closed" };
}

export type ResolveError = "gate-rejected" | "not-found";

/**
 * Resolve a parsed pr/branch id to its head SHA via the GitHub API. `sha` ids are
 * resolved upstream (repo comes from the previews table), not here.
 */
export async function resolveRef(p: ParsedId, gh: GhClient): Promise<Resolved | { error: ResolveError }> {
  const ge = gateError(p);
  if (ge) return { error: ge };

  if (p.kind === "pr") {
    const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls/${p.prNumber}`);
    const head = r.json?.head;
    if (r.status === 404 || !r.ok || !head?.repo?.full_name || !head?.sha) return { error: "not-found" };
    const state: "open" | "merged" | "closed" = r.json.merged_at
      ? "merged"
      : r.json.state === "closed"
        ? "closed"
        : "open";
    return {
      repo: head.repo.full_name,
      sha: head.sha,
      kind: "pr",
      ref: `pull-${p.prNumber}`,
      pr: { number: p.prNumber, title: r.json.title ?? "", author: r.json.user?.login ?? "", state },
    };
  }

  // branch (canonical only — gate already rejected forks)
  const r = await gh.fetchJson(`/repos/${p.repo}/branches/${encodeURIComponent(p.ref)}`);
  const sha = r.json?.commit?.sha;
  if (r.status === 404 || !r.ok || !sha) return { error: "not-found" };
  return { repo: p.repo, sha, kind: "branch", ref: p.ref };
}
