// When the atlas wrote a stated value, read from its document's history: the
// date the chain is measured against when the two disagree (pauPending.ts,
// the PAU values audit). Pure.
import type { DiffLine, HistoryEntry } from "./history.ts";
import type { SetAt } from "./pau.ts";

const CONTENT = new Set(["added", "modified"]);
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** The change that wrote a value, and whether it is certainly that change. */
export interface ValueChange {
  entry: HistoryEntry;
  /** Its diff adds the value, or it added the document; false for a stand-in edit that cannot be told to have written it. */
  exact: boolean;
}

const wrote = (e: HistoryEntry, stated: string) => (e.diff?.length ? writes(e.diff, stated) : e.changeType === "added");

/**
 * The change that last wrote the stated value: the document's newest content
 * change whose diff adds the value, or that added the document. Where none can
 * be shown to (no diff, or the atlas writes it differently from the parsed
 * value), the newest content change stands in, not exact: the value was written
 * on or before it, so a chain change on or after it is after the write too.
 * Null when the document has no content change.
 */
export function valueChange(entries: readonly HistoryEntry[], stated: string): ValueChange | null {
  const content = entries.filter((e) => CONTENT.has(e.changeType) && e.changeKind !== "lint" && e.changeKind !== "typo" && e.date);
  const newest = [...content].sort((a, b) => b.date.localeCompare(a.date));
  const exact = newest.find((e) => wrote(e, stated));
  if (exact) return { entry: exact, exact: true };
  return newest[0] ? { entry: newest[0], exact: false } : null;
}

/** When the document last wrote the stated value, YYYY-MM-DD (`valueChange`); null when it has no content change. */
export const valueChangedAt = (entries: readonly HistoryEntry[], stated: string): string | null => valueChange(entries, stated)?.entry.date.slice(0, 10) ?? null;

/**
 * Which side moved last, by full timestamp: "chain" when the chain set the key
 * after the atlas wrote the value, "atlas" when the atlas wrote it after; null
 * when either time is unknown or they are the same instant.
 */
export function moveOrder(chainAt: string | null | undefined, atlasAt: string | null | undefined): "chain" | "atlas" | null {
  const chain = chainAt ? Date.parse(chainAt) : NaN;
  const atlas = atlasAt ? Date.parse(atlasAt) : NaN;
  if (Number.isNaN(chain) || Number.isNaN(atlas) || chain === atlas) return null;
  return chain > atlas ? "chain" : "atlas";
}

/**
 * `moveOrder` from a key's last set. A key set before the window its history
 * was read over (`SetAt.before`) moved before any atlas change: the window
 * covers every change a step can still wait on, so an older one is past
 * pending either way.
 */
export function setOrder(set: Pick<SetAt, "time" | "before"> | null | undefined, atlasAt: string | null | undefined): "chain" | "atlas" | null {
  if (set?.before) return atlasAt && !Number.isNaN(Date.parse(atlasAt)) ? "atlas" : null;
  return moveOrder(set?.time, atlasAt);
}
