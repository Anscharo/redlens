// Per-row half of the diff-base backfill: recover the Resolved a pinned-sha
// rebuild would build, then the doc-list size of the base it would pick.
// The boot loop that walks the table lives in diff-base-backfill.ts.

import { sql } from "../db.ts";
import { CANONICAL_REPO, isPullRef, prBaseOf, type GhClient, type Resolved } from "./resolve.ts";
import type { Candidate, Candidates } from "./pr-diff.ts";
import { diffSnapshots, type Snapshot } from "./snapshot.ts";
import { diffBaseCandidates, diffBaseHasLca, diffBaseLabel, diffBaseType } from "./diff-base-record.ts";
import type { PreviewBases, PreviewMeta } from "./cache.ts";

type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export interface BackfillRow {
  sha: string;
  repo: string;
  ref: string;
  kind: string;
  pr_number: number | null;
  private: boolean;
  pr_base_repo: string | null;
  pr_base_ref: string | null;
  default_branch: string | null;
}

export interface DiscoveredBase {
  prBase?: { repo: string; ref: string };
  defaultBranch?: string;
}

interface LiveAtlas {
  commit: string;
  snapshot: Snapshot;
}

function pullsTarget(row: BackfillRow): { repo: string; n: number } | null {
  // Canonical `pull-N` previews are kind "pr"; the PR lives on nga, while
  // `row.repo` is the HEAD fork. Fork/private `owner:repo:pull-N` stays kind
  // "branch" and the PR lives on row.repo.
  if (row.kind === "pr" && row.pr_number) return { repo: CANONICAL_REPO, n: row.pr_number };
  const m = isPullRef(row.ref) ? /^pull-(\d+)$/.exec(row.ref) : null;
  return m ? { repo: row.repo, n: Number(m[1]) } : null;
}

function strip(c: Candidate): NonNullable<PreviewBases["sky"]> {
  const { key: _key, ...meta } = c;
  return meta;
}

/** The Resolved a pinned-sha rebuild would build, recovering a PR base or
 *  default branch the row never stored. "skip" = the repo can't be read. */
export async function resolveBackfillRow(
  row: BackfillRow,
  gh: GhClient,
): Promise<{ resolved: Resolved; discovered: DiscoveredBase } | "skip"> {
  let prBase = row.pr_base_repo && row.pr_base_ref ? { repo: row.pr_base_repo, ref: row.pr_base_ref } : undefined;
  const learnedPr = !prBase;
  const pulls = pullsTarget(row);
  if (!prBase && pulls) {
    const pr = await gh.fetchJson(`/repos/${pulls.repo}/pulls/${pulls.n}`);
    if (pr.ok) prBase = prBaseOf(pr.json, pulls.repo);
  }
  let defaultBranch = row.default_branch ?? undefined;
  let learnedDef = false;
  // A PR with a declared base is redlined against that, never the default
  // branch. The stand-in is only for a branch preview, or a PR whose base
  // could not be read.
  if (!prBase && !defaultBranch && row.repo !== CANONICAL_REPO) {
    const info = await gh.fetchJson(`/repos/${row.repo}`);
    if (!info.ok) return "skip";
    const def = info.json?.default_branch;
    if (typeof def === "string" && def) {
      defaultBranch = def;
      learnedDef = true;
    }
  }
  const resolved: Resolved = {
    repo: row.repo,
    sha: row.sha,
    kind: row.kind === "pr" ? "pr" : "branch",
    ref: row.ref,
    private: row.private,
    ...(prBase ? { prBase } : {}),
    ...(!prBase && defaultBranch ? { defaultBranch } : {}),
  };
  return {
    resolved,
    discovered: {
      ...(learnedPr && prBase ? { prBase: { repo: prBase.repo, ref: prBase.ref } } : {}),
      ...(learnedDef && defaultBranch ? { defaultBranch } : {}),
    },
  };
}

/** Doc-list size of the automatic pick, dropping a candidate whose tree will
 *  not load — the same degrade writeCandidateDiffs applies during a build.
 *  pickAuto's "live-main" carries no candidates, so that path counts against
 *  the served atlas and advertises nothing else. */
export async function materializeDiffBase(
  resolved: Resolved,
  candidates: Candidates,
  live: LiveAtlas,
  snapshotAt: (repo: string, sha: string) => Promise<Snapshot>,
): Promise<{ bases: PreviewBases; counts: { added: number; changed: number } } | "skip"> {
  let head: Snapshot;
  try {
    head = await snapshotAt(resolved.repo, resolved.sha);
  } catch {
    return "skip";
  }
  if (candidates.auto === "live-main") {
    const d = diffSnapshots(live.snapshot, head);
    const bases: PreviewBases = { auto: "live-main" };
    if (candidates.reason) bases.reason = candidates.reason;
    return { bases, counts: { added: d.added.length, changed: d.changed.length } };
  }
  const loaded = new Map<"sky" | "repo", Snapshot>();
  for (const key of ["sky", "repo"] as const) {
    const c = candidates[key];
    if (!c) continue;
    try {
      loaded.set(key, c.mergeBase === live.commit ? live.snapshot : await snapshotAt(resolved.repo, c.mergeBase));
    } catch {
      /* tree gone — drop the candidate rather than redline it against live main under its own name */
    }
  }
  let auto: PreviewBases["auto"] = candidates.auto;
  let reason = candidates.reason;
  if (!loaded.has(auto)) {
    // The picked tree is gone. Say so without the fetch error: that message
    // names `repo@sha`, and a private repo must not land in the row or the log.
    reason = "base unavailable";
    auto = (["sky", "repo"] as const).find((k) => loaded.has(k)) ?? "live-main";
  }
  const base = auto === "live-main" ? live.snapshot : loaded.get(auto)!;
  const d = diffSnapshots(base, head);
  const bases: PreviewBases = { auto };
  if (reason) bases.reason = reason;
  if (auto !== "live-main") {
    if (loaded.has("sky") && candidates.sky) bases.sky = strip(candidates.sky);
    if (loaded.has("repo") && candidates.repo) bases.repo = strip(candidates.repo);
  }
  return { bases, counts: { added: d.added.length, changed: d.changed.length } };
}

export async function listPreviewsWithoutDiffBase(q: Query = sql as unknown as Query): Promise<BackfillRow[]> {
  return (await q`
    SELECT sha, repo, ref, kind, pr_number, private, pr_base_repo, pr_base_ref, default_branch
    FROM previews
    WHERE diff_base_type IS NULL AND blocked_at IS NULL
    ORDER BY last_access DESC
  `) as BackfillRow[];
}

/** Write the record only while the columns are still NULL, so a rebuild that
 *  landed mid-backfill is not overwritten with a second opinion. created_at
 *  and last_access stay put — this is not a visit and not a new build. */
export async function fillPreviewDiffBase(
  q: Query,
  sha: string,
  meta: PreviewMeta,
  discovered: DiscoveredBase,
): Promise<boolean> {
  const rows = (await q`
    UPDATE previews SET
      pr_base_repo = COALESCE(pr_base_repo, ${discovered.prBase?.repo ?? null}),
      pr_base_ref = COALESCE(pr_base_ref, ${discovered.prBase?.ref ?? null}),
      default_branch = COALESCE(default_branch, ${discovered.defaultBranch ?? null}),
      diff_base_type = ${diffBaseType(meta)},
      diff_base_lca = ${diffBaseHasLca(meta)},
      diff_base = ${diffBaseLabel(meta)},
      diff_bases = ${diffBaseCandidates(meta)}::jsonb,
      base_atlas_commit = ${meta.baseAtlasCommit ?? null},
      diff_added = ${meta.diffCounts?.added ?? null},
      diff_changed = ${meta.diffCounts?.changed ?? null}
    WHERE sha = ${sha} AND diff_base_type IS NULL
    RETURNING sha
  `) as { sha: string }[];
  return rows.length > 0;
}
