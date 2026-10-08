// The plan's K3 key (docs/plans/vote-matching.md §4), no model involved: find
// the atlas commit that first wrote a claim's words, read its pull request
// number from the squash-merge subject (its trailing "(#N)"), and take the poll
// whose body links that pull request. It needs the atlas checkout's full
// history, which the worker image clones.
//
// git runs as an argv array (execFile, no shell), so atlas text in a needle is
// never interpreted, and asynchronously under a timeout, so a slow search can
// neither block the process nor outlive the lane's deadline.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

const run = promisify(execFile);
/** One git search's limit; the lane's whole run has six minutes. */
const GIT_TIMEOUT_MS = 30_000;

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", dir, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * The checkout's HEAD when it holds the full history a pickaxe search needs,
 * else null. A shallow clone fails however deep it is: its boundary commit
 * reads as the first writer of every sentence older than the boundary.
 */
export async function historyHead(dir: string, min = 50): Promise<string | null> {
  try {
    if ((await git(dir, ["rev-parse", "--is-shallow-repository"])) !== "false") return null;
    if (Number(await git(dir, ["rev-list", "--count", "HEAD"])) < min) return null;
    return await git(dir, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/** The pull request of the atlas commit that first wrote `needle`, or null when its subject names none. */
export async function firstPr(needle: string, atlasDir: string): Promise<number | null> {
  // One argument, `-S<needle>`, so a needle starting with "-" stays the search string.
  const out = await git(atlasDir, ["log", "--no-renames", `-S${needle}`, "--reverse", "--format=%s", "--", "."]);
  return prOfSubject(out.split("\n")[0] ?? "");
}

/** The poll that authorised pull request `pr`, or null. A pull request several polls link (a re-run) resolves to the earliest. */
export function pollForPr(pr: number | null, bodies: ReadonlyMap<string, string>): string | null {
  return pr === null ? null : (pollsLinkingPr(pr, bodies).sort()[0] ?? null);
}
