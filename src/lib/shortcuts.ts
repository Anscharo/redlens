// Central registry of keyboard shortcuts and slash commands. Pure data + one
// pure function — zero imports, so it renders identically wherever it's
// consumed (the help modal, tests) without pulling in React or the DOM.
//
// Adding a shortcut? Verify it against the source that implements it before
// listing it here — see the table in the PR/task description this file was
// built from. An entry that doesn't match reality is worse than no entry.

export interface Shortcut {
  keys: string[]; // e.g. ["⌘K"] or ["Ctrl", "K"] — render as <kbd> per element
  description: string;
  where: "global" | "search" | "reader" | "tree";
  primary: boolean; // shown in the compact modal list
}

export const SHORTCUTS: Shortcut[] = [
  {
    keys: ["⌘K"],
    description: "Open the chat agent",
    where: "global",
    primary: true,
  },
  {
    keys: ["Esc"],
    description: "Close the chat panel or any modal",
    where: "global",
    primary: true,
  },
  {
    keys: ["Enter"],
    description: "Jump to the first result",
    where: "search",
    primary: true,
  },
  {
    keys: ["↑", "↓"],
    description: "Move through recent searches",
    where: "search",
    primary: false,
  },
  {
    keys: ["↑", "↓", "←", "→"],
    description: "Move / expand / collapse in the tree",
    where: "tree",
    primary: true,
  },
  {
    keys: ["Shift"],
    description: "Shift-click a node to open it in the comparison pane",
    where: "reader",
    primary: true,
  },
  {
    keys: ["Alt"],
    description: "Alt-click reverses the chevron target in the reader",
    where: "reader",
    primary: false,
  },
  {
    keys: ["?"],
    description: "Open feedback & shortcuts",
    where: "global",
    primary: true,
  },
];

export const SLASH_COMMANDS: { cmd: string; description: string }[] = [
  { cmd: "/reports", description: "Open the reports index" },
  { cmd: "/radar", description: "Open the radar actor index" },
  { cmd: "/h", description: "Open the search syntax reference" },
];

/** True when `t` is an element that consumes typed keystrokes as text input —
 *  used to suppress single-key shortcuts (like `?`) while the user is typing.
 *  Defensive: `t` may be null or not an Element at all. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (t === null || typeof t !== "object") return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
