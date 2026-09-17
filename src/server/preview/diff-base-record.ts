// The durable record of what a preview was ACTUALLY redlined against: the
// `previews` row columns (migrations/033_preview_diff_base.sql) and the one
// positive log line a build emits. Pure over PreviewMeta, so the row, the log
// and the bundle's own meta.json can never disagree about the base.

import fs from "node:fs";
import path from "node:path";
import { CANONICAL_REPO, CANONICAL_MAIN_REF } from "./resolve.ts";
import type { PreviewMeta } from "./cache.ts";

/** `<owner>/<repo>:<branch>@<commit>` for the automatic pick: the merge base
 *  the added/changed list came from, or — for the live-main degrade — sky main
 *  at the served atlas commit. Null when the bundle recorded no bases at all
 *  (cold start: the diff artifacts were skipped). */
export function diffBaseLabel(meta: Pick<PreviewMeta, "bases" | "baseAtlasCommit">): string | null {
  const b = meta.bases;
  if (!b) return null;
  if (b.auto === "live-main") return `${CANONICAL_REPO}:${CANONICAL_MAIN_REF}@${meta.baseAtlasCommit ?? "unknown"}`;
  const c = b[b.auto];
  return c ? `${c.repo}:${c.ref}@${c.mergeBase}` : null;
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
  const parts: string[] = [];
  if (!b) parts.push("no diff base recorded");
  else if (b.auto === "live-main") parts.push(`redlined vs live-main @${short(meta.baseAtlasCommit)}`);
  else parts.push(`redlined vs ${b.auto} ${b[b.auto]?.ref}@${short(b[b.auto]?.mergeBase)}`);
  if (b?.reason) parts.push(`(${b.reason})`);
  if (meta.diffCounts) parts.push(`+${meta.diffCounts.added} added, ${meta.diffCounts.changed} changed`);
  if (b?.sky && b.auto !== "sky") parts.push(`sky fork point ${short(b.sky.mergeBase)}`);
  if (b?.sky?.behindBy !== undefined) parts.push(`${b.sky.behindBy} behind sky main`);
  if (b?.repo && b.auto !== "repo") parts.push(`repo candidate ${b.repo.ref}@${short(b.repo.mergeBase)}`);
  parts.push(`served atlas ${short(meta.baseAtlasCommit)}`);
  return `[preview] ${meta.sha.slice(0, 8)}: ${parts.join(" · ")}`;
}
