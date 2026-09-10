import { useCallback, useEffect, useSyncExternalStore } from "react";

// Chat preferences, persisted per-browser in localStorage and synced across
// components via a custom event + the cross-tab `storage` event. Only
// reduce-motion has a switch in the UI (the Account panel, via
// ProfileButton) — that's also the only consumer left; the chat panel itself
// dropped its own usePrefs() call along with the header's `details` toggle.
// color-scheme now lives in its own store,
// `lib/theme.ts` — deliberately NOT a ChatPrefs field: this file discards its
// whole record on a SCHEMA_VERSION mismatch (see below), and folding theme in
// would mean a future chat-pref bump silently resets everyone's theme back to
// dark. collapse-tree remains a follow-up (FE plan step 9).
//
// ChatPrefs stays boolean-only: every field ends up rendered by
// PrefSwitch.tsx's generic on/onChange switch, whose `aria-checked` only
// accepts boolean.
export interface ChatPrefs {
  reduceMotion: boolean; // disable panel/turn/ember/caret animation
}

const KEY = "rlc-prefs";
const DEFAULTS: ChatPrefs = { reduceMotion: false };
const EVENT = "rlc-prefs-change";

// Bumped to 3 when the streaming-vs-staged delivery split was removed: the
// v2 record carried `traces` (renamed `details`) and `delivery`, neither of
// which exists any more, so a v2 record is discarded rather than partially
// adopted. (v2 itself was a prior bump for the same reason — see git
// history — and by the time it landed had never actually been written,
// since `setPref` had no caller while the switches were gone.) Still 3: the
// header's `details` toggle was removed in favor of per-row disclosure
// (each stage row expands on click, no pref involved), which drops `details`
// from ChatPrefs but doesn't change the stored shape's *version* — a v3
// record with a stray `details` key just has it ignored by the `DEFAULTS`
// spread below.
const SCHEMA_VERSION = 3;

function read(): ChatPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const { v, ...parsed } = JSON.parse(raw) as Partial<ChatPrefs> & { v?: number };
    if (v !== SCHEMA_VERSION) return DEFAULTS;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

// Cache the parsed value so getSnapshot returns a stable reference (avoids the
// useSyncExternalStore infinite-loop when JSON.parse yields a fresh object).
let snapshot: ChatPrefs = read();

function subscribe(cb: () => void): () => void {
  const handler = () => {
    snapshot = read();
    cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, () => snapshot, () => DEFAULTS);

  const setPref = useCallback(<K extends keyof ChatPrefs>(key: K, value: ChatPrefs[K]) => {
    const next = { ...read(), [key]: value };
    localStorage.setItem(KEY, JSON.stringify({ ...next, v: SCHEMA_VERSION }));
    snapshot = next;
    window.dispatchEvent(new Event(EVENT));
  }, []);

  // Reflect reduce-motion onto <body> so chat.css can disable animations.
  useEffect(() => {
    document.body.classList.toggle("rlc-nomotion", prefs.reduceMotion);
  }, [prefs.reduceMotion]);

  return { prefs, setPref };
}
