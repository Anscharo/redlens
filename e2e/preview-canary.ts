// Candidate selection + expected-diff derivation for the Atlas-preview canary.
//
// The preview server diffs uuid-keyed doc snapshots of a PR's MERGE BASE vs its
// head (src/server/preview/pr-diff.ts + snapshot.ts). To assert on its output
// we derive the same expectation independently: fetch each changed content file
// at both commits, split into per-doc sections (e2e/atlas-sections.ts, which
// owns the diffSnapshots-aligned comparison), and collect the changed uuids.
// Fork-head PRs are eligible — the preview is built to serve them (resolve.ts:
// "pull-N → PR against the canonical repo (head may be a fork)"), and most
// content-editing atlas PRs come from contributor forks — so head-side files
// are fetched from the PR's own head repo, base-side from canonical at the
// merge base. This reads the CONSOLIDATED layout (content/<name>.md, upstream
// #294 on) only — if upstream regroups again, discovery stops matching and the
// scheduled skip-streak guard (check-canary-skips.mjs) turns that silence into
// a red run.

import { changedDocIds, splitByUuid, type DocSection } from "./atlas-sections.ts";

export const CANONICAL = "sky-ecosystem/next-gen-atlas";
const API = "https://api.github.com";
// Composed files sit directly under content/. Renames are excluded: their base
// side lives at previous_filename, which the raw-diff below doesn't chase.
export const CONTENT_FILE_RE = /^content\/[^/]+\.md$/;
// The consolidated layout is ~16 composed files, so no per-candidate cap is
// needed; the files listing is paginated a few pages deep so a large PR can't
// bury its content files past page one.
const MAX_FILE_PAGES = 3;

export interface CanaryTarget {
  number: number;
  headSha: string;
  headRepo: string;
  expectedIds: string[];
}

type PrPayload = {
  number: number;
  state: string;
  base?: { ref?: string };
  head?: { sha?: string; repo?: { full_name?: string } | null };
};

function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const h: Record<string, string> = { "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghJson<T>(fetchImpl: typeof fetch, path: string): Promise<T | null> {
  const res = await fetchImpl(`${API}${path}`, { headers: ghHeaders() });
  return res.ok ? ((await res.json()) as T) : null;
}

export function rawUrl(repo: string, sha: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/${sha}/${encoded}`;
}

async function contentFiles(fetchImpl: typeof fetch, prNumber: number): Promise<string[] | null> {
  const names: string[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const files = await ghJson<Array<{ filename: string; status: string }>>(
      fetchImpl,
      `/repos/${CANONICAL}/pulls/${prNumber}/files?per_page=100&page=${page}`,
    );
    if (!files) return null;
    for (const f of files) {
      if (CONTENT_FILE_RE.test(f.filename) && (f.status === "added" || f.status === "modified")) {
        names.push(f.filename);
      }
    }
    if (files.length < 100) break;
  }
  return names;
}

/** Expected changed-doc ids for one PR head, or null when the PR yields none
 *  (no consolidated content files, unresolvable merge base, or no changed
 *  UUID sections — all reasons to try the next candidate). */
async function expectedIdsFor(fetchImpl: typeof fetch, pr: PrPayload): Promise<string[] | null> {
  const headSha = pr.head?.sha;
  const headRepo = pr.head?.repo?.full_name;
  if (!headSha || !headRepo) return null;
  const files = await contentFiles(fetchImpl, pr.number);
  if (!files?.length) return null;

  // Plain head SHA, exactly like the server's pr-diff.ts: fork PR head commits
  // are reachable in the canonical repo's network, so no owner qualifier.
  const baseRef = pr.base?.ref ?? "main";
  const cmp = await ghJson<{ merge_base_commit?: { sha?: string } }>(
    fetchImpl,
    `/repos/${CANONICAL}/compare/${encodeURIComponent(baseRef)}...${headSha}`,
  );
  const mergeBase = cmp?.merge_base_commit?.sha;
  if (!mergeBase) return null;

  const baseDocs = new Map<string, DocSection>();
  const headDocs = new Map<string, DocSection>();
  for (const f of files) {
    for (const [repo, sha, into] of [
      [CANONICAL, mergeBase, baseDocs],
      [headRepo, headSha, headDocs],
    ] as const) {
      const res = await fetchImpl(rawUrl(repo, sha, f));
      // 404 on the base side = file added by the PR; every side stays optional.
      if (!res.ok) continue;
      for (const [id, section] of splitByUuid(await res.text())) into.set(id, section);
    }
  }
  const ids = changedDocIds(baseDocs, headDocs);
  return ids.length ? ids : null;
}

function toTarget(pr: PrPayload, expectedIds: string[]): CanaryTarget {
  return { number: pr.number, headSha: pr.head!.sha!, headRepo: pr.head!.repo!.full_name!, expectedIds };
}

/** Validate an operator-pinned PR (dispatch runs). Returns a target or a
 *  human skip reason — pins are exact: a moved head is a skip, not a retarget. */
export async function pinnedCanary(
  fetchImpl: typeof fetch,
  number: number,
  expectedSha: string,
): Promise<CanaryTarget | { reason: string }> {
  const pr = await ghJson<PrPayload>(fetchImpl, `/repos/${CANONICAL}/pulls/${number}`);
  if (!pr) return { reason: `could not load atlas PR #${number}` };
  if (pr.state !== "open") return { reason: `atlas PR #${number} is ${pr.state}` };
  if (pr.head?.sha !== expectedSha) {
    return { reason: `atlas PR #${number} moved from ${expectedSha} to ${pr.head?.sha}` };
  }
  if (!pr.head?.repo?.full_name) {
    return { reason: `atlas PR #${number} has no reachable head repository` };
  }
  const expectedIds = await expectedIdsFor(fetchImpl, pr);
  if (!expectedIds) return { reason: `atlas PR #${number} yields no changed content docs` };
  return toTarget(pr, expectedIds);
}

/** Scheduled runs: pick the newest open PR (canonical or fork head) that
 *  changes docs we can derive expectations for. A reason instead of a target =
 *  nothing eligible right now — an honest skip the streak guard keeps from
 *  staying silent forever. */
export async function discoverCanary(
  fetchImpl: typeof fetch,
): Promise<CanaryTarget | { reason: string }> {
  const prs = await ghJson<PrPayload[]>(
    fetchImpl,
    `/repos/${CANONICAL}/pulls?state=open&sort=created&direction=desc&per_page=30`,
  );
  if (!prs) return { reason: "could not list open atlas PRs" };
  for (const pr of prs) {
    // head.repo is null when the fork was deleted; such PRs can't be fetched.
    if (!pr.head?.sha || !pr.head?.repo?.full_name) continue;
    const expectedIds = await expectedIdsFor(fetchImpl, pr);
    if (expectedIds) return toTarget(pr, expectedIds);
  }
  return { reason: `no open ${CANONICAL} PR currently modifies consolidated content docs` };
}

/** The moved-during-build recheck the spec runs after the preview settles. */
export async function currentHeadSha(fetchImpl: typeof fetch, number: number): Promise<string | null> {
  const pr = await ghJson<PrPayload>(fetchImpl, `/repos/${CANONICAL}/pulls/${number}`);
  return pr?.head?.sha ?? null;
}
