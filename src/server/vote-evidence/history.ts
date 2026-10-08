// The plan's K3 key (docs/plans/vote-matching.md §4), no model involved: find
// the atlas commit that first wrote a claim's words, read its pull request
// number from the squash-merge subject (its trailing "(#N)"), and take the poll
// whose body links that pull request. It needs the atlas checkout's full
// history, which the worker image clones.

import { execFileSync } from "node:child_process";

import { atlasPullRequests } from "../../../scripts/lib/votes/poll.ts";

/**
 * The search string: up to 28 characters before the date plus the date, cut
 * after the last markdown delimiter so it matches the source text, not the
 * link-stripped prose (where link markup is gone).
 */
export function pickaxeNeedle(c: { contextBefore: string; raw: string }): string {
  const tail = c.contextBefore.split(/[\][()*_`]/).pop() ?? "";
  return `${tail.slice(-28)}${c.raw}`.trim();
}

/** Polls whose body links next-gen-atlas pull request `pr`. */
export function pollsLinkingPr(pr: number, bodies: ReadonlyMap<string, string>): string[] {
  return [...bodies].filter(([, body]) => atlasPullRequests(body).includes(pr)).map(([file]) => file);
}

export function prOfSubject(subject: string): number | null {
  const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  return m ? Number(m[1]) : null;
}

/** Whether `dir` holds enough history for a pickaxe search to mean anything. */
export function hasHistory(dir: string, min = 50): boolean {
  try {
    return Number(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString()) >= min;
  } catch {
    return false;
  }
}

/** The pull request of the atlas commit that first wrote `needle`, or null when its subject names none. */
export function firstPr(needle: string, atlasDir: string): number | null {
  const out = execFileSync("git", ["-C", atlasDir, "log", "--no-renames", "-S", needle, "--reverse", "--format=%s", "--", "."], {
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  return prOfSubject(out.split("\n")[0] ?? "");
}

/** The poll that authorised pull request `pr`, or null. A pull request several polls link (a re-run) resolves to the earliest. */
export function pollForPr(pr: number | null, bodies: ReadonlyMap<string, string>): string | null {
  return pr === null ? null : (pollsLinkingPr(pr, bodies).sort()[0] ?? null);
}
