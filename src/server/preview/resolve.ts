// Preview id resolution.
//
// A preview URL id is human and mutable; it resolves to an immutable head SHA.
// Forms:
//   pull-256           → PR #256 against the canonical repo (head may be a fork)
//   owner:branch       → branch `branch` on `owner/next-gen-atlas` (a fork)
//   owner:repo:branch  → branch on `owner/repo` (a RENAMED fork — the repo name
//                        never mattered for safety, only lineage does)
//   owner:repo:pull-N  → PR #N against `owner/repo` (private-preview grammar).
//                        Resolves to that PR's HEAD commit; compared against
//                        the PR's own base branch, same as every PR form below.
//   branch             → branch on the canonical repo
//   <40-hex>           → a pinned SHA (repo recovered from the previews table upstream)
// `/` in a branch name is encoded as `~` in the URL id (git forbids `~` in refs,
// so the mapping is unambiguous and reversible). The extra `:` separators are
// unambiguous too: git forbids `:` in refs and GitHub forbids it in owner/repo
// names.
//
// Diff base: a PR preview is redlined against its own declared base branch
// (`Resolved.prBase`, read off the Pulls payload) — never canonical
// next-gen-atlas main. A fork BRANCH preview (no PR) declares no base, so it
// redlines against the later of two candidates: its fork point with sky main,
// and its merge base with the fork's own default branch (`Resolved.defaultBranch`)
// — that candidate selection runs downstream (build.ts/pr-diff.ts); this module
// only resolves the ref and hands back the candidates it read from GitHub.
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
/** The canonical repo's default branch — the `sky` diff-base ref. */
export const CANONICAL_MAIN_REF = "main"; // fragile: update if sky-ecosystem/next-gen-atlas renames its default branch

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

type RepoLookup = { ok: boolean; status: number; json: any };

/** GET /repos/{repo} — read by resolvePrivacy, checkForkLineage, and default-
 *  branch population, up to three checks that can all run within a single
 *  resolveRef/resolvePrivateBranch call for one non-canonical repo. `cache`
 *  (keyed by repo, scoped to that one call by its caller) keeps it to one
 *  round-trip instead of up to three. */
async function repoInfo(gh: GhClient, repo: string, cache?: Map<string, RepoLookup>): Promise<RepoLookup> {
  const hit = cache?.get(repo);
  if (hit) return hit;
  const r = await gh.fetchJson(`/repos/${repo}`);
  cache?.set(repo, r);
  return r;
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
  /** True only for a private, non-canonical preview resolved through the
   *  GitHub App installation path (see resolvePrivacy). Canonical-repo PRs
   *  (`pull-N`) are always public — this field is explicit `false` there too
   *  so the contract is obvious at every return site. Private `owner:repo:pull-N`
   *  ids resolve as kind "branch" (the PR's HEAD) with this flag set. */
  private?: boolean;
  /** The PR's declared base branch — the `repo` diff-base candidate for every
   *  PR preview (canonical `pull-N`, public and private `owner:repo:pull-N`).
   *  Read off the Pulls payload (`base.repo.full_name`, `base.ref`, `base.sha`);
   *  absent when the PR HEAD came from the `refs/pull/N/head` fallback (the
   *  GitHub App lacks Pull requests:read), in which case the preview follows
   *  branch rules. `sha` is absent on a pinned-sha rebuild from the previews
   *  row (only repo + ref are persisted); base-drift re-resolves the tip. */
  prBase?: { repo: string; ref: string; sha?: string };
  /** The head repo's default branch (non-canonical branch previews only) — the
   *  `repo` diff-base candidate for a fork branch. Absent for canonical refs
   *  (where it would coincide with sky main) and for PRs (prBase covers it). */
  defaultBranch?: string;
}

/** Head-commit date from a GitHub commit-ish payload (branches and commits both
 *  nest it the same way). Committer date is when it landed on the ref. */
function commitDate(json: any): string | undefined {
  const c = json?.commit?.commit ?? json?.commit;
  return c?.committer?.date ?? c?.author?.date ?? undefined;
}

export type ResolveError = "gate-rejected" | "not-found" | "not-a-fork" | "app-not-installed";

/** Interim result for a private, non-canonical preview: the repo is known
 *  and confirmed private (the App is installed), but the branch/PR→sha lookup
 *  is deliberately withheld until the handler has authorized the caller (G7).
 *  resolvePrivateBranch(repo, ref) finishes the resolution once authorized
 *  (a `pull-N` ref is the private-PR form). */
export interface PendingPrivate {
  authRequired: true;
  repo: string;
  ref: string;
}

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
  cache?: Map<string, RepoLookup>,
): Promise<"public" | "private" | "app-not-installed" | "not-found"> {
  const r = await repoInfo(gh, repo, cache);
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
export async function checkForkLineage(
  repo: string,
  gh: GhClient,
  cache?: Map<string, RepoLookup>,
): Promise<"ok" | "not-a-fork" | "not-found"> {
  const r = await repoInfo(gh, repo, cache);
  if (r.status === 404 || !r.ok) return "not-found";
  const parent = r.json?.parent?.full_name;
  const source = r.json?.source?.full_name;
  return r.json?.fork === true && (parent === CANONICAL_REPO || source === CANONICAL_REPO) ? "ok" : "not-a-fork";
}

/**
 * Resolve a parsed pr/branch id to its head SHA via the GitHub API. `sha` ids are
 * resolved upstream (repo comes from the previews table), not here.
 */
// "HEAD" is the frontend's sentinel for "this repo's default branch" — emitted
// when a bare repo URL (no /tree/<branch>) is pasted. Resolve it to the real
// branch name via repo metadata so the preview's ref/label reads correctly and
// the /branches/<ref> fetch has a concrete branch to hit. A real branch literally
// named "HEAD" (essentially nonexistent — git tooling forbids it) would be
// shadowed; accepted edge case. Every other ref passes through untouched.
async function resolveDefaultBranch(
  gh: GhClient,
  repo: string,
  ref: string,
  cache?: Map<string, RepoLookup>,
): Promise<string | null> {
  if (ref !== "HEAD") return ref;
  const r = await repoInfo(gh, repo, cache);
  const def = r.json?.default_branch;
  return r.ok && typeof def === "string" && def ? def : null;
}

/** The head repo's default branch — the `repo` diff-base candidate for a fork
 *  BRANCH preview (never set for PRs; prBase covers those). Reuses whatever
 *  repoInfo() already fetched/cached for this repo earlier in the same resolve
 *  (the privacy/lineage checks, or the "HEAD" sentinel above) instead of a
 *  dedicated round-trip. */
async function repoDefaultBranch(gh: GhClient, repo: string, cache?: Map<string, RepoLookup>): Promise<string | undefined> {
  const r = await repoInfo(gh, repo, cache);
  const def = r.json?.default_branch;
  return r.ok && typeof def === "string" && def ? def : undefined;
}

function prState(json: any): "open" | "merged" | "closed" {
  return json?.merged_at ? "merged" : json?.state === "closed" ? "closed" : "open";
}

/** The PR's declared base branch, read off a Pulls API payload. Pure. Returns
 *  undefined unless `base.ref` is a real, non-empty string — a payload that
 *  doesn't shape like a PR (or a `refs/pull/N/head` fallback, which carries no
 *  base at all) yields no prBase, and the caller follows branch/fork rules
 *  instead. `fallbackRepo` covers the (in practice always-present, but never
 *  guaranteed) case where GitHub omits `base.repo` — a PR's base branch lives
 *  in the repo the PR was opened against, so that repo is always a safe
 *  fallback. `sha` is included only when GitHub gave one; a pinned-sha rebuild
 *  from the previews row never has it (only repo + ref persist), so base-drift
 *  re-resolves the tip instead of trusting a stale sha. */
export function prBaseOf(pullsJson: any, fallbackRepo: string): Resolved["prBase"] | undefined {
  const base = pullsJson?.base;
  const ref = base?.ref;
  if (typeof ref !== "string" || !ref) return undefined;
  const repo = typeof base?.repo?.full_name === "string" && base.repo.full_name ? base.repo.full_name : fallbackRepo;
  const sha = typeof base?.sha === "string" && base.sha ? base.sha : undefined;
  return { repo, ref, sha };
}

/**
 * Resolve a repo-local PR to its HEAD commit. Prefers the Pulls API (gives the
 * head *branch* name + metadata, plus the base branch via prBaseOf); falls back
 * to `refs/pull/N/head` which only needs Contents:read — the permission the
 * GitHub App already has, but carries no base branch, so `prBase` is absent on
 * that path and the preview follows branch rules instead. Either way this is
 * the PR's HEAD, never its base branch directly — but a PR is always redlined
 * against its own base branch (`prBase`) when one was resolved, never against
 * canonical next-gen-atlas main.
 */
async function resolvePullHead(
  gh: GhClient,
  repo: string,
  n: number,
): Promise<{ sha: string; ref: string; date?: string; pr?: Resolved["pr"]; prBase?: Resolved["prBase"] } | null> {
  const pr = await gh.fetchJson(`/repos/${repo}/pulls/${n}`);
  const head = pr.json?.head;
  if (pr.ok && typeof head?.sha === "string" && head.sha) {
    const branch = typeof head.ref === "string" && head.ref ? head.ref : `pull-${n}`;
    const headRepo = typeof head.repo?.full_name === "string" && head.repo.full_name ? head.repo.full_name : repo;
    const c = await gh.fetchJson(`/repos/${headRepo}/commits/${head.sha}`);
    return {
      sha: head.sha,
      ref: branch,
      date: c.ok ? commitDate(c.json) : undefined,
      pr: {
        number: n,
        title: pr.json.title ?? "",
        author: pr.json.user?.login ?? "",
        state: prState(pr.json),
      },
      prBase: prBaseOf(pr.json, repo),
    };
  }
  const r = await gh.fetchJson(`/repos/${repo}/git/ref/pull/${n}/head`);
  const sha = r.json?.object?.sha;
  if (!r.ok || typeof sha !== "string" || !sha) return null;
  const c = await gh.fetchJson(`/repos/${repo}/commits/${sha}`);
  return { sha, ref: `pull-${n}`, date: c.ok ? commitDate(c.json) : undefined };
}

export async function resolveRef(
  p: ParsedId,
  gh: GhClient,
): Promise<Resolved | { error: ResolveError } | PendingPrivate> {
  const ge = gateError(p);
  if (ge) return { error: ge };

  if (p.kind === "pr") {
    const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls/${p.prNumber}`);
    const head = r.json?.head;
    if (r.status === 404 || !r.ok || !head?.repo?.full_name || !head?.sha) return { error: "not-found" };
    const state = prState(r.json);
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
      prBase: prBaseOf(r.json, CANONICAL_REPO),
    };
  }

  // sha ids are resolved upstream via the previews table, not here.
  if (p.kind === "sha") return { error: "not-found" };

  // branch — canonical or fork, including the private-preview `pull-N` ref
  // (owner:repo:pull-N). Non-canonical repos are screened for privacy first,
  // then either routed through the installation-token path or fall through to
  // the existing public fork-lineage screen unchanged. Canonical `pull-N` ids
  // (kind "pr" above) stay on the public PR path.
  // repoCache: scoped to this one resolveRef call, so the privacy/lineage/
  // default-branch checks below share a single GET /repos/{repo} instead of
  // each re-fetching it. Only allocated for a non-canonical repo — the
  // canonical repo never needs any of those three checks.
  let repoCache: Map<string, RepoLookup> | undefined;
  if (p.repo !== CANONICAL_REPO) {
    repoCache = new Map();
    if (config.privatePreviewsEnabled) {
      const privacy = await resolvePrivacy(p.repo, gh, repoCache);
      if (privacy === "app-not-installed") return { error: "app-not-installed" };
      if (privacy === "private") {
        // G7: defer the branch→sha lookup (and the installation-token mint it
        // needs) until AFTER authorizePreviewAccess runs in the handler. Doing
        // it here would answer "does this branch exist?" to an unauthorized
        // caller — a real branch resolves (then 'auth-required') while a missing
        // one 404s to 'not-found', a branch-existence oracle on a private repo.
        // Hand back repo+ref only; resolvePrivateBranch finishes once authorized.
        return { authRequired: true, repo: p.repo, ref: p.ref };
      }
      // "public" or "not-found" — fall through to the existing public path below.
    }
    const lineage = await checkForkLineage(p.repo, gh, repoCache);
    if (lineage !== "ok") return { error: lineage === "not-found" ? "not-found" : "not-a-fork" };
  }
  const pn = p.ref.match(PULL_RE);
  if (pn) {
    // Public (or canonical) `owner:repo:pull-N`: resolve the PR HEAD now.
    // `pr`/`prBase` ARE attached (unlike before) — the compare keys on
    // `prBase`, never on `pr.number`, so attaching it no longer risks sending
    // the build down the canonical-PR-base path. Kind stays "branch" (not
    // "pr") so pr-state.ts (which only overlays rows with kind = 'pr') never
    // confuses this fork/private PR with canonical PR #N sharing the same
    // number, and so build.ts's fork/trust screening (which keys on
    // `kind === "pr"`, not on the presence of `pr`) still fork-treats it.
    const head = await resolvePullHead(gh, p.repo, Number(pn[1]));
    if (!head) return { error: "not-found" };
    return {
      repo: p.repo,
      sha: head.sha,
      kind: "branch",
      ref: head.ref,
      date: head.date,
      pr: head.pr,
      prBase: head.prBase,
      private: false,
    };
  }
  const ref = await resolveDefaultBranch(gh, p.repo, p.ref, repoCache);
  if (!ref) return { error: "not-found" };
  const r = await gh.fetchJson(`/repos/${p.repo}/branches/${encodeURIComponent(ref)}`);
  const sha = r.json?.commit?.sha;
  if (r.status === 404 || !r.ok || !sha) return { error: "not-found" };
  // defaultBranch: a fork-branch-only diff-base candidate. Never set for the
  // canonical repo (repoCache is undefined there) and never reached for a PR
  // (handled above) — prBase covers that case instead.
  const defaultBranch = repoCache ? await repoDefaultBranch(gh, p.repo, repoCache) : undefined;
  return { repo: p.repo, sha, kind: "branch", ref, date: commitDate(r.json), private: false, defaultBranch };
}

/**
 * Second half of resolveRef's private branch path (see PendingPrivate), split
 * out so it runs ONLY after authorizePreviewAccess has granted the caller (G7).
 * Mints the installation token, resolves the ref (incl. the "HEAD" default-
 * branch sentinel and a `pull-N` PR HEAD), and looks up the branch tip.
 * Withholding this until post-auth is what keeps a private repo's branch/PR
 * existence from leaking to an unauthorized caller. App-not-installed here
 * means the token could not be minted (e.g. the App was uninstalled between
 * resolve and this call).
 */
export async function resolvePrivateBranch(repo: string, ref: string): Promise<Resolved | { error: ResolveError }> {
  const tok = await installationToken(repo);
  if (!tok) return { error: "app-not-installed" };
  const igh = makeGhClient(tok);
  // Scoped to this one call: resolveDefaultBranch's "HEAD" sentinel lookup and
  // the defaultBranch population below share a single GET /repos/{repo}.
  const repoCache = new Map<string, RepoLookup>();
  const pn = ref.match(PULL_RE);
  if (pn) {
    const head = await resolvePullHead(igh, repo, Number(pn[1]));
    if (!head) return { error: "not-found" };
    // kind stays "branch" so pr-state.ts (kind='pr' against the canonical
    // repo) never overlays this row with some other PR #N's state. `pr` and
    // `prBase` are still attached — `pr` for the banner (title / author /
    // GitHub link), `prBase` as the diff-base candidate; no defaultBranch, a
    // PR is redlined against prBase, not the fork's default branch.
    return { repo, sha: head.sha, kind: "branch", ref: head.ref, date: head.date, pr: head.pr, prBase: head.prBase, private: true };
  }
  const real = await resolveDefaultBranch(igh, repo, ref, repoCache);
  if (!real) return { error: "not-found" };
  const r = await igh.fetchJson(`/repos/${repo}/branches/${encodeURIComponent(real)}`);
  const sha = r.json?.commit?.sha;
  if (r.status === 404 || !r.ok || !sha) return { error: "not-found" };
  const defaultBranch = await repoDefaultBranch(igh, repo, repoCache);
  return { repo, sha, kind: "branch", ref: real, date: commitDate(r.json), private: true, defaultBranch };
}
