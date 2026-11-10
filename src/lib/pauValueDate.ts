// When the atlas wrote a stated value, read from its document's history: the
// date the chain is measured against when the two disagree (pauPending.ts,
// the PAU values audit). Pure.
import type { DiffLine, HistoryEntry } from "./history.ts";
import { lastContentChange } from "./pauAudit.ts";

const CONTENT = new Set(["added", "modified"]);
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The stated text as a whole value: not a digit run's middle ("0" is not in "20,000"). */
const valuePattern = (stated: string) => new RegExp(`(?<![\\w.,])${escapeRegExp(norm(stated))}(?![\\w]|[.,]\\d)`);

/** One side of a diff: the lines an edit added ("+") or removed ("-"), a word-level line rebuilt for that side. */
function sideLines(diff: DiffLine[], keep: "+" | "-"): string[] {
  return diff.flatMap((l) => {
    if (l[0] === "~") return [l[1].filter(([k]) => k === "=" || k === keep).map(([, t]) => t).join("")];
    return l[0] === keep ? [l[1]] : [];
  });
}

/** Whether an edit wrote the stated text: a line it added holds it and no line it removed did. */
function writes(diff: DiffLine[], stated: string): boolean {
  const re = valuePattern(stated);
  const has = (lines: string[]) => lines.some((t) => re.test(norm(t)));
  return has(sideLines(diff, "+")) && !has(sideLines(diff, "-"));
}

/**
 * When the document last wrote the stated value, YYYY-MM-DD: its newest content
 * change whose diff adds the value, or that carries no diff to tell by. An edit
 * whose diff leaves the value alone is passed over. Where no diff is found to
 * write it (the atlas writes it differently from the parsed value), the
 * document's last content change stands in; null when it has none.
 */
export function valueChangedAt(entries: readonly HistoryEntry[], stated: string): string | null {
  const content = entries.filter((e) => CONTENT.has(e.changeType) && e.changeKind !== "lint" && e.changeKind !== "typo" && e.date);
  const newest = [...content].sort((a, b) => b.date.localeCompare(a.date));
  return newest.find((e) => !e.diff?.length || writes(e.diff, stated))?.date.slice(0, 10) ?? lastContentChange(entries);
}
