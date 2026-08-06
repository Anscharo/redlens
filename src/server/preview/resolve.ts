// Preview id resolution.
//
// A preview URL id is human and mutable; it resolves to an immutable head SHA.
// Forms:
//   pull-256           → PR #256 against the canonical repo (head may be a fork)
//   owner:branch       → branch `branch` on `owner/next-gen-atlas` (a fork)
//   owner:repo:branch  → branch on `owner/repo` (a RENAMED fork — the repo name
//                        never mattered for safety, only lineage does)
//   branch             → branch on the canonical repo
//   <40-hex>           → a pinned SHA (repo recovered from the previews table upstream)
// `/` in a branch name is encoded as `~` in the URL id (git forbids `~` in refs,
// so the mapping is unambiguous and reversible). The extra `:` separators are
// unambiguous too: git forbids `:` in refs and GitHub forbids it in owner/repo
// names.
//
// Fork screening: any non-canonical repo (including a canonical-owner repo that
// isn't THE atlas) resolves only if it is a TRUE fork of the canonical atlas
// (GitHub `fork: true` + parent/source === canonical) — this blocks arbitrary
// repos merely *named* next-gen-atlas. Shared-history and trust screening
// happen downstream (build.ts).

import { config } from "../config.ts";
import { installationIdForRepo, installationToken } from "./github-app.ts";

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
    let rest = raw.slice(ci + 1);
    // Optional repo segment (owner:repo:branch) for renamed forks.
    let repoName = ATLAS_REPO_NAME;
    const ci2 = rest.indexOf(":");
    if (ci2 >= 0) {
      repoName = rest.slice(0, ci2);
      rest = rest.slice(ci2 + 1);
    }
    const ref = decodeRef(rest);
    if (!owner || !repoName || !ref || ref.includes(":")) return null;
    return { kind: "branch", owner, repo: `${owner}/${repoName}`, ref };
  }
  const ref = decodeRef(raw);
  return { kind: "branch", owner: CANONICAL_OWNER, repo: CANONICAL_REPO, ref };
}

/** Trigger gate. Pure. Fork branches now pass — they're screened by lineage
 *  (resolveRef) + trust (build). Kept as a hook for future grammar-level gates. */
export function gateError(_p: ParsedId): "gate-rejected" | null {
  return null;
}

/** Is this resolved preview a fork? Anything that isn't THE canonical repo —
 *  a same-owner lookalike repo is fork-treated too. */
export function isFork(repo: string): boolean {
  return repo !== CANONICAL_REPO;
}

/** Fork owner from a repo slug ("owner/name" → "owner"). */
export function repoOwner(repo: string): string {
  return repo.split("/")[0] ?? "";
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
  /** ISO date of the head commit — the real "when did this change happen" behind
   *  the preview, so its entry can carry a date like a live history entry does.
   *  Absent when GitHub didn't return one (the preview still builds). */
  date?: string;
  /** True only for a private, non-canonical BRANCH preview resolved through the
   *  GitHub App installation path (see resolvePrivacy). PRs and the canonical
   *  repo are always public — this field is explicit `false` there too so the
   *  contract is obvious at every return site. */
  private?: boolean;
}

/** Head-commit date from a GitHub commit-ish payload (branches and commits both
 *  nest it the same way). Committer date is when it landed on the ref. */
function commitDate(json: any): string | undefined {
  const c = json?.commit?.commit ?? json?.commit;
  return c?.committer?.date ?? c?.author?.date ?? undefined;
}

export type ResolveError = "gate-rejected" | "not-found" | "not-a-fork" | "app-not-installed";

/**
 * Is `repo` public, private, or does the private-preview GitHub App simply not
 * cover it? Uses the passed (service-token) `gh` client first — a plain public
 * repo never needs the App at all. Only on a 404 (repo invisible to the
 * service token — the common shape for a private repo the service token can't
 * see) do we fall back to asking whether the App is installed on it: if it is,
 * the repo is private (and reachable via the installation token downstream);
 * if not, the App simply isn't set up for it.
 */
export async function resolvePrivacy(
  repo: string,
  gh: GhClient,
): Promise<"public" | "private" | "app-not-installed" | "not-found"> {
  const r = await gh.fetchJson(`/repos/${repo}`);
  if (r.ok && r.json?.private === false) return "public";
  if (r.ok && r.json?.private === true) return "private";
  if (r.status === 404) {
    const installationId = await installationIdForRepo(repo);
    return installationId !== null ? "private" : "app-not-installed";
  }
  return "not-found";
}

/** Network screen for non-canonical owners: the repo must be a TRUE GitHub fork
 *  of the canonical atlas. This is a CAPABILITY check, not a trust check — only
 *  repos in the canonical fork network can be merge-base-compared by GitHub's
 *  API, and without that compare there is no accurate diff to redline against.
 *  (It also rejects lookalike repos merely named next-gen-atlas with a crisp
 *  error instead of a confusing downstream compare failure. Trust is screened
 *  separately, by owner/author merged-PR history — see trust.ts.) */
export async function checkForkLineage(repo: string, gh: GhClient): Promise<"ok" | "not-a-fork" | "not-found"> {
  const r = await gh.fetchJson(`/repos/${repo}`);
  if (r.status === 404 || !r.ok) return "not-found";
  const parent = r.json?.parent?.full_name;
  const source = r.json?.source?.full_name;
  return r.json?.fork === true && (parent === CANONICAL_REPO || source === CANONICAL_REPO) ? "ok" : "not-a-fork";
}

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
    // The pulls payload carries no head-commit date, so ask for the commit
    // itself. Best-effort: a failure here only costs the entry its date.
    const c = await gh.fetchJson(`/repos/${head.repo.full_name}/commits/${head.sha}`);
    return {
      repo: head.repo.full_name,
      sha: head.sha,
      kind: "pr",
      ref: `pull-${p.prNumber}`,
      pr: { number: p.prNumber, title: r.json.title ?? "", author: r.json.user?.login ?? "", state },
      date: c.ok ? commitDate(c.json) : undefined,
      private: false,
    };
  }

  // sha ids are resolved upstream via the previews table, not here.
  if (p.kind === "sha") return { error: "not-found" };

  // branch — canonical or fork. Non-canonical repos are screened for privacy
  // first (private-preview grammar is branch-only — PRs above are always
  // public), then either routed through the installation-token path or fall
  // through to the existing public fork-lineage screen unchanged.
  if (p.repo !== CANONICAL_REPO) {
    if (config.privatePreviewsEnabled) {
      const privacy = await resolvePrivacy(p.repo, gh);
      if (privacy === "app-not-installed") return { error: "app-not-installed" };
      if (privacy === "private") {
        const tok = await installationToken(p.repo);
        if (!tok) return { error: "app-not-installed" };
        const igh = makeGhClient(tok);
        const r = await igh.fetchJson(`/repos/${p.repo}/branches/${encodeURIComponent(p.ref)}`);
        const sha = r.json?.commit?.sha;
        if (r.status === 404 || !r.ok || !sha) return { error: "not-found" };
        return { repo: p.repo, sha, kind: "branch", ref: p.ref, date: commitDate(r.json), private: true };
      }
      // "public" or "not-found" — fall through to the existing public path below.
    }
    const lineage = await checkForkLineage(p.repo, gh);
    if (lineage !== "ok") return { error: lineage === "not-found" ? "not-found" : "not-a-fork" };
  }
  const r = await gh.fetchJson(`/repos/${p.repo}/branches/${encodeURIComponent(p.ref)}`);
  const sha = r.json?.commit?.sha;
  if (r.status === 404 || !r.ok || !sha) return { error: "not-found" };
  return { repo: p.repo, sha, kind: "branch", ref: p.ref, date: commitDate(r.json), private: false };
}
