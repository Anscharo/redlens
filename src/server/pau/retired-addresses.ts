// Addresses an earlier atlas commit lists and the current one does not, read
// from the atlas checkout's git history. A key derived from one meters an
// integration the atlas has dropped (an offboarded vault), so its row is
// marked `retired` and readers can set it apart. Every file of every commit is read
// as text, whatever layout the atlas used then, and an address counts as
// retired only when no file at HEAD still holds it.
import { spawnSync } from "node:child_process";
import type { DerivedKey, PauSnapshot, RetiredAddress } from "../../lib/pau.ts";
import { EVM_ADDRESS_BODY_SRC, EVM_ADDRESS_SRC } from "../../lib/patterns.ts";
import { mapLimits } from "./snapshot.ts";

const ADDRESS_RE = new RegExp(EVM_ADDRESS_SRC, "g");
const COMMIT = "\u0001";
const LOG_FORMAT = `${COMMIT}%H %cI`;

const addressesIn = (text: string) => (text.match(ADDRESS_RE) ?? []).map((a) => a.toLowerCase());

/** +1 for a diff line that adds, -1 for one that removes, 0 for a file header or context. */
const lineSign = (line: string) => (line.startsWith("+") && !line.startsWith("+++") ? 1 : line.startsWith("-") && !line.startsWith("---") ? -1 : 0);

/** Counts a diff line's addresses into `count`, collecting those it removes in `touched`. */
function tally(line: string, count: Map<string, number>, touched: Set<string>) {
  const sign = lineSign(line);
  for (const a of sign ? addressesIn(line) : []) {
    count.set(a, (count.get(a) ?? 0) + sign);
    if (sign < 0) touched.add(a);
  }
}

/**
 * Each address a diff in `log` (oldest commit first, `LOG_FORMAT` headers,
 * no rename detection) adds and `head` does not hold, with the last commit
 * after which no file held it. Counting occurrences across files keeps a
 * file move from reading as a removal.
 */
export function retiredFromLog(log: string, head: string): Map<string, RetiredAddress> {
  const count = new Map<string, number>();
  const removed = new Map<string, RetiredAddress>();
  let commit = { sha: "", at: "" };
  let touched = new Set<string>();
  const flush = () => {
    for (const a of touched) if ((count.get(a) ?? 0) <= 0) removed.set(a, { address: a, removedAt: commit.at, commit: commit.sha });
    touched = new Set();
  };
  for (const line of log.split("\n")) {
    if (line.startsWith(COMMIT)) {
      flush();
      const [sha, at] = line.slice(1).split(" ");
      commit = { sha, at };
    }
    tally(line, count, touched);
  }
  flush();
  const now = new Set(addressesIn(head));
  return new Map([...removed].filter(([a]) => !now.has(a) && (count.get(a) ?? 0) <= 0));
}

const git = (dir: string, args: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.error || (r.status !== 0 && r.status !== 1)) throw new Error(`git ${args[0]} in ${dir}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
};

/** The retired addresses of the atlas checkout at `dir`, read from its whole history (about 4 seconds). */
export function atlasRetiredAddresses(dir: string): Map<string, RetiredAddress> {
  const log = git(dir, ["log", "--reverse", "--no-renames", "--no-color", "-U0", "-p", `-G${EVM_ADDRESS_BODY_SRC}`, `--format=${LOG_FORMAT}`, "HEAD"]);
  return retiredFromLog(log, git(dir, ["grep", "-I", "-h", "-E", EVM_ADDRESS_BODY_SRC, "HEAD"]));
}

const retiredArg = (d: DerivedKey, retired: Map<string, RetiredAddress>) =>
  d.args.map((a) => retired.get(a.toLowerCase())).find((r) => r !== undefined);

/** The snapshot with each row whose derivation takes a retired address marked with it, and every other row unmarked. */
export function withRetiredKeys(snap: PauSnapshot, retired: Map<string, RetiredAddress>): PauSnapshot {
  return mapLimits(snap, (x) => {
    const r = x.derived && retiredArg(x.derived, retired);
    if (r) return { ...x, retired: r };
    const { retired: _was, ...unmarked } = x;
    return unmarked as typeof x;
  });
}
