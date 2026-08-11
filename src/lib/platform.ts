// Modifier-key names differ by platform, and a hint that names the wrong key is
// worse than no hint. Resolved once at module load: the platform cannot change
// mid-session, and every consumer is render-path code that would otherwise redo
// this on every hover.
//
// userAgentData.platform is the modern signal; navigator.platform is deprecated
// but still the only one Safari and Firefox provide. Both are absent under
// non-DOM test runners, hence the optional chaining and the "" fallback.
const PLATFORM =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
  navigator.platform ??
  "";

/** True on macOS (incl. iPadOS, which reports "MacIntel" with touch). */
export const IS_MAC = /mac/i.test(PLATFORM);

/** The Alt/Option key, named the way the user's own keyboard names it. */
export const ALT_KEY = IS_MAC ? "⌥ Option" : "Alt";

/** The primary chord modifier — Cmd on a Mac, Ctrl everywhere else. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
