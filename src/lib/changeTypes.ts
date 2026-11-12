// The history change types: one declaration every table derives from (the
// history engine's events, the reader's labels and colours, the radar's marks
// and row ranking, the chat tools' enums). Imports nothing, so the build
// scripts and the db-mocking server tests can load it freely. The stored
// Postgres names that differ from these live in src/server/history/change-type.ts.

/** Event order within one commit: a title change reads before its body's. */
export const CHANGE_TYPES = ["added", "retitled", "modified", "removed", "moved", "renumbered", "retyped"] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

interface ChangeTypeInfo {
  /** The history entry's label. */
  label: string;
  /** CSS colour of the label and the timeline dot. */
  color: string;
  /** The radar actor history's mark; the preview filters use the same ones. */
  mark: string;
  /** Which of a doc's same-commit events names its radar row: the highest. */
  rank: number;
}

// added/removed reuse the diff-view tokens so the label matches the diff body.
// moved is blue from the decorative depth cycle: not --accent (links) nor
// --warn/--error-text (which carry their own meaning). A retitling, renumbering
// or type change is lilac, the colour of the preview's renumber note. An edit
// outranks every structural change on a radar row: its significance says more.
export const CHANGE_TYPE_INFO: Record<ChangeType, ChangeTypeInfo> = {
  added: { label: "added", color: "var(--diff-added-fg)", mark: "+", rank: 4 },
  retitled: { label: "retitled", color: "var(--lilac)", mark: "T", rank: 3 },
  modified: { label: "edited", color: "var(--tan-3)", mark: "~", rank: 4 },
  removed: { label: "removed", color: "var(--diff-removed-fg)", mark: "−", rank: 4 },
  moved: { label: "moved", color: "var(--depth-4)", mark: "→", rank: 0 },
  renumbered: { label: "renumbered", color: "var(--lilac)", mark: "↻", rank: 1 },
  retyped: { label: "type changed", color: "var(--lilac)", mark: "[]", rank: 2 },
};

const derive = <T>(pick: (i: ChangeTypeInfo) => T) =>
  Object.fromEntries(CHANGE_TYPES.map((t) => [t, pick(CHANGE_TYPE_INFO[t])])) as Record<ChangeType, T>;

export const CHANGE_LABEL = derive((i) => i.label);
export const CHANGE_COLOR = derive((i) => i.color);
export const CHANGE_MARK = derive((i) => i.mark);
export const CHANGE_RANK = derive((i) => i.rank);
