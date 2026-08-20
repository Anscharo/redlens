// Slash commands plus one pure predicate. Zero imports, so it behaves
// identically wherever it's consumed (SearchHints, the "?" binding, tests)
// without pulling in React or the DOM.
//
// The keyboard-shortcut registry that used to live here was dropped along
// with the feedback modal's shortcuts list — nothing rendered it.

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
