// Candidate selection + expected-diff derivation for the Atlas-preview canary.
//
// The preview server diffs uuid-keyed doc snapshots of a PR's MERGE BASE vs its
// head (src/server/preview/pr-diff.ts + snapshot.ts). To assert on its output
// we derive the same expectation independently: fetch each changed content file
// at both commits, split by the `<!-- UUID: -->` heading marker, and collect
// the docs whose section text is new or different. This reads the CONSOLIDATED
// layout (content/<name>.md, upstream #294 on) only — if upstream regroups
// again, discovery stops matching and the scheduled skip-streak guard
// (check-canary-skips.mjs) turns that silence into a red run.

export const CANONICAL = "sky-ecosystem/next-gen-atlas";
const API = "https://api.github.com";
// Composed files sit directly under content/. Renames are excluded: their base
// side lives at previous_filename, which the raw-diff below doesn't chase.
export const CONTENT_FILE_RE = /^content\/[^/]+\.md$/;
const HEADING_UUID_RE = /^#{1,6} .*<!-- UUID: ([0-9a-fA-F-]{36}) -->\s*$/;
// Composed scope files run to ~1MB; bound the raw downloads per candidate.
const MAX_CONTENT_FILES = 5;

export interface CanaryTarget {
  number: number;
  headSha: string;
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

/** Split a composed content file into heading-inclusive per-doc sections.
 *  Including the heading line means a renumber-only edit still counts as a
 *  change — the preview reports those under `renumbered`, which the spec's
 *  marked-set union covers. */
export function splitByUuid(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(HEADING_UUID_RE);
    if (m) {
      if (current) sections.set(current, buf.join("\n"));
      current = m[1].toLowerCase();
      buf = [line];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections.set(current, buf.join("\n"));
  return sections;
}

/** Docs present in head whose section is new or textually different. Diffed
 *  over the UNION of all changed files, so a doc moved between two files in
 *  the same PR (identical text, both files changed) is not a false change. */
export function changedDocIds(base: Map<string, string>, head: Map<string, string>): string[] {
  const ids: string[] = [];
  for (const [id, text] of head) {
    if (base.get(id) !== text) ids.push(id);
  }
  return ids;
}

/** Expected changed-doc ids for one PR head, or null when the PR yields none
 *  (no consolidated content files, unresolvable merge base, or no extractable
 *  UUID sections — all reasons to try the next candidate). */
async function expectedIdsFor(fetchImpl: typeof fetch, pr: PrPayload): Promise<string[] | null> {
  const headSha = pr.head?.sha;
  if (!headSha) return null;
  const files = await ghJson<Array<{ filename: string; status: string }>>(
    fetchImpl,
    `/repos/${CANONICAL}/pulls/${pr.number}/files?per_page=100`,
  );
  if (!files) return null;
  const contentFiles = files
    .filter((f) => CONTENT_FILE_RE.test(f.filename) && (f.status === "added" || f.status === "modified"))
    .slice(0, MAX_CONTENT_FILES);
  if (!contentFiles.length) return null;

  const baseRef = pr.base?.ref ?? "main";
  const cmp = await ghJson<{ merge_base_commit?: { sha?: string } }>(
    fetchImpl,
    `/repos/${CANONICAL}/compare/${encodeURIComponent(baseRef)}...${headSha}`,
  );
  const mergeBase = cmp?.merge_base_commit?.sha;
  if (!mergeBase) return null;

  const baseDocs = new Map<string, string>();
  const headDocs = new Map<string, string>();
  for (const f of contentFiles) {
    for (const [sha, into] of [
      [mergeBase, baseDocs],
      [headSha, headDocs],
    ] as const) {
      const res = await fetchImpl(rawUrl(CANONICAL, sha, f.filename));
      // 404 on the base side = file added by the PR; every side stays optional.
      if (!res.ok) continue;
      for (const [id, text] of splitByUuid(await res.text())) into.set(id, text);
    }
  }
  const ids = changedDocIds(baseDocs, headDocs);
  return ids.length ? ids : null;
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
  if (pr.head?.repo?.full_name !== CANONICAL) {
    return { reason: `atlas PR #${number} is from ${pr.head?.repo?.full_name ?? "an unknown fork"}` };
  }
  const expectedIds = await expectedIdsFor(fetchImpl, pr);
  if (!expectedIds) return { reason: `atlas PR #${number} yields no changed content docs` };
  return { number, headSha: expectedSha, expectedIds };
}

/** Scheduled runs: pick the newest open canonical-head PR that changes docs we
 *  can derive expectations for. Null target = nothing eligible right now —
 *  an honest skip the streak guard keeps from staying silent forever. */
export async function discoverCanary(
  fetchImpl: typeof fetch,
): Promise<CanaryTarget | { reason: string }> {
  const prs = await ghJson<PrPayload[]>(
    fetchImpl,
    `/repos/${CANONICAL}/pulls?state=open&sort=created&direction=desc&per_page=30`,
  );
  if (!prs) return { reason: "could not list open atlas PRs" };
  for (const pr of prs) {
    if (pr.head?.repo?.full_name !== CANONICAL || !pr.head?.sha) continue;
    const expectedIds = await expectedIdsFor(fetchImpl, pr);
    if (expectedIds) return { number: pr.number, headSha: pr.head.sha, expectedIds };
  }
  return { reason: `no open ${CANONICAL} PR currently modifies consolidated content docs` };
}

/** The moved-during-build recheck the spec runs after the preview settles. */
export async function currentHeadSha(fetchImpl: typeof fetch, number: number): Promise<string | null> {
  const pr = await ghJson<PrPayload>(fetchImpl, `/repos/${CANONICAL}/pulls/${number}`);
  return pr?.head?.sha ?? null;
}
