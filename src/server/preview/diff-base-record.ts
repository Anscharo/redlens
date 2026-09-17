// The durable record of what a preview was ACTUALLY redlined against: the
// `previews` row columns (migrations/033_preview_diff_base.sql) and the one
// positive log line a build emits. Pure over PreviewMeta, so the row, the log
// and the bundle's own meta.json can never disagree about the base.
//
// The record speaks ONE vocabulary, and it is not the bundle's internal one.
// Internally a bundle has two candidate slots keyed `sky` / `repo` plus a
// `live-main` degrade (cache.ts PreviewBases — also the `?base=` URL param and
// the diff.<key>.json filenames). Those keys blur two questions, so the record
// answers them separately:
//
//   TYPE — which branch is the base?
//     pr-base       the PR's own declared base branch
//     fork-default  the repo's default branch (a branch preview, or a PR whose
//                   base could not be read and the default branch stands in)
//     nga-main      sky-ecosystem/next-gen-atlas:main
//   LCA — was a last common ancestor with that branch found?
//     true   the doc list is computed against that ancestor commit
//     false  none was found: compared against the branch TIP as served today
//            (the degrade — everything upstream changed since shows up too).
//            Only ever false for nga-main.

import fs from "node:fs";
import path from "node:path";
import { CANONICAL_REPO, CANONICAL_MAIN_REF } from "./resolve.ts";
import type { BaseCandidateMeta, BaseDrift, PreviewMeta } from "./cache.ts";

export type DiffBaseType = "pr-base" | "fork-default" | "nga-main";

type RecordMeta = Pick<PreviewMeta, "bases" | "baseAtlasCommit" | "prBase">;

/** The internal `repo` slot is one of two things, never both. */
function repoSlotType(meta: RecordMeta): DiffBaseType {
  return meta.prBase ? "pr-base" : "fork-default";
}

/** Which branch the automatic pick is. Null when the bundle recorded no bases
 *  at all (cold start: the diff artifacts were skipped). */
export function diffBaseType(meta: RecordMeta): DiffBaseType | null {
  if (!meta.bases) return null;
  return meta.bases.auto === "repo" ? repoSlotType(meta) : "nga-main";
}

/** Was the doc list computed against a last common ancestor (true), or against
 *  the branch tip because none was found (false)? Null with no bases. */
export function diffBaseHasLca(meta: RecordMeta): boolean | null {
  if (!meta.bases) return null;
  return meta.bases.auto !== "live-main";
}

/** `<owner>/<repo>:<branch>@<commit>` for the automatic pick: the last common
 *  ancestor the added/changed list came from, or — with no LCA — nga main at
 *  the served atlas commit. */
export function diffBaseLabel(meta: RecordMeta): string | null {
  const b = meta.bases;
  if (!b) return null;
  if (b.auto === "live-main") return `${CANONICAL_REPO}:${CANONICAL_MAIN_REF}@${meta.baseAtlasCommit ?? "unknown"}`;
  const c = b[b.auto];
  return c ? `${c.repo}:${c.ref}@${c.mergeBase}` : null;
}

export interface DiffBaseCandidates {
  /** Why the pick is what it is when that isn't obvious (a degrade cause, or
   *  "candidates diverged"). */
  reason?: string;
  /** Every candidate that resolved, keyed by TYPE — each with its last common
   *  ancestor (`mergeBase`), ahead/behind, and the base branch's drift. */
  candidates: Partial<Record<DiffBaseType, BaseCandidateMeta & { drift?: BaseDrift }>>;
}

/** The `diff_bases` jsonb: the candidates re-keyed into the record's own
 *  vocabulary, so a query never has to know the internal slot names. */
export function diffBaseCandidates(meta: RecordMeta): DiffBaseCandidates | null {
  const b = meta.bases;
  if (!b) return null;
  const out: DiffBaseCandidates = { candidates: {} };
  if (b.reason) out.reason = b.reason;
  if (b.sky) out.candidates["nga-main"] = b.sky;
  if (b.repo) out.candidates[repoSlotType(meta)] = b.repo;
  return out;
}

/** Size of the automatic pair's doc list, read back off the diff.json the
 *  build just wrote. Undefined when there is none (artifacts skipped). */
export function readDiffCounts(outDir: string): { added: number; changed: number } | undefined {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(outDir, "diff.json"), "utf8"));
    return { added: Array.isArray(d.added) ? d.added.length : 0, changed: Array.isArray(d.changed) ? d.changed.length : 0 };
  } catch {
    return undefined;
  }
}

const short = (sha: string | undefined): string => (sha ? sha.slice(0, 8) : "?");

/** One line per successful build. Keyed by sha8 like every other `[preview]`
 *  line and free of the repo name (the row has it) — a private repo's name
 *  stays out of the log stream. */
export function diffBaseLogLine(meta: PreviewMeta): string {
  const b = meta.bases;
  const type = diffBaseType(meta);
  const parts: string[] = [];
  if (!b || !type) parts.push("no diff base recorded");
  else if (b.auto === "live-main") parts.push(`redlined vs nga-main TIP @${short(meta.baseAtlasCommit)} · NO LCA`);
  else parts.push(`redlined vs ${type} ${b[b.auto]?.ref}@${short(b[b.auto]?.mergeBase)} (LCA)`);
  if (b?.reason) parts.push(`(${b.reason})`);
  if (meta.diffCounts) parts.push(`+${meta.diffCounts.added} added, ${meta.diffCounts.changed} changed`);
  if (b?.sky && b.auto !== "sky") parts.push(`nga-main LCA ${short(b.sky.mergeBase)}`);
  if (b?.sky?.behindBy !== undefined) parts.push(`${b.sky.behindBy} behind nga-main`);
  if (b?.repo && b.auto !== "repo") parts.push(`${repoSlotType(meta)} candidate ${b.repo.ref}@${short(b.repo.mergeBase)}`);
  parts.push(`served atlas ${short(meta.baseAtlasCommit)}`);
  return `[preview] ${meta.sha.slice(0, 8)}: ${parts.join(" · ")}`;
}
