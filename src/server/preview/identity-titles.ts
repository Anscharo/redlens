// What a change of title says by itself: the same title respelled, one title
// inside the other, or a substitution of some words for others. Pure.

import { lcsOps } from "../../lib/diffCore";
import { words } from "./identity-text.ts";

// A substitution that leaves less than this much of the longer title standing
// is a different title, not an edit, and yields no campaign key — so a family
// of documents genuinely replaced en masse cannot excuse one another.
export const CAMPAIGN_MIN_TITLE_KEPT = 0.5;

/** Title reduced to its letters and digits. Collapsing whitespace RUNS is not
 *  enough — that reads "Whitelisting Of ALMProxy" and "Whitelisting Of ALM
 *  Proxy" as two different titles, when they are the same title respelled.
 *  Squashing the separators entirely is what makes a spelling/punctuation
 *  normalisation (`ALMProxy` → `ALM Proxy`, `Lite-PSM` → `Lite PSM`) read as
 *  the cosmetic rename it is. A separator BETWEEN TWO DIGITS is kept, as one
 *  dot: "Version 1.0" and "Version 10" are different titles, not respellings. */
function squashTitle(t: string | undefined): string {
  const digit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
  return (t ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, (sep, at: number, all: string) => (digit(all[at - 1]) && digit(all[at + sep.length]) ? "." : ""));
}

/** The same document under a respelled name — not a retitle at all. */
export function sameTitle(a: string | undefined, b: string | undefined): boolean {
  return squashTitle(a) === squashTitle(b);
}

/** Are these titles a specialization/rename of each other (one contains the
 *  other) rather than two unrelated documents? e.g. "Operational Executor Agent"
 *  → "Operational Executor Agent Ozone". Compared on the squashed form so a
 *  respelling inside the shared part ("ALMProxy Whitelisting" → "ALM Proxy
 *  Whitelisting Of Keel") does not break the containment. Both must be non-empty. */
export function titlesRelated(a: string | undefined, b: string | undefined): boolean {
  const na = squashTitle(a);
  const nb = squashTitle(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

/** Each run of removals and additions between two kept words, collapsed into
 *  one [removed, added] pair. Either side of a pair may be empty. */
function changeRuns(ops: [string, string][]): [string[], string[]][] {
  const out: [string[], string[]][] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length || added.length) out.push([removed, added]);
    removed = [];
    added = [];
  };
  for (const [op, w] of ops) {
    if (op === "=") flush();
    else if (op === "-") removed.push(w);
    else added.push(w);
  }
  flush();
  return out;
}

/** A canonical key for the edit that turned `oldT` into `newT`, or null when
 *  they are too different to call it an edit at all. Built from a word-level
 *  LCS, so "Whitelisting Of ALMProxy" → "Whitelisting Of ALM Proxy" and
 *  "Reporting Of ALMProxy" → "Reporting Of ALM Proxy" produce the SAME key:
 *  that is what lets two documents recognise each other as parts of one rename.
 *  Returns null when less than CAMPAIGN_MIN_TITLE_KEPT of the longer title
 *  survives. */
export function titleSubstitution(oldT: string | undefined, newT: string | undefined): string | null {
  const a = words(oldT);
  const b = words(newT);
  if (!a.length || !b.length) return null;
  const ops = lcsOps(a, b);
  const kept = ops.filter(([op]) => op === "=").length;
  if (kept / Math.max(a.length, b.length) < CAMPAIGN_MIN_TITLE_KEPT) return null;
  // One removed→added pair per run, in order, so the key describes the
  // substitution and not its position.
  const parts = changeRuns(ops).map(([removed, added]) => `-${removed.join(" ")}+${added.join(" ")}`);
  return parts.length ? parts.join("|") : null;
}

/** Each run of words the retitle removed, with the run that replaced it. A
 *  run that was only removed, or only added, is not a substitution. */
export function titleSubstitutions(oldT: string | undefined, newT: string | undefined): [string[], string[]][] {
  // Longest first, so "Launch Agent 4" is replaced before any shorter run could
  // claim one of its words.
  return changeRuns(lcsOps(words(oldT), words(newT)))
    .filter(([removed, added]) => removed.length && added.length)
    .sort((x, y) => y[0].length - x[0].length);
}
