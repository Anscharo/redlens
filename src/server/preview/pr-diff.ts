// Accurate preview diff from GitHub. Both kinds use a MERGE-BASE comparison, so
// the result is the REAL set of docs a preview adds/changes — no "vs current
// main" false positives (pull-256: 53 files here, vs ~390 changed for the
// content-hash diff):
//   PR              → /pulls/{n}/files     (GitHub diffs head vs the PR's own base)
//   branch/sha/fork → /compare/main...{sha} (three-dot = merge-base; fork commits
//                      are reachable through the canonical repo's network — verified)
// Both endpoints return the same {filename, status, patch} shape, so one mapper
// handles both. The per-file unified `patch` is parsed into the live history
// DiffLine[] shape (see patch-diff.ts) so preview history renders real diffs.
// Computed during the on-the-fly build, written into the bundle (diff.json +
// patches.json). Branch base is hardcoded `main`; a PR targeting a non-main base
// is still correct because PR-files diffs against the PR's declared base.
//
// Compare quirk (verified 2026-06-12): the compare endpoint caps `files` at 300
// and does NOT paginate them (page 2 → [], per_page ignored) — pagination applies
// to commits only. When the cap hits, we recover the accurate changed-set by
// unioning files across the branch's ahead-of-merge-base commits (the commit
// endpoint paginates files properly). Patches stay best-effort from the 300.

import type { DiffLine } from "../../lib/history";
import { makeGhClient, CANONICAL_REPO, type Resolved, type GhClient } from "./resolve.ts";
import { patchToDiffLines } from "./patch-diff.ts";

const COMPARE_BASE = "main";
const MAX_PAGES = 50; // PR files: 5000; atlas previews never approach this
const COMPARE_FILE_CAP = 300; // GitHub hard cap on compare .files
const MAX_UNION_COMMITS = 100; // bound the per-commit recovery fan-out

/** Compare failed outright (404 = no common ancestor / unknown sha). For forks
 *  this is fatal — shared history with main is a screening requirement. */
export class CompareError extends Error {
  status: number;
  constructor(status: number) {
    super(`compare failed (${status})`);
    this.status = status;
  }
}

export interface ChangedFile {
  filename: string;
  status: string;
  patch?: string;
}

export interface PreviewFiles {
  files: ChangedFile[];
  /** From the compare response; absent on the PR path. */
  aheadBy?: number;
  behindBy?: number;
  /** True when the 300-file compare cap hit AND per-commit recovery was also bounded. */
  truncated?: boolean;
}

export interface PreviewDiff {
  added: string[];
  changed: string[];
}

export interface PreviewDiffFull extends PreviewDiff {
  /** doc id → rendered line diff (added/changed docs that carried a patch) */
  patches: Record<string, DiffLine[]>;
  /** mapped docs whose file had no patch (binary / GitHub-truncated / pure rename) */
  noPatch: number;
}

// content/A/2/2/4/document.md → "A.2.2.4"; content/NR/1/document.md → "NR-1".
// Non-document.md files (e.g. _index.md) → null (not atlas docs).
export function pathToDocNo(filename: string): string | null {
  if (!filename.startsWith("content/") || !filename.endsWith("/document.md")) return null;
  const inner = filename.slice("content/".length, -"/document.md".length);
  if (!inner) return null;
  const parts = inner.split("/");
  if (parts[0] === "NR") return parts.length === 2 ? `NR-${parts[1]}` : null;
  return parts.join(".");
}

// Paginate the PR files endpoint (files paginate properly there).
async function fetchPrFiles(gh: GhClient, prNumber: number): Promise<ChangedFile[]> {
  const out: ChangedFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) break;
    for (const f of r.json) out.push({ filename: f.filename, status: f.status, patch: f.patch });
    if (r.json.length < 100) break;
  }
  return out;
}

// Union files across individual commits — recovery path for compare's 300-file
// cap. The commit endpoint paginates its files (Link header / page param).
// Later commits override status for a file; patches are NOT taken from here
// (per-commit patches aren't vs the merge base).
async function unionCommitFiles(gh: GhClient, commitShas: string[]): Promise<Map<string, ChangedFile>> {
  const byName = new Map<string, ChangedFile>();
  for (const sha of commitShas) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/commits/${sha}?per_page=100&page=${page}`);
      const files: any[] = r.ok ? r.json?.files : null;
      if (!Array.isArray(files) || files.length === 0) break;
      for (const f of files) byName.set(f.filename, { filename: f.filename, status: f.status });
      if (files.length < 100) break;
    }
  }
  return byName;
}

// Compare path: merge-base diff vs main, with cap recovery.
async function fetchCompareFiles(gh: GhClient, sha: string): Promise<PreviewFiles> {
  const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/compare/${COMPARE_BASE}...${sha}`);
  if (!r.ok) throw new CompareError(r.status);
  const files: ChangedFile[] = (Array.isArray(r.json?.files) ? r.json.files : []).map((f: any) => ({
    filename: f.filename,
    status: f.status,
    patch: f.patch,
  }));
  const aheadBy: number = r.json?.ahead_by ?? 0;
  const behindBy: number = r.json?.behind_by ?? 0;
  if (files.length < COMPARE_FILE_CAP) return { files, aheadBy, behindBy };

  // Cap hit — the file list may be truncated. Recover ids by unioning the
  // ahead-of-merge-base commits' files; keep the compare patches we do have.
  const commitShas: string[] = (Array.isArray(r.json?.commits) ? r.json.commits : []).map((c: any) => c.sha);
  const bounded = commitShas.slice(0, MAX_UNION_COMMITS);
  const truncated = aheadBy > bounded.length; // commits page caps at 250; we bound further
  const union = await unionCommitFiles(gh, bounded);
  for (const f of files) {
    const u = union.get(f.filename);
    if (u) u.patch = f.patch; // graft merge-base patches onto union entries
    else union.set(f.filename, f);
  }
  if (truncated) console.warn(`[preview] compare cap recovery bounded at ${bounded.length}/${aheadBy} commits for ${sha.slice(0, 8)}`);
  return { files: [...union.values()], aheadBy, behindBy, truncated };
}

// PR → merge-base via the PR's own base; branch/sha/fork → merge-base vs main.
export async function fetchPreviewFiles(resolved: Resolved, token: string): Promise<PreviewFiles> {
  const gh = makeGhClient(token);
  if (resolved.pr) return { files: await fetchPrFiles(gh, resolved.pr.number) };
  return fetchCompareFiles(gh, resolved.sha);
}

// Map changed files → doc ids + rendered patches via the preview's doc_no → id
// index. `removed` files are skipped (the doc isn't in the preview to flag).
// added-vs-changed is decided by DOC IDENTITY when `mainIds` is provided: a
// "modified" file can carry a brand-new document (new uuid in an existing
// path) → that's an ADDED doc, and an "added" file can carry an existing uuid
// (doc moved to a new number) → that's a CHANGED doc. File status is only the
// fallback when the caller has no main-atlas id set.
export function mapChangedDocs(
  files: ChangedFile[],
  docNoToId: Map<string, string>,
  mainIds?: Set<string>,
): PreviewDiffFull {
  const added = new Set<string>();
  const changed = new Set<string>();
  const patches: Record<string, DiffLine[]> = {};
  let noPatch = 0;
  for (const f of files) {
    const docNo = pathToDocNo(f.filename);
    if (!docNo) continue;
    const id = docNoToId.get(docNo);
    if (!id) continue;
    if (f.status === "removed") continue;
    const isNew = mainIds ? !mainIds.has(id) : f.status === "added";
    (isNew ? added : changed).add(id);
    const lines = patchToDiffLines(f.patch);
    if (lines.length) patches[id] = lines;
    else noPatch++;
  }
  return { added: [...added], changed: [...changed], patches, noPatch };
}
