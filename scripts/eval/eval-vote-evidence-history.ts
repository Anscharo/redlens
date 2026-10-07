// The history arm of the vote-evidence eval's poll task — the plan's K3 key
// (docs/plans/vote-matching.md §4), no model involved: find the atlas commit
// that first wrote the claim's words, read its pull request number from the
// squash-merge subject (its trailing "(#N)"), and return the poll whose body links
// that pull request. It needs the atlas submodule's full history.

import { execFileSync } from "node:child_process";

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
  const re = new RegExp(`next-gen-atlas/pull/${pr}(?!\\d)`);
  return [...bodies].filter(([, body]) => re.test(body)).map(([file]) => file);
}

export function prOfSubject(subject: string): number | null {
  const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  return m ? Number(m[1]) : null;
}

/** Whether `dir` holds enough history for a pickaxe search to mean anything. */
export function hasHistory(dir: string, min = 50): boolean {
  try {
    return Number(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"]).toString()) >= min;
  } catch {
    return false;
  }
}

/** The poll that authorised the commit first writing `needle`, or "none". */
export function historyPoll(needle: string, atlasDir: string, bodies: ReadonlyMap<string, string>): string {
  const out = execFileSync("git", ["-C", atlasDir, "log", "--no-renames", "-S", needle, "--reverse", "--format=%s", "--", "."], {
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  const pr = prOfSubject(out.split("\n")[0] ?? "");
  if (pr === null) return "none";
  // A pull request linked by several polls (a re-run) resolves to the earliest.
  return pollsLinkingPr(pr, bodies).sort()[0] ?? "none";
}
